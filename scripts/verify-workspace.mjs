import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { assertEmptyCounts, parseOptions, validateTestUri } from './workspace-verification.config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = new Set();
const browserSessions = new Set();
const report = { suites: [], cleanup: false };
let next, fixture, client, reportPath, playwrightEntry;

// Bootstrap once, then avoid repeating npm startup/network work for every browser interaction.
function resolvePlaywrightCli() {
  const npmEntry = resolve(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');
  const result = spawnSync(process.execPath, [npmEntry, '--yes', '--package', '@playwright/cli@0.1.22', '--', 'where.exe', 'playwright-cli'], {
    cwd: root, windowsHide: true, timeout: 90_000, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  if (result.status !== 0) throw new Error('Could not bootstrap pinned Playwright CLI. Check npm/Chrome setup.');
  const shim = result.stdout.split(/\r?\n/).find(line => line.trim().endsWith('playwright-cli.cmd'))?.trim();
  if (!shim) throw new Error('Pinned Playwright CLI shim was not found.');
  const directory = resolve(dirname(shim), '../@playwright/cli');
  const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.version !== '0.1.22') throw new Error('Unexpected Playwright CLI version.');
  return resolve(directory, typeof metadata.bin === 'string' ? metadata.bin : metadata.bin['playwright-cli']);
}

// Check availability without reusing or terminating a user's existing server.
async function assertFreePort(port) {
  const server = createServer();
  server.listen(port, '127.0.0.1');
  try { await once(server, 'listening'); }
  catch { throw new Error(`Verification port ${port} is occupied. Existing processes were left untouched.`); }
  await new Promise(resolveClose => server.close(resolveClose));
}

// Spawn exact executables without cmd.exe quoting; Windows helpers stay hidden.
function start(binary, args, env = process.env, cwd = root) {
  const child = spawn(binary, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.on('error', () => {});
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  return child;
}

// A known unique session lets finally close only our browser even after a runner timeout.
async function browserSuite(script, suite) {
  const session = `verification-${process.pid}-${suite}`;
  browserSessions.add(session);
  await finish(start('powershell.exe', ['-NoProfile', '-File', script, '-Suite', suite, '-BaseUrl', 'http://localhost:3102'], {
    ...process.env, AGENTFORGE_BROWSER_SESSION: session, AGENTFORGE_PLAYWRIGHT_CLI: playwrightEntry, npm_config_update_notifier: 'false',
  }));
}

// Time-bound every subprocess; a stuck CLI cannot quietly leave a green report.
async function finish(child, timeout = 600_000) {
  if (child.signalCode !== null) throw new Error('Verification child was terminated.');
  if (child.exitCode !== null) {
    if (child.exitCode !== 0) throw new Error('Verification child exited unsuccessfully.');
    return;
  }
  let timer;
  try {
    const result = await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Verification child timed out.')), timeout); }),
    ]);
    if (result[0] !== 0) throw new Error('Verification child exited unsuccessfully.');
  } finally { clearTimeout(timer); }
}

// Wait for actual HTTP readiness and child liveness instead of assuming a startup delay.
async function ready(child, url, expected) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Verification server exited before readiness.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok && (!expected || expected(await response.json()))) return;
    } catch { /* Startup may still be compiling/importing; the bounded loop checks again. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  throw new Error('Verification server readiness timed out.');
}

// Counts are independently read through a separate client; no database drop is ever used.
async function emptyDatabase() {
  const counts = {};
  for (const name of ['users', 'projects', 'revisions', 'generations']) counts[name] = await client.db().collection(name).countDocuments({});
  assertEmptyCounts(counts);
  return counts;
}

// Only launcher-owned process trees are stopped; never enumerate/kill by port or name.
function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    if (result.status !== 0 && child.exitCode === null) throw new Error('Could not stop owned verification process.');
  } else child.kill('SIGTERM');
}

// HTTP shutdown releases held requests, performs scoped fixture cleanup and disconnects Mongo.
async function stopFixture() {
  if (!fixture) return;
  try {
    if (fixture.exitCode === null && fixture.signalCode === null) {
      const response = await fetch('http://127.0.0.1:4312/__fixture/shutdown', { method: 'POST', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Fixture shutdown rejected.');
      await finish(fixture, 20_000);
    } else if (fixture.exitCode !== 0 || fixture.signalCode !== null) throw new Error('Fixture exited unsuccessfully.');
  } finally { stop(fixture); fixture = null; }
  await emptyDatabase();
}

// One fresh fixture per real suite prevents another suite's records from hiding duplicate writes.
async function realSuite(suite, uri) {
  await emptyDatabase();
  fixture = start(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'tests/frontend-history.fixture.mts'],
    { ...process.env, AGENTFORGE_TEST_MONGODB_URI: uri });
  await ready(fixture, 'http://127.0.0.1:4312/__fixture', value => value.fixtureId === 'agentforge-real-revision-loop-v1');
  try {
    await browserSuite('scripts/verify-workspace-real.ps1', suite);
    report.suites.push({ suite, passed: true });
  } finally { await stopFixture(); }
}

// The launcher owns servers/cleanup; the existing browser scripts continue to own their sessions.
async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.info('Set an explicit local AGENTFORGE_TEST_MONGODB_URI, then run with --suite all|loop|recovery|state|mocked. Windows/Chrome/local Mongo required. --fail-after-start verifies failure cleanup.');
    return;
  }
  if (process.platform !== 'win32') throw new Error('This launcher currently requires Windows PowerShell.');
  const uri = process.env.AGENTFORGE_TEST_MONGODB_URI;
  const database = validateTestUri(uri);
  for (const port of [3102, 4310, 4311, 4312]) await assertFreePort(port);
  client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  await emptyDatabase();
  playwrightEntry = resolvePlaywrightCli();
  const artifactDirectory = resolve(root, 'output/playwright');
  await mkdir(artifactDirectory, { recursive: true });
  reportPath = resolve(artifactDirectory, `verification-${Date.now()}.json`);
  report.database = database;
  next = start(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--port', '3102'], {
    ...process.env, AUTH_SERVICE_URL: 'http://127.0.0.1:4310', PROJECT_SERVICE_URL: 'http://127.0.0.1:4311',
  }, resolve(root, 'nextjs-boilerplate'));
  await ready(next, 'http://localhost:3102/login');
  if (options.failAfterStart) {
    fixture = start(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'tests/frontend-history.fixture.mts'],
      { ...process.env, AGENTFORGE_TEST_MONGODB_URI: uri });
    await ready(fixture, 'http://127.0.0.1:4312/__fixture', value => value.fixtureId === 'agentforge-real-revision-loop-v1');
    throw new Error('Deliberate failure after server startup.');
  }
  if (options.suite === 'all' || options.suite === 'mocked') {
    for (const suite of ['links', 'history', 'access']) {
      await browserSuite('scripts/verify-workspace-links.ps1', suite);
      report.suites.push({ suite, passed: true });
    }
  }
  for (const suite of options.suite === 'all' ? ['loop', 'recovery', 'state'] : ['loop', 'recovery', 'state'].filter(name => name === options.suite)) {
    await realSuite(suite, uri);
  }
}

try { await main(); }
catch (error) { report.failed = true; console.error(error instanceof Error ? error.message : 'Verification failed.'); process.exitCode = 1; }
finally {
  // Each cleanup action runs even if another fails. Reports never claim cleanup without a DB probe.
  for (const session of browserSessions) {
    const closed = spawnSync(process.execPath, [playwrightEntry, `-s=${session}`, 'close'], {
      cwd: root, windowsHide: true, timeout: 15_000, stdio: 'ignore', env: { ...process.env, npm_config_update_notifier: 'false' },
    });
    if (closed.status !== 0) { process.exitCode = 1; report.failed = true; console.error('Owned browser cleanup failed.'); }
  }
  try { await stopFixture(); if (client) { await emptyDatabase(); report.cleanup = true; } }
  catch { process.exitCode = 1; report.failed = true; console.error('Scoped fixture cleanup failed; inspect dedicated test data.'); }
  for (const child of children) {
    try { stop(child); } catch { process.exitCode = 1; report.failed = true; console.error('Owned process cleanup failed.'); }
    // A detached CLI daemon may inherit these pipes after its parent exits.
    child.stdout.destroy(); child.stderr.destroy(); child.unref();
  }
  if (client) await client.close();
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2));
  if (!process.exitCode && reportPath) console.info('PASS verification and scoped cleanup. Summary:', reportPath);
}
