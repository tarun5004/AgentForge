import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWorkspaceSelection, workspaceUrl } from "./workspace-selection.ts";
import { readPendingGeneration, savePendingGeneration, clearPendingGeneration } from "./pending-generation.ts";

const projectId = "100000000000000000000001";
const revisionId = "200000000000000000000001";

// Links carry selection IDs only; repeated or malformed query values cannot become paths.
test("validates empty, project-only, revision and malformed workspace links", () => {
  assert.deepEqual(parseWorkspaceSelection({}), { projectId: null, revisionId: null, error: "" });
  assert.equal(parseWorkspaceSelection({ project: projectId }).projectId, projectId);
  assert.equal(parseWorkspaceSelection({ project: projectId, revision: revisionId }).revisionId, revisionId);
  for (const query of [{ project: "javascript:x" }, { project: [projectId, projectId] }, { revision: revisionId }]) assert.ok(parseWorkspaceSelection(query).error);
  assert.equal(workspaceUrl(projectId, revisionId), `/workspace?project=${projectId}&revision=${revisionId}`);
});

// Recover intent across refresh without storing files or session credentials.
test("pending intent is user/project-scoped, bounded and safe when storage fails", (context) => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) }, configurable: true });
  context.after(() => Reflect.deleteProperty(globalThis, "sessionStorage"));
  const intent = { projectId, key: "same-key", body: { prompt: "Make the hero darker", baseRevisionId: revisionId } };
  savePendingGeneration("user-a", intent);
  assert.deepEqual(readPendingGeneration("user-a", projectId), intent);
  assert.equal(readPendingGeneration("user-b", projectId), null);
  data.set(`agentforge:pending:v1:user-a:${projectId}`, JSON.stringify({ ...intent, body: { ...intent.body, files: [] } }));
  assert.equal(readPendingGeneration("user-a", projectId), null);
  clearPendingGeneration("user-a", projectId);
  assert.equal(data.size, 0);
  Object.defineProperty(globalThis, "sessionStorage", { get: () => { throw new Error("disabled"); }, configurable: true });
  assert.doesNotThrow(() => savePendingGeneration("user-a", intent));
  assert.equal(readPendingGeneration("user-a", projectId), null);
});
