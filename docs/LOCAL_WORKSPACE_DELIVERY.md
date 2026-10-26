# Local conversational workspace — delivery and verification

This is a localhost student showcase, not a full Cursor clone or a public execution platform.
The goal is a real configured model producing useful frontend code, with saved revisions and local Preview.

## What changed

- One persistent composer handles greetings, questions, planning, essential clarification and explicit builds.
  An ordinary reply does not create a project. Errors retain the input; old responses cannot switch projects.
- The compact reference-style sidebar has a transcript, real activity, expandable run reports and one history/
  changes drawer. Removed sample terminal output, fake sample files and duplicate permanent panels.
- Project authenticates and loads selected source; AI returns a validated reply/clarify/build decision.
  Builds reuse existing request keys, immutable snapshots, merge/diff validation and restricted execution.
- One reviewed frontend-design skill is a real read-only tool call. It is local, bounded and license-attributed;
  it does not download arbitrary GitHub instructions or grant terminal access at runtime.
- Six reviewed public guidance snippets provide TF-IDF retrieval by default. Optional Google embeddings use
  a small in-memory cosine index. Sources, retrieval method, latency and reported usage appear in run reports.
- Eighteen reviewed routing scenarios and contract graders are available through `eval:conversation`.
  Listing them is free; `--live` is an explicit opt-in, not an automatic test-suite expense.
- Runtime and development dependency advisories received separate focused lockfile/frontend patches.
  A clean package audit is not a guarantee about application vulnerabilities or operating-system images.

## How to explain the design

**Why not send every message to generation?** A greeting/plan is not permission to create files. A single
structured model decision avoids a separate classifier service and preserves natural conversation.

**Why keep the services?** Auth owns identity, Project owns data/publication, AI owns model/output policy,
Execution owns restricted builds, and Next owns presentation. A UI bug did not justify rewriting them.

**Why a tiny vector index?** Six reviewed snippets do not need another database server. Lexical search is
the no-embedding-call baseline; semantic mode demonstrates real embeddings without claiming a vector DB.

**Why two kinds of tests?** Fixtures reproduce failures cheaply. Only the separately bounded live test can
show real model instruction following, generated compilation and browser interaction.

## Verification boundaries

| Check | Actual evidence |
| --- | --- |
| AI | 88 tests, typecheck and build passed after dependency updates. |
| Project | 40 unit, 40 HTTP/Mongo, 18 brief, 7 conversation and 5 deterministic gate tests passed; one opt-in Docker gate case skipped in that suite. Typecheck/build passed. |
| Execution/Auth | Execution 45 tests, typecheck/build and Auth build passed. |
| Frontend | 54 unit tests and final tooling lint passed; production build passed on Next 16.4.3. |
| Real Auth/Project/Mongo browser | Loop 5/5, recovery 7/7, state/races 9/9 passed. AI transport was deterministic; these do not prove model quality. |
| Browser-only UI | Greeting/plan, input retention, late-response rejection, revisions, Preview state and desktop/mobile fixtures passed. Screenshots inspected separately from provider evidence. |
| Harness guards | Ten live-admission/reporting/native-Fetch/network-diagnostic tests; eight launcher/demo tests; twelve native-command and eight actual selector-argument checks passed. No model request in these tests. |
| Semantic provider smoke | Two real Google embedding requests ranked accessibility guidance first for a keyboard-accessibility query. Usage unavailable remained null; no fabricated zero-token/cost claim. |

Ignored local reports include `verification-1793017174409.json` (loop),
`verification-1793017334046.json` (recovery), `verification-1793017432333.json` (state), under
`output/playwright/`. Each reports successful scoped cleanup. Provider/Preview results are recorded
separately; fixture tests are not substituted for them.

## Successful real-provider flow — 2026-10-26

`conversation-live-1793025589050.json` reports **passed: true**, using the configured direct Google
`gemini-3.5-flash-lite`, real Auth/Project/AI/Execution modules, dedicated MongoDB and an actual browser.
No model response, generated file, build or Preview was replaced by a fixture.

1. Greeting and planning received real replies and created zero projects/generations.
2. An explicit portfolio request generated `app/globals.css`, `app/page.tsx` and `components/Counter.tsx`.
   A real Docker candidate build passed before immutable v1 publication.
3. A separate Preview build rendered the exact heading **Local AI Portfolio**. Clicking the real React
   button changed **Count 0 → Count 1**. The iframe sandbox was exactly `allow-scripts`.
4. Stop/close and refresh restored v1 without another generation request.
5. The follow-up used selected v1 and changed only `app/page.tsx` to **Hello, Future AI Engineer**.
   v2 retained v1 as parent, a fresh candidate-build proof, unchanged CSS/Counter and byte-identical v1.
6. v2 Preview showed the requested heading and working counter; Stop/close/refresh restored v2.
   The scenario observed exactly four conversation POSTs and two generation POSTs, no uncaught page
   errors and no external asset requests. Eight provider HTTP requests all returned 200 (each generation
   used one skill-selection call and one structured-file call).

