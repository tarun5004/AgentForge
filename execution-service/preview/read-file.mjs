// File reads can be short: continue to EOF and reject growth beyond the remaining byte budget.
export async function readBounded(handle, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes - bytes + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, bytes);
    if (bytesRead === 0) return Buffer.concat(chunks);
    bytes += bytesRead;
    if (bytes > maxBytes) throw new Error("Output too large.");
    chunks.push(buffer.subarray(0, bytesRead));
  }
}
