import assert from "node:assert/strict";
import test from "node:test";

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
