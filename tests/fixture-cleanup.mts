// A failed cleanup must still attempt database disconnect and report a failing exit status.
// Callbacks keep this test-only lifecycle check independent of a real database.
export async function finishFixtureCleanup(
  cleanup: () => Promise<unknown>,
  disconnect: () => Promise<unknown>,
): Promise<number> {
  let exitCode = 0;
  try {
    await cleanup();
  } catch {
    // Database errors may contain credentials; emit only a stable, sanitized failure marker.
    process.stderr.write(`${JSON.stringify({ level: "error", message: "fixture_cleanup_failed" })}\n`);
    exitCode = 1;
  } finally {
    try {
      await disconnect();
    } catch {
      process.stderr.write(`${JSON.stringify({ level: "error", message: "fixture_disconnect_failed" })}\n`);
      exitCode = 1;
    }
  }
  return exitCode;
}
