const suites = ['all', 'loop', 'recovery', 'state', 'mocked', 'session'];

// Refuse typos/extra flags instead of silently running a different verification scope.
export function parseOptions(args) {
  const options = { suite: 'all', failAfterStart: false, help: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error('Duplicate verification option.');
    seen.add(flag);
    if (flag === '--suite') {
      options.suite = args[++index];
      if (!suites.includes(options.suite)) throw new Error('Suite must be all, loop, recovery, state, mocked or session.');
    } else if (flag === '--fail-after-start') options.failAfterStart = true;
    else if (flag === '--help') options.help = true;
    else throw new Error('Unknown verification option.');
  }
  return options;
}

// Never derive a destructive test target from application .env files or accept credentials/options.
export function validateTestUri(value) {
  if (!value) throw new Error('Set AGENTFORGE_TEST_MONGODB_URI to an explicit local agentforge_test_* database.');
  let target;
  try { target = new URL(value); } catch { throw new Error('Invalid dedicated test database URI.'); }
  if (target.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !/^\/agentforge_test_[a-zA-Z0-9_]+$/.test(target.pathname) || target.username || target.password || target.search || target.hash) {
    throw new Error('Only a local agentforge_test_* database without credentials/options is allowed.');
  }
  return target.pathname.slice(1);
}

// Unknown or nonzero counts are a refusal, not permission to broaden cleanup filters.
export function assertEmptyCounts(counts) {
  if (['users', 'projects', 'revisions', 'generations'].some(name => counts[name] !== 0)) {
    throw new Error('Dedicated verification database is not empty; no records were deleted.');
  }
}
