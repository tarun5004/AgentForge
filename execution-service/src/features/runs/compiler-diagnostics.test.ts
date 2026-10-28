import assert from "node:assert/strict";
import { test } from "node:test";
import { compilerDiagnostics } from "./compiler-diagnostics.js";

const files = [{ path: "app/page.tsx" }, { path: "components/Card.tsx" }];

test("compiler feedback keeps only known paths, coordinates and fixed categories", () => {
  const feedback = compilerDiagnostics("\u001b[31m./app/page.tsx:12:7\u001b[0m\nType error: PRIVATE_TOKEN is not assignable\n" +
    "components/Card.tsx(4, 2): error TS2322: PRIVATE_SOURCE", files);
  assert.deepEqual(feedback, [
    { path: "app/page.tsx", line: 12, column: 7, category: "typescript", code: null },
    { path: "components/Card.tsx", line: 4, column: 2, category: "typescript", code: "TS2322" },
  ]);
  assert.doesNotMatch(JSON.stringify(feedback), /PRIVATE|assignable/);
});

test("unrecognized and external paths cannot leak arbitrary diagnostic text", () => {
  const feedback = compilerDiagnostics("/host/private/app/page.tsx:1:2\n.env:2:3\nSECRET arbitrary log", files);
  assert.deepEqual(feedback, [{ path: null, line: null, column: null, category: "compile", code: null }]);
});

test("module and syntax labels contain no quoted imports or compiler source", () => {
  const feedback = compilerDiagnostics("./app/page.tsx\nModule not found: Can't resolve 'SECRET'\n" +
    "components/Card.tsx:2:1\nSyntax error: Unexpected token SECRET", files);
  assert.equal(feedback[0]?.category, "module");
  assert.equal(feedback[1]?.category, "syntax");
  assert.doesNotMatch(JSON.stringify(feedback), /SECRET|resolve|Unexpected/);
});

test("feedback deduplicates locations, caps rows and scans only the bounded log tail", () => {
  const output = Array.from({ length: 20 }, (_, i) => `app/page.tsx:${i + 1}:1\nType error: private`).join("\n");
  assert.equal(compilerDiagnostics(output, files).length, 8);
  assert.equal(compilerDiagnostics("app/page.tsx:1:2\napp/page.tsx:1:2", files).length, 1);
  assert.equal(compilerDiagnostics(`app/page.tsx:1:2\n${"x".repeat(4_100)}`, files)[0]?.path, null);
});
