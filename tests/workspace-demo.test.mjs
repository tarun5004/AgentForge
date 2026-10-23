import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { waitForDemoStop } from '../scripts/workspace-demo.mjs';

// Fake event sources exercise lifecycle handling without starting services or touching a database.
function session() {
  const input = new PassThrough();
  const signals = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  return { input, signals, child };
}

test('Enter returns to cleanup and removes listeners from all owned resources', async () => {
  const { input, signals, child } = session();
  const stopped = waitForDemoStop({ input, signals, children: [child] });
  input.write('\n');
  await stopped;
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
  input.destroy();
});

test('EOF and termination signals also return to scoped cleanup', async () => {
  for (const event of ['EOF', 'SIGINT', 'SIGTERM']) {
    const { input, signals } = session();
    const stopped = waitForDemoStop({ input, signals });
    if (event === 'EOF') input.end();
    else signals.emit(event);
    await stopped;
    input.destroy();
  }
});

test('a dead or failed child rejects instead of leaving a misleading live demo', async () => {
  for (const event of ['exit', 'error', 'already-dead']) {
    const { input, signals, child } = session();
    if (event === 'already-dead') child.exitCode = 1;
    const stopped = waitForDemoStop({ input, signals, children: [child] });
    if (event === 'exit') child.emit('exit', 1);
    if (event === 'error') child.emit('error', new Error('must not be exposed'));
    await assert.rejects(stopped, { message: 'An owned demo service stopped unexpectedly.' });
    assert.equal(signals.listenerCount('SIGINT'), 0);
    input.destroy();
  }
});

test('Enter lets a real Node child exit even when its parent keeps stdin open', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    'import { waitForDemoStop } from "./scripts/workspace-demo.mjs"; await waitForDemoStop();'],
  { cwd: new URL('..', import.meta.url), windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  const exited = once(child, 'exit');
  let timer;
  try {
    child.stdin.write('\n');
    const [code] = await Promise.race([exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Demo input kept the child alive after Enter.')), 5000);
    })]);
    assert.equal(code, 0);
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    if (child.exitCode === null) { child.kill(); await exited; }
    child.stderr.destroy();
  }
});
