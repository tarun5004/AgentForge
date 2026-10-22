import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compose = ['compose', '-p', 'agentforge-compose-smoke', '-f', 'compose.yaml', '-f', 'tests/compose.smoke.yaml'];
const environment = { ...process.env, AGENTFORGE_WEB_PORT: '3103' };
const origin = 'http://127.0.0.1:3103';
const email = `compose-${randomUUID()}@agentforge.test`;
const password = randomUUID();
let owned = false;

// Docker output may contain operational details; errors expose only the command's purpose.
function docker(args, purpose, input) {
  const result = spawnSync('docker', [...compose, ...args], {
    cwd: root, env: environment, encoding: 'utf8', input, timeout: 600_000, maxBuffer: 10_000_000,
  });
  if (result.status !== 0) {
    // Keep startup failures diagnosable before finally removes containers, without env/log dumps.
    if (args[0] === 'up') {
      const status = spawnSync('docker', [...compose, 'ps', '--all', '--format', 'json'], {
        cwd: root, env: environment, encoding: 'utf8', timeout: 15_000,
      });
      try {
        const rows = status.stdout.trim().split('\n').filter(Boolean).flatMap(line => JSON.parse(line));
        console.error('Startup status:', JSON.stringify(rows.map(row => ({
          service: row.Service, state: row.State, health: row.Health, exitCode: row.ExitCode,
        }))));
      } catch { console.error('Startup status unavailable; inspect this smoke project only.'); }
    }
    throw new Error(purpose);
  }
  return result.stdout.trim();
}

// These literal DB names are the only data this runner may read or clean; never load service URIs.
function mongo(code) {
  return JSON.parse(docker(['exec', '-T', 'mongodb', 'mongosh', '--quiet', '--eval', code], 'Dedicated Mongo probe failed.'));
}

// Counts fail closed before writes; an old or unknown fixture is preserved for investigation.
function counts() {
  return mongo(`print(JSON.stringify({users:db.getSiblingDB('agentforge_test_compose_auth').users.countDocuments({}),
    projects:db.getSiblingDB('agentforge_test_compose_projects').projects.countDocuments({}),
    generations:db.getSiblingDB('agentforge_test_compose_projects').generations.countDocuments({}),
    revisions:db.getSiblingDB('agentforge_test_compose_projects').revisions.countDocuments({})}))`);
}

