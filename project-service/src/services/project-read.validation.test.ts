import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReadResponseSize, encodeProjectCursor, validateObjectId, validateProjectQuery, validateQueryKeys, validateRevisionQuery } from "./project-read.validation.js";

test("IDs accept exactly 24 hex characters, not objects or shortened IDs", () => {
  assert.equal(validateObjectId("ABCDEF1234567890ABCDEF12", "projectId"), "abcdef1234567890abcdef12");
  for (const value of [undefined, null, [], {}, "abc", "g".repeat(24)]) {
    assert.throws(() => validateObjectId(value, "projectId"), { statusCode: 400 });
  }
});

test("pagination defaults and canonical cursor round-trip", () => {
  assert.deepEqual(validateProjectQuery({}), { limit: 20, cursor: null });
  const position = { createdAt: new Date("2026-01-01T00:00:00.000Z"), id: "100000000000000000000001" };
  assert.deepEqual(validateProjectQuery({ limit: "50", cursor: encodeProjectCursor(position) }), { limit: 50, cursor: position });
});

test("queries reject unknown keys, non-scalar limits and malformed cursors", () => {
  for (const query of [{ ownerId: "owner" }, { limit: ["1", "2"] }, { limit: "51" }, { limit: "01" }, { cursor: "e30" }, { cursor: "x".repeat(257) }]) {
    assert.throws(() => validateProjectQuery(query), { statusCode: 400 });
  }
  assert.throws(() => validateQueryKeys({ extra: "value" }, []), { statusCode: 400 });
});

test("revision pagination is bounded and uses an exclusive positive safe-integer version", () => {
  assert.deepEqual(validateRevisionQuery({}), { limit: 20, beforeVersion: null });
  assert.deepEqual(validateRevisionQuery({ limit: "50", beforeVersion: "9007199254740991" }), { limit: 50, beforeVersion: Number.MAX_SAFE_INTEGER });
  for (const query of [{ beforeVersion: "0" }, { beforeVersion: "01" }, { beforeVersion: "9007199254740992" }, { beforeVersion: ["1", "2"] }, { cursor: "2" }]) {
    assert.throws(() => validateRevisionQuery(query), { statusCode: 400 });
  }
});

test("response bounds measure UTF-8 bytes and JSON escaping, not character count", () => {
  assert.doesNotThrow(() => assertReadResponseSize({ files: "x".repeat(100_000) }));
  assert.throws(() => assertReadResponseSize({ files: "😀".repeat(270_000) }), { statusCode: 413 });
  assert.throws(() => assertReadResponseSize({ files: "\u0000".repeat(180_000) }), { statusCode: 413 });
});
