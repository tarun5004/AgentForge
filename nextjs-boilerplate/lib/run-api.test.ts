import assert from "node:assert/strict";
import { test } from "node:test";
import { isPreviewUrl, RunApiError, startRun, updateRun } from "./run-api.ts";

const projectId = "100000000000000000000001";
const revisionId = "200000000000000000000001";
const id = "11111111-1111-4111-8111-111111111111";
const run = { id, projectId, revisionId, state: "building", message: "Building saved source.", errorCode: null, createdAt: "2026-10-22T00:00:00Z", previewUrl: null };
const url = `http://127.0.0.1:5101/preview/${id}/${"a".repeat(48)}/`;

test("preview URLs reject arbitrary origins, schemes, credentials and wrong run IDs", () => {
  assert.ok(isPreviewUrl(url, id));
  for (const value of ["javascript:alert(1)", url.replace("127.0.0.1", "evil.example"), url + "?x=y", url.replace("http://", "http://user:pass@"), url.replace(id, "22222222-2222-4222-8222-222222222222")]) {
    assert.equal(isPreviewUrl(value, id), false);
  }
});

test("start submits only selected saved IDs with auth and cancellation", async () => {
  const original = globalThis.fetch;
  const signal = new AbortController().signal;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "/api/runs");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { projectId, revisionId });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture");
    assert.ok(init?.signal);
    return Response.json({ run });
  };
  try { assert.equal((await startRun(projectId, revisionId, "fixture", signal)).id, id); }
  finally { globalThis.fetch = original; }
});

test("stop uses DELETE and retains the cleanup acknowledgement state", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "DELETE");
    return Response.json({ run: { ...run, state: "cancelling" } });
  };
  try { assert.equal((await updateRun(id, "stop", "fixture", new AbortController().signal)).state, "cancelling"); }
  finally { globalThis.fetch = original; }
});

test("malformed success, unsafe preview URL and mismatched identities never reach the iframe", async () => {
  const original = globalThis.fetch;
  try {
    for (const bad of [{ ...run, id: "bad" }, { ...run, state: "ready", previewUrl: "https://evil.example" }, { ...run, revisionId: projectId }]) {
      globalThis.fetch = async () => Response.json({ run: bad });
      await assert.rejects(startRun(projectId, revisionId, "fixture", new AbortController().signal), RunApiError);
    }
  } finally { globalThis.fetch = original; }
});

test("preview requests refresh once on 401, while 503 does not invalidate identity", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let refreshes = 0;
  const access = { getAccessToken: () => "old", refreshAccessToken: async () => { refreshes++; return "new"; } };
  globalThis.fetch = async (_input, init) => {
    calls++;
    if (calls === 1) return Response.json({ message: "Expired" }, { status: 401 });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer new");
    return Response.json({ run: { ...run, state: "ready", previewUrl: url } });
  };
  try {
    assert.equal((await startRun(projectId, revisionId, access, new AbortController().signal)).previewUrl, url);
    assert.equal(refreshes, 1);
    globalThis.fetch = async () => new Response("Offline", { status: 503 });
    await assert.rejects(startRun(projectId, revisionId, access, new AbortController().signal), (error: unknown) => error instanceof RunApiError && error.status === 503);
    assert.equal(refreshes, 1);
  } finally { globalThis.fetch = original; }
});
