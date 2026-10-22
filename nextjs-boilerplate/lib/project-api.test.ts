import assert from "node:assert/strict";
import { test } from "node:test";
import { generateProject, getGeneration, getRevision, listProjects, ProjectApiError } from "./project-api.ts";
import { createWorkspaceFiles } from "../components/workspace/workspace-data.ts";

const projectId = "100000000000000000000001";
const revisionId = "200000000000000000000001";
const date = "2026-10-12T00:00:00.000Z";
const project = { id: projectId, name: "Portfolio", initialPrompt: "Build a portfolio page", template: "nextjs", status: "ready", createdAt: date, updatedAt: date, latestRevision: { id: revisionId, version: 1 } };
const revision = { id: revisionId, projectId, generationId: "300000000000000000000001", version: 1, summary: "A saved portfolio page", parentRevisionId: null, sourcePrompt: "Build a portfolio page", createdAt: date, updatedAt: date, files: [{ path: "app/page.tsx", content: "saved" }], fileChanges: null, provider: null, model: null, usage: null, latencyMs: null, validation: null, schemaVersion: null };

// HTTP fixtures test browser parsing and request identity without paid model calls.
test("lists ready projects and reads legacy revision metadata", async (context) => {
  context.mock.method(globalThis, "fetch", async (url: string) => Response.json(url.includes("revisions") ? { revision } : { projects: [project], nextCursor: null }));
  assert.deepEqual((await listProjects("token")).projects, [project]);
  assert.deepEqual(await getRevision(projectId, revisionId, "token"), revision);
});

test("generation retries forward exactly the caller's key and selected base", async (context) => {
  const calls: RequestInit[] = [];
  const generation = { id: revision.generationId, status: "ready", revisionId, revisionVersion: 2, parentRevisionId: revisionId, sourcePrompt: "Make the hero darker", files: revision.files, fileChanges: [], validation: { policyVersion: "frontend-manifest-v1", status: "manifest_validated" }, provider: "fixture", model: "fixture", summary: "Changed portfolio hero", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, latencyMs: 5 };
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { calls.push(init); return Response.json({ generation }); });
  const body = { prompt: "Make the hero darker", baseRevisionId: revisionId };
  for (let retry = 0; retry < 2; retry++) await generateProject(projectId, "token", "stable-key", body);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(new Headers(call.headers).get("Idempotency-Key"), "stable-key");
    assert.deepEqual(JSON.parse(call.body as string), body);
  }
});

test("preserves conflict details and rejects malformed successful responses", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ message: "Project changed", code: "REVISION_CONFLICT", generationId: revision.generationId, latestRevisionId: revisionId }, { status: 409 }));
  await assert.rejects(generateProject(projectId, "token", "key", {}), (error: unknown) => error instanceof ProjectApiError && error.status === 409 && error.code === "REVISION_CONFLICT" && error.latestRevisionId === revisionId);
  context.mock.method(globalThis, "fetch", async () => Response.json({ revision: { ...revision, files: [{ path: "app/page.tsx" }] } }));
  await assert.rejects(getRevision(projectId, revisionId, "token"), /invalid/i);
});

test("handles non-JSON errors and forwards abort signals on reads", async (context) => {
  const controller = new AbortController();
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(init.signal, controller.signal);
    return new Response("unavailable", { status: 503 });
  });
  await assert.rejects(listProjects("token", null, controller.signal), (error: unknown) => error instanceof ProjectApiError && error.status === 503);
});

// Runtime enum guards must reject arrays that stringify to a valid status.
test("rejects coerced status enums and invalid change metadata", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ projects: [{ ...project, status: ["ready"] }], nextCursor: null }));
  await assert.rejects(listProjects("token"), /invalid/i);
  context.mock.method(globalThis, "fetch", async () => Response.json({ revision: { ...revision, fileChanges: [{ path: "app/page.tsx", status: ["M"] }] } }));
  await assert.rejects(getRevision(projectId, revisionId, "token"), /invalid/i);
});

// Unchanged files stay editable without badges, while deleted paths stay outside the snapshot.
test("workspace adapter distinguishes added, modified, unchanged and unknown legacy files", () => {
  const files = [{ path: "app/page.tsx", content: "saved" }, { path: "app/globals.css", content: "same" }, { path: "components/New.tsx", content: "new" }];
  const mapped = createWorkspaceFiles(files, [{ path: "app/page.tsx", status: "M" }, { path: "components/New.tsx", status: "A" }, { path: "components/Old.tsx", status: "D" }]);
  assert.deepEqual(mapped.map((file) => file.status), ["M", null, "A"]);
  assert.equal(mapped.some((file) => file.path === "components/Old.tsx"), false);
  assert.deepEqual(createWorkspaceFiles(files, null).map((file) => file.status), [null, null, null]);
});

// Status lookup is evidence only, and its response must belong to the requested attempt.
test("reads pending status and rejects a mismatched attempt ID", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ generation: { id: revision.generationId, status: "pending", hasSavedResult: true, errorCode: null } }));
  const pending = await getGeneration(projectId, revision.generationId, "token");
  assert.equal(pending.status, "pending");
  context.mock.method(globalThis, "fetch", async () => Response.json({ generation: { id: revision.generationId, status: "pending", hasSavedResult: true, errorCode: null } }));
  await assert.rejects(getGeneration(projectId, "300000000000000000000002", "token"), /invalid/i);
});
