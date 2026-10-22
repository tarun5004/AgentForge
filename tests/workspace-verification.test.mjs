import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertEmptyCounts, parseOptions, validateTestUri } from '../scripts/workspace-verification.config.mjs';

test('verification options are explicit, bounded and reject typo/duplicate scopes', () => {
  assert.deepEqual(parseOptions([]), { suite: 'all', failAfterStart: false, help: false });
  for (const suite of ['all', 'loop', 'recovery', 'state', 'mocked', 'session', 'preview-real']) assert.equal(parseOptions(['--suite', suite]).suite, suite);
  assert.equal(parseOptions(['--fail-after-start']).failAfterStart, true);
  assert.equal(parseOptions(['--help']).help, true);
  for (const args of [['--suite'], ['--suite', 'production'], ['--force'], ['--suite', 'loop', '--suite', 'state'], ['--help', '--help']]) {
    assert.throws(() => parseOptions(args));
  }
});

test('database guard accepts only named local disposable targets', () => {
  assert.equal(validateTestUri('mongodb://127.0.0.1:27017/agentforge_test_runner'), 'agentforge_test_runner');
  assert.equal(validateTestUri('mongodb://localhost:27018/agentforge_test_42'), 'agentforge_test_42');
  for (const uri of [undefined, '', 'not-a-uri', 'mongodb://127.0.0.1/agentforge', 'mongodb://example.com/agentforge_test_x',
    'mongodb+srv://localhost/agentforge_test_x', 'mongodb://user:secret@localhost/agentforge_test_x',
    'mongodb://localhost/agentforge_test_x?authSource=admin', 'mongodb://localhost/agentforge_test_x#fragment', 'mongodb://localhost/']) {
    assert.throws(() => validateTestUri(uri));
  }
});

test('empty guard fails closed for unknown, negative and nonzero counts', () => {
  const empty = { users: 0, projects: 0, revisions: 0, generations: 0 };
  assert.doesNotThrow(() => assertEmptyCounts(empty));
  for (const counts of [{}, { ...empty, users: 1 }, { ...empty, projects: -1 }, { ...empty, revisions: '0' }]) {
    assert.throws(() => assertEmptyCounts(counts));
  }
});
