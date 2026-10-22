import assert from "node:assert/strict";
import { test } from "node:test";
import config from "../next.config.ts";

// The rewrite must not sever an AI request before the backend's own bounded deadline.
test("external proxy permits the 90-second AI deadline but stays below the client deadline", () => {
  const timeout = config.experimental?.proxyTimeout;
  assert.equal(typeof timeout, "number");
  assert.ok(timeout! > 90_000 && timeout! < 100_000);
});
