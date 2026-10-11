import assert from "node:assert/strict";
import test from "node:test";

import { mergeRevisionFiles, validateRevisionFiles } from "./revision-files.js";

const base = [
  { path: "app/page.tsx", content: "export default function Page() { return <main>Old</main>; }" },
  { path: "app/globals.css", content: "body { color: black; }" },
  { path: "components/Old.tsx", content: "export default function Old() { return null; }" },
];

test("merges complete upserts and explicit deletions without changing the parent", () => {
  const before = structuredClone(base);
  const result = mergeRevisionFiles(base, {
    files: [
      { path: "app/page.tsx", content: "export default function Page() { return <main>New</main>; }" },
      { path: "components/Hero.tsx", content: "export default function Hero() { return null; }" },
    ],
    deletedPaths: ["components/Old.tsx"],
  });
  assert.deepEqual(base, before, "historical revision must remain unchanged");
  assert.deepEqual(result.files.map((file) => file.path), ["app/globals.css", "app/page.tsx", "components/Hero.tsx"]);
  assert.equal(result.files[0]?.content, base[1]?.content, "omitted CSS is preserved");
  assert.deepEqual(result.fileChanges, [
    { path: "app/page.tsx", status: "M" },
    { path: "components/Hero.tsx", status: "A" },
    { path: "components/Old.tsx", status: "D" },
  ]);
});

test("supports initial snapshots and deletion-only follow-ups", () => {
  assert.deepEqual(mergeRevisionFiles([], { files: [base[0]!] }).fileChanges, [{ path: "app/page.tsx", status: "A" }]);
  const result = mergeRevisionFiles(base, { files: [], deletedPaths: ["components/Old.tsx"] });
  assert.equal(result.files.length, 2);
  assert.deepEqual(result.fileChanges, [{ path: "components/Old.tsx", status: "D" }]);
});

test("rejects accidental, ambiguous and unsafe file operations", () => {
  for (const changes of [
    { files: [], deletedPaths: ["components/Missing.tsx"] },
    { files: [], deletedPaths: ["components/Old.tsx", "components/Old.tsx"] },
    { files: [base[2]!], deletedPaths: ["components/Old.tsx"] },
    { files: [{ path: "app/Page.tsx", content: "changed" }] },
    { files: [], deletedPaths: ["components/old.tsx"] },
    { files: [], deletedPaths: ["../secret.ts"] },
  ]) assert.throws(() => mergeRevisionFiles(base, changes));
});

test("rejects no-op and empty final snapshots, but does not badge unchanged upserts", () => {
  assert.throws(() => mergeRevisionFiles(base, { files: [] }), /No file changes/);
  assert.throws(() => mergeRevisionFiles(base, { files: base }), /No file changes/);
  assert.throws(() => mergeRevisionFiles(base, { files: [], deletedPaths: base.map((file) => file.path) }), /empty/);
  const result = mergeRevisionFiles(base, { files: [base[0]!, { path: "lib/theme.ts", content: "export const color = 'blue';" }] });
  assert.deepEqual(result.fileChanges, [{ path: "lib/theme.ts", status: "A" }]);
});

test("enforces generated frontend paths and server-action policy separately", () => {
  for (const path of ["app/api/x/route.ts", "app/route.ts", "lib/secret.ts", "app/../page.tsx", "app//page.tsx", "app/./page.tsx", "app/page.tsx ", "C:/app/page.tsx", "app\\page.tsx", "package.json"]) {
    assert.throws(() => validateRevisionFiles([{ path, content: "content" }]));
  }
  for (const content of ['"use server"; export const x = 1;', "'use server';", '"use\\x20server";', "'use\\u0020server';"]) {
    assert.throws(() => validateRevisionFiles([{ path: "app/page.tsx", content }]));
  }
  assert.throws(() => validateRevisionFiles([base[0]!, { ...base[0]!, path: "app/Page.tsx" }]), /same file twice/);
});

test("revalidates legacy bases and enforces final count and content limits", () => {
  assert.throws(() => mergeRevisionFiles([{ path: "app/api/route.ts", content: "unsafe legacy" }], { files: [base[0]!] }));
  assert.throws(() => validateRevisionFiles([{ path: "app/page.tsx", content: "x".repeat(30_001) }]));
  assert.throws(() => validateRevisionFiles(Array.from({ length: 5 }, (_, i) => ({ path: `lib/f${i}.ts`, content: "x".repeat(30_000) }))), /size/);
  const twelve = Array.from({ length: 12 }, (_, i) => ({ path: `lib/f${i}.ts`, content: "original" }));
  assert.throws(() => mergeRevisionFiles(twelve, { files: [{ path: "lib/new.ts", content: "new" }] }));
  const full = Array.from({ length: 4 }, (_, i) => ({ path: `lib/f${i}.ts`, content: "x".repeat(30_000) }));
  assert.throws(() => mergeRevisionFiles(full, { files: [{ path: "lib/new.ts", content: "new" }] }), /size/);
});

test("input structures are strict and a valid snapshot is returned as independent plain data", () => {
  for (const files of [null, [], [{ path: "app/page.tsx", content: "" }], [{ ...base[0], extra: true }]]) {
    assert.throws(() => validateRevisionFiles(files));
  }
  assert.throws(() => mergeRevisionFiles(base, { files: [], ownerId: "browser-controlled" }));
  const result = mergeRevisionFiles(base, { files: [{ path: "lib/theme.ts", content: "new" }] });
  result.files[0]!.content = "changed locally";
  assert.equal(base[1]?.content, "body { color: black; }");
});