Both candidate and Preview builds used trusted image
`sha256:463d53607318dd522625e021ec9342722bfe3dd57f377cd5d67f14789b22cf24`.
The report confirms zero remaining fixture users/projects/revisions/generations/briefs/conversations
and zero Preview-labelled containers. v1/v2 and restored-sidebar screenshots were visually inspected;
they remain ignored local artifacts under `output/playwright/`.

### Provider usage, including failed diagnostics

The successful flow reported **14,096 input / 5,263 output tokens**. At the reviewed standard paid rates
of $0.30/$2.50 per million, that is approximately **$0.0173863**, not an invoice or a claim about this
account's free-tier eligibility. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).

Across the saved conversation-run ledgers and the isolated generation diagnostic: **29 inference
attempts**, 28 HTTP 200s, one transport attempt with unknown usage. Known totals were 27,476 input /
14,421 output tokens (approximately $0.0442953 at those paid rates). Conservative pre-call reservations
totalled $0.2713507; these are estimates, not account billing guarantees. Two additional embedding
requests had unavailable usage and are not included in that inference-token estimate. No automatic
paid repair/fallback was enabled; failed attempts above are not concealed or counted as passing flows.

## Failures investigated, not hidden

1. Fetch blocks AI port 6000 even when an ordinary HTTP probe succeeds. Defaults/templates now use 6001
   and reject the blocked configuration at startup.
2. Browser navigation could apply a late build decision to an old project; creation failure could discard
   the original input. Account/URL guards and retaining text until acceptance fixed both regression cases.
3. Windows PowerShell split quoted inline browser selectors into extra arguments. Equivalent quote-safe
   selectors and exact native-argv tests fixed the wrapper; the complete real-service loop subsequently passed.
4. Two live attempts each made two successful conversation calls, then the verifier failed before generation.
   The first error was discarded. Added checkpoint reporting exposed the resumed failure: the persisted-read
   helper incorrectly called native Fetch's `ok`/`status` properties as Playwright methods. A zero-network
   regression reproduced the error, then verified the corrected 200/404 paths. Neither failed attempt is
   generation/Preview proof; both cleaned up successfully.
5. Docker Desktop stopped during verification, interrupting an image build and database tests. The engine
   and an explicitly labelled disposable Mongo container were restarted, then affected checks rerun.
6. After fixing Fetch handling, the live flow reached the real skill tool, but the final generation request
   failed before HTTP response headers. The old ledger did not retain its connection code; safe diagnostic
   fields were added rather than logging provider messages/keys. A separate two-request production-function
   diagnostic successfully returned validated portfolio code. This alone is not Preview proof and does not
   establish the precise cause of the earlier transport failure.
7. A later candidate failed with `TS2305`: `app/layout.tsx` imported Next's `Metadata` type from React.
   The gate rejected it and published no revision. Retained compiler/source evidence identified the error;
   an offline synthetic copy with only that import corrected built successfully. This manual diagnostic
   correction is not counted as model success. Generation now prefers 1-3 files and the existing trusted
   root layout, with explicit type-import guidance for requested custom layouts. Actual model behavior
   still requires the separate live result below.

## Run it yourself

Use [the normal Compose plus host-Preview setup](LOCAL_DOCKER.md#real-local-preview-one-additional-host-terminal),
not `demo:local`, to exercise real AI. Existing `.env` files stay local; configure a supported provider/key/
model, matching Auth/Project access secrets and Project/AI internal tokens. Rebuild images after pulling:
source edits do not update an already-running Docker image.

The normal frontend is **http://localhost:3001/workspace** after startup. Register an account in its database;
there is no shared default password. Keep provider/account caps enabled and do not paste keys into chat.
Before recording a demo, close `.env` and provider-key dashboard tabs so secrets do not enter the video.

An opt-in isolated live verification uses the existing configured Google connection, a dedicated empty
local `agentforge_test_*` database, a trusted runner and browser CLI:

```powershell
$env:AGENTFORGE_TEST_MONGODB_URI='mongodb://127.0.0.1:27029/agentforge_test_my_live_check'
$env:PREVIEW_RUNNER_IMAGE='agentforge-preview-runner:local'
$env:AGENTFORGE_BROWSER_CHANNEL='msedge'
npx tsx scripts/verify-conversation-live.mts --execute --allow-live
```

Without both flags it reads no credentials and makes no inference calls. The harness allows at most ten
requests for the explicitly price-reviewed model and reserves at most $0.60 conservatively before calls.
This is a test guard, not a hard provider-account billing limit. Do not rerun a failed live test blindly.

## Honest remaining learning backlog

No per-token streaming, MCP, Python/SQLite evaluation pipeline, general private-project ingestion,
persistent vector database, held-out model comparison, durable queue/restart automation or AI repair is
claimed. There is no arbitrary shell, interactive terminal, public Kubernetes or production multi-tenant
sandbox. Preview supports static React/Next.js/plain CSS, not arbitrary packages, API routes or SSR.
Chat display memory is bounded and same-browser/account-scoped, not a durable cross-device conversation DB.

These can be future focused learning slices; they are not silently described as finished features.
