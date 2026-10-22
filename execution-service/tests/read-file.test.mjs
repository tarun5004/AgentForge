import assert from "node:assert/strict";
import { test } from "node:test";
import { readBounded } from "../preview/read-file.mjs";
import { readInput } from "../preview/read-input.mjs";
import { Readable } from "node:stream";

// Force short reads rather than relying on the filesystem to reproduce a rare truncation.
function partialReader(source) {
  return { async read(buffer, offset, length, position) {
    const bytesRead = Math.min(17, length, source.length - position);
    source.copy(buffer, offset, position, position + bytesRead);
    return { bytesRead };
  } };
}

test("artifact reader continues after short reads without truncating bytes", async () => {
  const source = Buffer.from("a complete artifact ".repeat(1000));
  assert.deepEqual(await readBounded(partialReader(source), source.length), source);
});

test("artifact reader rejects growth beyond its byte budget", async () => {
  await assert.rejects(readBounded(partialReader(Buffer.alloc(100)), 99), /too large/);
  assert.deepEqual(await readBounded(partialReader(Buffer.alloc(0)), 0), Buffer.alloc(0));
});

test("stdin preserves Hindi and emoji split across UTF-8 chunks", async () => {
  const input = { content: "नमस्ते 👋" };
  const bytes = Buffer.from(JSON.stringify(input));
  const chunks = [...bytes].map((byte) => Buffer.from([byte]));
  assert.deepEqual(await readInput(Readable.from(chunks)), input);
});

test("stdin rejects an oversized payload before JSON decoding", async () => {
  await assert.rejects(readInput(Readable.from([Buffer.alloc(1_000_001)])), /too large/);
});
