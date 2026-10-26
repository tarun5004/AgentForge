// Test-only stand-in for a CLI: no browser, network, credentials or application data.
const mode = process.argv.at(-1);
if (mode === 'notice') process.stderr.write('npm notice harmless fixture notice\n');
else if (mode === 'exit-failure') { process.stderr.write('Error: deliberate native failure\n'); process.exitCode = 7; }
else if (mode === 'browser-error') process.stdout.write('### Error\nError: deliberate browser assertion\n');
else if (process.argv.includes('run-code')) {
  const code = process.argv.slice(process.argv.indexOf('run-code') + 1);
  // Check what Node actually received, not merely the PowerShell array before native marshaling.
  if (code.length !== 1 || code[0] !== process.env.AGENTFORGE_EXPECTED_BROWSER_CODE) {
    process.stderr.write('Error: inline browser code was split or changed by the shell\n');
    process.exitCode = 8;
  }
}
else process.exitCode = 9;
