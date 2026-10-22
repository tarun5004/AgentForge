import type { Server } from "node:http";

// Stop container work immediately, not after slow clients release their HTTP connections.
export async function stopExecution(server: Server, preview: Server | undefined, stopRuns: () => Promise<void>) {
  const cleanup = stopRuns();
  // Start listening shutdown synchronously so no new request can race into a closing worker.
  const drained = new Promise<void>((resolve) => server.close(() => resolve()));
  preview?.close();
  preview?.closeAllConnections();
  const drainTimer = setTimeout(() => server.closeAllConnections(), 5_000);
  drainTimer.unref();
  try {
    await Promise.all([cleanup, drained]);
  } finally {
    clearTimeout(drainTimer);
    server.closeAllConnections();
  }
}
