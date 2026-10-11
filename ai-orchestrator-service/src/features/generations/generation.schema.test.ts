import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import {
  generationRequestSchema,
  validateManifest,
} from "./generation.schema.js";

test("accepts the small internal generation contract", () => {
  const request = generationRequestSchema.parse({
    requestId: "request-1",
    projectId: "66d123456789abcdef123456",
    prompt: "Build a clean developer portfolio page",
    template: "nextjs",
    mode: "economy",
  });

  assert.equal(request.template, "nextjs");
});

const initialRequest = {
  requestId: "request-1", projectId: "66d123456789abcdef123456",
  prompt: "Build a clean developer portfolio page", template: "nextjs", mode: "economy",
};
const baseFiles = [
  { path: "app/page.tsx", content: "export default function Page() {}" },
  { path: "app/globals.css", content: "body { color: black; }" },
];
const baseRevision = { id: "abcdef1234567890abcdef12", version: 1, files: baseFiles };
const summary = "Updated the requested frontend files.";

test("accepts a bounded selected snapshot without extra history or unknown context fields", () => {
  assert.deepEqual(generationRequestSchema.parse({ ...initialRequest, baseRevision }).baseRevision, baseRevision);
  for (const badBase of [
    { ...baseRevision, version: 0 }, { ...baseRevision, version: 1.5 },
    { ...baseRevision, version: Number.MAX_SAFE_INTEGER + 1 }, { ...baseRevision, id: "bad" },
    { ...baseRevision, files: [] }, { ...baseRevision, history: [] },
    { ...baseRevision, files: [{ path: "app/api/route.ts", content: "legacy unsafe" }] },
    { ...baseRevision, files: [baseFiles[0]!, { ...baseFiles[0]!, path: "app/Page.tsx" }] },
    { ...baseRevision, files: [{ path: "app/page.tsx", content: "x".repeat(30_001) }] },
  ]) assert.equal(generationRequestSchema.safeParse({ ...initialRequest, baseRevision: badBase }).success, false);
  assert.equal(generationRequestSchema.safeParse({ ...initialRequest, history: [] }).success, false);
});

test("bounds escaped JSON and UTF-8 context bytes instead of silently dropping files", () => {
  for (const character of ["\u0000", "界", '"']) {
    const oversized = { ...baseRevision, files: Array.from({ length: 4 }, (_, i) => ({ path: `lib/f${i}.ts`, content: character.repeat(30_000) })) };
    assert.equal(generationRequestSchema.safeParse({ ...initialRequest, baseRevision: oversized }).success, false);
  }
});

test("initial output remains compatible but cannot be empty or delete nonexistent files", () => {
  assert.deepEqual(validateManifest({ summary, files: baseFiles }).deletedPaths, []);
  assert.throws(() => validateManifest({ summary, files: [] }), /empty/);
  assert.throws(() => validateManifest({ summary, files: baseFiles, deletedPaths: ["components/Old.tsx"] }));
});

test("accepts deletion-only changes and complete upserts against the selected base", () => {
  const deletion = validateManifest({ summary, files: [], deletedPaths: ["app/globals.css"] }, baseFiles);
  assert.deepEqual(deletion.deletedPaths, ["app/globals.css"]);
  const update = validateManifest({ summary, files: [{ path: "app/page.tsx", content: "changed page" }] }, baseFiles);
  assert.equal(update.files.length, 1, "model output remains a change set, not a full snapshot");
});

test("rejects ambiguous deletes, case-only changes, no-ops and empty final projects", () => {
  for (const changes of [
    { files: [], deletedPaths: ["app/missing.tsx"] },
    { files: [], deletedPaths: ["app/Globals.css"] },
    { files: [], deletedPaths: ["app/globals.css", "app/globals.css"] },
    { files: [baseFiles[1]!], deletedPaths: ["app/globals.css"] },
    { files: [{ path: "app/Page.tsx", content: "changed" }] },
    { files: [], deletedPaths: ["../secret.ts"] },
    { files: [], deletedPaths: baseFiles.map((file) => file.path) },
    { files: baseFiles }, { files: [] },
  ]) assert.throws(() => validateManifest({ summary, ...changes }, baseFiles));
});

