import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { getPreviewFrameAncestors } from "./preview.policy.js";
import { createPreviewServer } from "./preview.server.js";

// An unset setting must keep existing localhost and numeric-loopback users working.
test("preview frame policy preserves defaults and permits one exact custom loopback origin", () => {
  assert.equal(getPreviewFrameAncestors(undefined), "http://localhost:3001 http://127.0.0.1:3001");
  assert.equal(getPreviewFrameAncestors("http://localhost:3102"), "http://localhost:3102");
  assert.equal(getPreviewFrameAncestors("http://127.0.0.1:4317/"), "http://127.0.0.1:4317");
});

// Do not fix a port mismatch by allowing public sites, wildcard parents or header injection.
test("preview frame policy rejects remote, ambiguous and secret-bearing origins", () => {
  for (const origin of ["", "*", "null", "https://localhost:3102", "http://example.com:3102",
    "http://localhost.evil.test:3102", "http://0.0.0.0:3102", "http://[::1]:3102",
    "http://user:password@localhost:3102", "http://localhost:3102/path", "http://localhost:3102/?x=1",
    "http://localhost:3102/#fragment", "http://localhost:3102?", "http://localhost:3102#",
    "http://localhost:3102 http://localhost:3103", "http://localhost:3102\r\nscript-src *"]) {
    assert.throws(() => getPreviewFrameAncestors(origin), /PREVIEW_FRONTEND_ORIGIN/);
    assert.throws(() => createPreviewServer({ artifact: () => undefined }, origin), /PREVIEW_FRONTEND_ORIGIN/);
  }
});

// Inspect an actual response: changing the parent origin must not loosen sandbox/network policy.
test("preview HTTP response uses configured frame ancestor while retaining isolation headers", async () => {
  const server = createPreviewServer({ artifact: () => Buffer.from("<h1>Fixture</h1>") }, "http://localhost:3102");
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/preview/${"1".repeat(36)}/${"a".repeat(48)}/`);
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy")!;
    assert.match(csp, /frame-ancestors http:\/\/localhost:3102$/);
    assert.doesNotMatch(csp, /localhost:3001|127\.0\.0\.1:3001/);
    assert.match(csp, /sandbox allow-scripts;/);
    assert.match(csp, /connect-src 'none';/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
