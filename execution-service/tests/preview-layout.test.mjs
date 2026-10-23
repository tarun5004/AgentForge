import assert from "node:assert/strict";
import { test } from "node:test";
import { createFallbackLayout } from "../preview/layout.mjs";

// Saving CSS alone does not include it in Next's module graph; the scaffold must import it.
test("fallback layout imports the saved global stylesheet when present", () => {
  const layout = createFallbackLayout([{ path: "app/page.tsx" }, { path: "app/globals.css" }]);
  assert.match(layout, /^import "\.\/globals\.css";/);
  assert.match(layout, /<html lang="en"><body>\{children\}<\/body><\/html>/);
});

// A page-only snapshot must not fail its build on a nonexistent CSS import.
test("fallback layout works without a global stylesheet", () => {
  const layout = createFallbackLayout([{ path: "app/page.tsx" }]);
  assert.doesNotMatch(layout, /\.css/);
  assert.match(layout, /import type \{ ReactNode \} from "react"/);
});

// The user/model's own layout controls imports and structure; never silently rewrite it.
test("an existing root layout disables the fallback even when globals exist", () => {
  assert.equal(createFallbackLayout([{ path: "app/layout.tsx" }, { path: "app/globals.css" }]), null);
});

// Only the conventional exact path is automatic; modules/other styles remain explicitly imported.
test("fallback ignores differently cased and unrelated stylesheets", () => {
  const layout = createFallbackLayout([{ path: "app/Globals.css" }, { path: "app/page.module.css" }, { path: "components/globals.css" }]);
  assert.doesNotMatch(layout, /\.css/);
});