test("independently rejects server actions, path aliases and unsafe historical context", () => {
  for (const content of ['"use server"; export const x = 1;', "'use server';", '"use\\x20server";', "'use\\u0020server';"]) {
    assert.throws(() => validateManifest({ summary, files: [{ path: "app/page.tsx", content }] }));
    assert.equal(generationRequestSchema.safeParse({ ...initialRequest, baseRevision: { ...baseRevision, files: [{ path: "app/page.tsx", content }] } }).success, false);
  }
  for (const path of ["app//page.tsx", "app/./page.tsx", "app/page.tsx ", "app/../page.tsx", "lib/secret.ts", "app\\page.tsx", "app/route.ts"]) {
    assert.throws(() => validateManifest({ summary, files: [{ path, content: "content" }] }));
  }
  assert.throws(() => validateManifest({ summary, files: baseFiles }, [{ path: "app/api/route.ts", content: "old unsafe file" }]));
});

test("checks final merged count and content size, not only the returned upserts", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ path: `lib/f${i}.ts`, content: "old" }));
  assert.throws(() => validateManifest({ summary, files: [{ path: "lib/new.ts", content: "new" }] }, twelve));
  const full = Array.from({ length: 4 }, (_, i) => ({ path: `lib/f${i}.ts`, content: "x".repeat(30_000) }));
  assert.throws(() => validateManifest({ summary, files: [{ path: "lib/new.ts", content: "new" }] }, full), /size/);
});

test("HTTP boundary rejects unauthorized, unsafe and oversized context without calling a model", async () => {
  process.env.INTERNAL_SERVICE_TOKEN = "slice-three-ai-fixture-token";
  process.env.AI_GATEWAY_API_KEY = "slice-three-not-a-real-provider-key";
  process.env.AI_MODEL = "fixture/not-a-real-model";
  const { createApp } = await import("../../app.js");
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/generations`;
    const post = (body: unknown, token = "slice-three-ai-fixture-token") => fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal-service-token": token },
      body: JSON.stringify(body),
    });
    assert.equal((await post(initialRequest, "wrong-token")).status, 401);
    assert.equal((await post({ ...initialRequest, baseRevision: { ...baseRevision, files: [{ path: "app/api/route.ts", content: "unsafe" }] } })).status, 400);
    // This fits the parser but exceeds the serialized-context ceiling.
    const quoted = { ...baseRevision, files: Array.from({ length: 4 }, (_, i) => ({ path: `lib/f${i}.ts`, content: '"'.repeat(30_000) })) };
    const contextError = await post({ ...initialRequest, baseRevision: quoted });
    assert.equal(contextError.status, 413);
    assert.equal((await contextError.json()).code, "CONTEXT_TOO_LARGE");
    assert.equal((await post({ ...initialRequest, padding: "x".repeat(270_000) })).status, 413);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("accepts safe frontend files", () => {
  const manifest = validateManifest({
    summary: "Created a responsive portfolio landing page.",
    files: [{ path: "app/page.tsx", content: "export default function Page() {}" }],
  });

  assert.equal(manifest.files[0]?.path, "app/page.tsx");
});

test("rejects backend routes and server actions", () => {
  assert.throws(() =>
    validateManifest({
      summary: "This output tries to create backend behavior.",
      files: [
        {
          path: "app/api/users/route.ts",
          content: '"use server"; export async function POST() {}',
        },
      ],
    }),
  );
});

test("rejects duplicate file paths", () => {
  assert.throws(
    () =>
      validateManifest({
        summary: "This output contains the same frontend file twice.",
        files: [
          { path: "app/page.tsx", content: "export default function Page() {}" },
          { path: "app/page.tsx", content: "export default function OtherPage() {}" },
        ],
      }),
    /same file twice/,
  );
});
