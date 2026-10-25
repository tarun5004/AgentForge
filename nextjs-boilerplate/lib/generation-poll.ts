import { ProjectApiError, type GenerationStatus } from "./project-api.ts";

// Unmount/timeout must release the timer without continuing status requests in the background.
export function waitForPoll(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2000);
    function abort() { clearTimeout(timer); reject(signal.reason); }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

// Poll GET evidence only: a pending response never causes another generation POST/model call.
export async function pollGeneration(
  generationId: string, read: (signal: AbortSignal) => Promise<GenerationStatus>, signal: AbortSignal,
  pause = waitForPoll,
  onProgress?: (result: GenerationStatus) => void,
): Promise<Exclude<GenerationStatus, { status: "pending" }>> {
  for (let attempt = 0; attempt < 180; attempt++) {
    signal.throwIfAborted();
    await pause(signal);
    signal.throwIfAborted();
    let result: GenerationStatus;
    try { result = await read(signal); }
    catch (error) {
      signal.throwIfAborted();
      if (error instanceof ProjectApiError && error.status === 401) throw error;
      // A failed GET (even 502) is not a confirmed failed generation POST; retain its request key.
      throw new ProjectApiError("Status temporarily unavailable. Keep the same key and check again.", 503, "GENERATION_IN_PROGRESS", generationId);
    }
    signal.throwIfAborted();
    if (result.id !== generationId) throw new Error("Generation status identity changed.");
    onProgress?.(result);
    if (result.status !== "pending") return result;
  }
  throw new ProjectApiError("Attempt is still pending. Keep the same key and check again.", 503, "GENERATION_IN_PROGRESS", generationId);
}