// Bound every request and never print response bodies containing JWTs or cookies.
async function request(path, options = {}, expected = 200) {
  let response;
  try {
    response = await fetch(`${origin}${path}`, { ...options,
      // This runner intentionally destroys/recreates servers; don't reuse their old sockets.
      headers: { ...options.headers, Connection: 'close' }, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Error(`Smoke HTTP request failed for ${path} (${error.cause?.code ?? error.name}).`);
  }
  assert.equal(response.status, expected, `Unexpected HTTP status for ${path}.`);
  return response;
}

// Refuse occupied ports instead of stopping or reusing a user's local server.
async function freePort() {
  const server = createServer();
  server.listen(3103, '127.0.0.1');
  try { await once(server, 'listening'); }
  catch { throw new Error('Smoke port 3103 is occupied; existing processes were not touched.'); }
  await new Promise(resolveClose => server.close(resolveClose));
}

// Cleanup finds only this run's unique account and its owned projects, not all test DB data.
function cleanup() {
  const literal = JSON.stringify(email);
  return mongo(`const a=db.getSiblingDB('agentforge_test_compose_auth');
    const p=db.getSiblingDB('agentforge_test_compose_projects');
    const users=a.users.find({email:${literal}},{_id:1}).toArray();
    const ownerIds=users.map(u=>u._id.toString());
    const ids=p.projects.find({ownerId:{$in:ownerIds}},{_id:1}).toArray().map(p=>p._id);
    p.revisions.deleteMany({projectId:{$in:ids}});p.generations.deleteMany({projectId:{$in:ids}});
    p.projects.deleteMany({_id:{$in:ids}});a.users.deleteMany({_id:{$in:users.map(u=>u._id)}});
    print(JSON.stringify({cleaned:true}));`);
}

// Prove Next rewrites, real authentication, ownership and Mongo persistence without any AI call.
async function main() {
  await freePort();
  assert.equal(docker(['ps', '--all', '--quiet'], 'Could not inspect smoke project.'), '', 'Existing smoke containers must be investigated first.');
  owned = true;
  console.info('Starting isolated Compose smoke stack; no real model key is supplied.');
  docker(['up', '--build', '-d', '--wait', '--wait-timeout', '240'], 'Compose smoke startup failed; inspect its service logs.');
  assert.ok(Object.values(counts()).every(count => count === 0), 'Dedicated smoke DBs must initially be empty.');
  const noProviderKey = docker(['exec', '-T', 'ai-orchestrator-service', 'node', '-e',
    "process.stdout.write(String(process.env.AI_GATEWAY_API_KEY==='docker-smoke-not-a-provider-key'&&!process.env.VERCEL_OIDC_TOKEN))"], 'Could not verify no-cost boundary.');
  assert.equal(noProviderKey, 'true');
  await request('/login');
  await request('/api/projects', {}, 401);
  const registered = await (await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Compose smoke owner', email, password }) }, 201)).json();
  assert.ok(registered.user?.id && registered.accessToken);
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }) });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Login must set a refresh cookie.');
  const session = await (await request('/api/auth/refresh', { method: 'POST', headers: { Cookie: cookie } })).json();
  const headers = { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' };
  const project = (await (await request('/api/projects', { method: 'POST', headers,
    body: JSON.stringify({ prompt: 'Build a simple Compose smoke portfolio' }) }, 201)).json()).project;
  assert.equal(project.status, 'draft');
  assert.equal((await (await request('/api/projects', { headers })).json()).projects.length, 1);
  assert.equal((await (await request(`/api/projects/${project.id}`, { headers })).json()).project.id, project.id);
  assert.equal((await (await request(`/api/projects/${project.id}/revisions`, { headers })).json()).revisions.length, 0);
  const guard = docker(['exec', '-T', 'frontend', 'node', '-e',
    "fetch('http://ai-orchestrator-service:6001/internal/generations',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>process.stdout.write(String(r.status)))"], 'Internal AI authorization probe failed.');
  assert.equal(guard, '401');
  // Valid internal auth + deliberately invalid input proves wiring without reaching the model.
  const validation = docker(['exec', '-T', 'project-service', 'node', '-e',
    "fetch(process.env.AI_ORCHESTRATOR_URL+'/internal/generations',{method:'POST',headers:{'content-type':'application/json','x-internal-service-token':process.env.INTERNAL_SERVICE_TOKEN},body:'{}'}).then(r=>process.stdout.write(String(r.status)))"], 'Project-to-AI validation probe failed.');
  assert.equal(validation, '400');
  assert.deepEqual(counts(), { users: 1, projects: 1, generations: 0, revisions: 0 });
  console.info('PASS real proxy/auth/session/draft/history flow; unauthorized requests rejected; zero generations.');
  // Recreating containers (not deleting volumes) proves records outlive an individual container.
  docker(['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '240'], 'Smoke stack recreation failed.');
  assert.equal((await (await request(`/api/projects/${project.id}`, { headers })).json()).project.id, project.id);
  assert.deepEqual(counts(), { users: 1, projects: 1, generations: 0, revisions: 0 });
  console.info('PASS saved draft survived container recreation through the named Mongo volume.');
}

try { await main(); }
catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : 'Compose smoke failed.');
} finally {
  if (owned) {
    try {
      cleanup();
      assert.ok(Object.values(counts()).every(count => count === 0), 'Unknown records remain; no broad deletion attempted.');
      console.info('PASS scoped smoke cleanup; all four dedicated collection counts are zero.');
    } catch {
      process.exitCode = 1;
      console.error('Scoped smoke cleanup could not be confirmed; dedicated volume preserved.');
    }
    try { docker(['down'], 'Smoke containers could not be stopped.'); }
    catch { process.exitCode = 1; console.error('Stop only project agentforge-compose-smoke manually.'); }
  }
}
