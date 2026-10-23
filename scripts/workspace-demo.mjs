import { createInterface } from 'node:readline';

// Keep a manual session alive, but fail visibly if an owned service dies while the user explores it.
export function waitForDemoStop({ input = process.stdin, signals = process, children = [] } = {}) {
  return new Promise((resolve, reject) => {
    const terminal = createInterface({ input });
    // Remove listeners before closing readline, because close also signals an ordinary end of input.
    function finish(error) {
      terminal.removeListener('line', stop);
      terminal.removeListener('close', stop);
      signals.removeListener('SIGINT', stop);
      signals.removeListener('SIGTERM', stop);
      for (const child of children) {
        child.removeListener('exit', failed);
        child.removeListener('error', failed);
      }
      terminal.close();
      // On Windows a paused stdin pipe can still keep Node alive after all services have stopped.
      input.unref?.();
      if (error) reject(error);
      else resolve();
    }
    // Enter, EOF and ordinary termination all return control to the launcher's scoped cleanup.
    function stop() { finish(); }
    // Never print a child error object, which could contain local configuration.
    function failed() { finish(new Error('An owned demo service stopped unexpectedly.')); }
    terminal.once('line', stop);
    terminal.once('close', stop);
    signals.once('SIGINT', stop);
    signals.once('SIGTERM', stop);
    for (const child of children) {
      child.once('exit', failed);
      child.once('error', failed);
      if (child.exitCode !== null || child.signalCode !== null) { failed(); break; }
    }
  });
}
