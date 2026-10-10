import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeProjectCursor, validateObjectId, validateProjectQuery, validateQueryKeys } from "./project-read.validation.js";

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
