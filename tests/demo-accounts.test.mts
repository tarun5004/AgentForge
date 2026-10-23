import assert from "node:assert/strict";
import { test } from "node:test";
import { registeredDemoUserId } from "./demo-accounts.mts";

test("manual demo cleanup accepts only IDs observed in successful registrations", () => {
  const id = "66d123456789abcdef123456";
  assert.equal(registeredDemoUserId("POST", "/api/auth/register", 201, { user: { id } }), id);
  for (const [method, path, status] of [["GET", "/api/auth/register", 201], ["POST", "/api/auth/login", 200],
    ["POST", "/api/auth/register", 409], ["POST", "/api/auth/register?fake=1", 201]] as const) {
    assert.equal(registeredDemoUserId(method, path, status, { user: { id } }), null);
  }
  for (const body of [null, {}, { user: null }, { user: { id: "not-an-id" } }, { user: { id: 123 } }]) {
    assert.equal(registeredDemoUserId("POST", "/api/auth/register", 201, body), null);
  }
});
