// Test-only stand-in for a CLI: no browser, network, credentials or application data.
const mode = process.argv.at(-1);
if (mode === 'notice') process.stderr.write('npm notice harmless fixture notice\n');
else if (mode === 'exit-failure') { process.stderr.write('Error: deliberate native failure\n'); process.exitCode = 7; }
else if (mode === 'browser-error') process.stdout.write('### Error\nError: deliberate browser assertion\n');
else process.exitCode = 9;
