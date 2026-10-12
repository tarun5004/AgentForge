# AgentForge V1 — Testing Strategy

## Pagination and protected-401 recovery (2026-10-12)

Story: real Next/React UI → load-more buttons → mocked cursor pages → deduplicated ordered lists → one protected `401` → cached identity cleared → login, without bouncing back.

```powershell
# From repository root, with Next running:
npm run test:browser-history
# Dedicated local test port:
npm run test:browser-history -- -BaseUrl http://localhost:3102
```

- **Executed:** project pagination, revision pagination and protected-401 recovery pass (3 scenarios, 5 ordered checkpoints). Exact `cursor=project-page-2` and `beforeVersion=2` requests are checked. Deliberately overlapping fixture pages verify defensive deduplication; this does not claim the real backend returns overlaps. Exhausted pagination controls disappear and history stays v3, v2, v1.
- **Regression reproduced before fixing:** both pagination checks passed, then the 401 assertion failed. Server logs showed repeated `/login` and `/workspace` requests: Project error handling redirected while AuthForm still saw a cached user. The fix adds stable `AuthProvider.invalidateSession`, passed through WorkspaceShell to the workspace error handler. It clears only client user/token before redirect; server auth/JWT/cookies and explicit logout remain unchanged.
- **After fixing:** the clean history run passed with exactly one rejected protected read, zero unexpected API requests/page errors, and no workspace prompt on login. Screenshots `output/playwright/workspace-history-ba78615d-pagination.png` and `workspace-history-ba78615d.png` were inspected. All test browsers and the dedicated Next server were stopped.
- The malformed-link suite was rerun after shared-runner/auth changes: 3/3 passed. Frontend unit tests 9/9, lint, production build, snippet/PowerShell syntax checks and diff checks passed. One interim browser run was reset by a code-edit Fast Refresh; console evidence confirmed a full reload. The documented clean run used frozen application code, not an ignored failure.

These are **mocked-transport UI regression checks**, not real JWT expiry/cookie rotation, ownership, MongoDB pagination or paid-provider verification. All `/api/**` traffic is intercepted before navigation; writes/unknown paths fail closed. No new package or lockfile change, no backend application edits, no `.env` changes or normal database writes. Cross-owner, legacy/deleted-link, broader expiry matrices and automated real-service persistence still remain; M1 is not marked fully accepted. See the frontend README for Windows setup and both runner commands.

## Repeatable malformed-link UI smoke (2026-10-12)

Story: browser opens an invalid workspace selection → real Next page/query parsing → mocked session/list transport → disabled empty/error UI → New conversation → usable empty draft.

From the repository root, with Next already running:

```powershell
npm run test:browser-links
# Dedicated test port alternative:
npm run test:browser-links -- -BaseUrl http://localhost:3102
```

Requires Windows PowerShell, standard Node.js/npm and Chrome available to pinned Playwright CLI `0.1.22`. No application/test-framework dependency or lockfile change. See the frontend README for setup, artifacts and server shutdown instructions.

- **Executed:** 3/3 real-browser scenarios pass: malformed project ID, duplicate project query values, and revision without project. Every scenario verifies disabled prompt/submission, no generated/demo file tabs, error removal and empty-draft recovery through a fresh snapshot's New conversation button ref. A harmless draft enables Send; it is never submitted.
- Refresh/list responses are **mocked** before navigation. All other `/api/**` calls abort and increment a failure counter; no unexpected calls or uncaught page errors occurred. Separate invalid/recovery counters require exactly three of each, preventing unexpected redirects from becoming false passes.
- The external-URL guard was exercised with `https://example.com`: exit 1, before starting a browser or contacting that site. Browser assertion failures also exited 1 during development; each opened test session closed through `finally`.
- Frontend tests 9/9, lint, production build and `git diff --check` passed. The final empty-editor screenshot was inspected under ignored `output/playwright/workspace-links-dc99cd9f.png`. The dedicated Next server and test browsers were stopped after verification.

This is automated **mocked-transport UI** coverage, not real authentication/ownership, database persistence or provider evidence. No database, paid model request, credentials or `.env` edits were used. Real-service manual evidence remains separately documented below; backend suites were not rerun for this test-only slice. Remaining automation includes pagination, cross-owner/auth-expiry, legacy/deleted-link cases and the full real-service revision loop. M1 is not marked fully accepted.

## Review follow-up: safe fixture shutdown (2026-10-12)

PR #2 review identified outdated dependency instructions and a cleanup-error path that skipped database disconnect. The small follow-up changes test tooling/docs only, not application services.

- `npm run test:fixture-cleanup`: 4/4 tests pass for normal cleanup, cleanup failure, disconnect failure and combined failures with sanitized logging. `finally` attempts disconnect on every cleanup outcome; failure returns a nonzero exit status rather than an unhandled rejection.
- A failure-path child process exited with status 1. A real fixture start/shutdown against an initially empty dedicated database exited 0 and reported zero remaining records. No unconditional `process.exit()` is needed on the tested normal path: closing HTTP servers and disconnecting Mongo allows natural exit without truncating output.
- Existing frontend checks were rerun before merge: 9/9 tests, lint and production build passed. Project's real HTTP/Mongo regression suite passed 40/40 on the explicit `agentforge_test_merge_20261012` database.
- Separate read-only probes confirmed zero remaining users/projects/revisions/generations in both `agentforge_test_merge_20261012` and `agentforge_test_cleanup_20261012`. Normal databases were not used; no database was dropped or deletion filter widened.

The helper tests use callbacks, not a real database outage. Active-connection hangs/real network partitions and the broader repeatable browser acceptance suite remain unverified. Cleanup error messages intentionally omit raw database errors/credentials. Git instructions now identify backend PR #1 as merged and frontend PR #2 as targeting `main`.

## Slice 5 frontend verification (2026-10-12)

Branch: `feature/frontend-project-history`, explicitly stacked on `feature/project-service-revision-publication`. No backend application code changed; no runtime/dev dependency was added. Commit/push delivery was subsequently explicitly requested; PR/merge remain separate actions. Repository instruction changes are delivered separately; unrelated user `.github/` work is preserved.

Story: browser session restoration → real Next rewrites → owned Project API/Mongo snapshot reads → selected-base generation via deterministic AI transport → committed snapshot rendering/reload.

| Check | Actual evidence |
| --- | --- |
| Frontend local tests | 9 API/URL/storage/file-adapter tests; first API suite was observed failing on missing exports before implementation. |
| Frontend lint/typecheck/build | Passed, exit 0; `/workspace` builds as a request-time dynamic route because page searchParams are awaited. |
| Real browser Auth | Registered/logged in through actual Auth API; HttpOnly refresh-cookie restoration returned 200 after hard refresh. |
| Persistence loop | Created v1, refreshed, generated v2 from v1, refreshed v2, reopened original v1 and checked original content. Driver reads independently confirmed immutable parent/version records. |
| Truthful files | v2 preserved omitted CSS, recorded page M and component D, removed the deleted tab and gave unchanged CSS no badge. No-selection editor showed an actual empty state, not demo files. |
| Responsive request identity | During a delayed follow-up, desktop → 390px mobile reflow kept submission/selection controls frozen and committed the same v2. |
| AI failure | An invalid-output follow-up returned 502; the visible old revision/content remained available and no new revision was inserted. |
| Lost response/replay | Browser intercepted a real committed POST and aborted its response. After hard refresh, stored intent was restored and replay returned the same v3. AI fixture call count stayed at 4, not 5. |
| Status reconciliation | Browser replaced another real committed POST acknowledgement with 503 containing its generation ID; explicit Check status fetched committed v3 without another model call. |
| Stale selection | A barrier-delayed real project A GET finished after selecting B; B's URL/heading/files remained selected. |
| Post-commit reload failure | Mocked GET 503s after a real successful POST left committed files visible; Retry loading recovered canonical history. No false generation-failed label. |
| Database evidence | Two real owned projects, six revisions and one failed attempt; parentage included intentional historical v3→v1 and linear v3→v2. Seven deterministic AI requests, no paid model calls. |

Browser verification used Playwright CLI with actual Next/Auth/Project services and MongoDB, not browser-only response mocks. Only AI transport and deliberate browser fault/delay points were fixtures. Both API apps are composed in one test process against the isolated database; that is test composition, not a production service-layout change. These are executed CLI browser checks, **not a checked-in CI Playwright acceptance suite**. Screenshots were inspected at `output/playwright/history-desktop-slice5-20261012.png` and `history-mobile-slice5-20261012.png` (ignored artifacts). A CLI browser session ended once; reopening and real fixture login allowed the remaining checks to proceed.

The test DB `agentforge_test_frontend_20261012` was checked empty before importing apps/creating indexes. Fixture shutdown removed only its explicitly named account and owner-scoped projects/generations/revisions, never dropped a DB. A separate read-only probe confirmed zero remaining users/projects/revisions/generations. Normal data, credentials, provider configuration and `.env` files are untouched; the browser and dedicated test servers were stopped. Test fixtures can be recreated using the commands below.

### Reproduce the safe browser composition

From the repository root, terminal 1 (requires local MongoDB and an **empty** dedicated test DB):

```powershell
$env:AGENTFORGE_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/agentforge_test_frontend_local'
npx tsx tests/frontend-history.fixture.mts
```

Terminal 2, repository root:

```powershell
$env:AUTH_SERVICE_URL = 'http://127.0.0.1:4310'
$env:PROJECT_SERVICE_URL = 'http://127.0.0.1:4311'
npm --workspace nextjs-boilerplate run dev -- --port 3101
```

Open `http://localhost:3101/register`; use only fixture email `frontend-slice5-20261012@agentforge.test` and a disposable test password. Create a page; refresh; request a targeted change; refresh/reopen an older version. A prompt containing `remove old` deletes the test component; `slow` delays the fixture response; `invalid output` produces a rejected change. Read `http://127.0.0.1:4312/__fixture` for safe prompt/base-version call evidence. Finish with:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4312/__fixture/shutdown'
```

Stop the dedicated Next test server too. Do not use normal service `.env` database settings for this fixture. Runtime unit tests may print Node's informational module-detection warning. The dev server used fallback fonts when Google Fonts was unreachable; this did not break the flow. Expected console/network errors came from unauthenticated initial refresh and deliberately injected 502/503/aborted responses, not uncaught React errors.

Remaining gaps: full automated browser suite/CI, large list/history pagination UI, browser cross-owner and auth-expiry matrix, legacy/malformed/deleted-link UI matrix, disabled-storage refresh recovery, real crashes/partitions, accessibility automation, provider quality/cost smoke, generated-code build/execution and deployment. Earlier backend owner/race tests remain historical evidence, not rerun claims for this frontend turn. M1 is not marked fully accepted until remaining mandatory browser cases are automated/proven.

## Slice 4 verification (2026-10-12)

Current changes are scoped to `feature/project-service-revision-publication`. No other service application files or dependencies changed.

| Command | Actual result |
| --- | --- |
| `npm run test --workspace=project-service` | 25/25 local unit/contract tests pass. Adds exact Revision-version duplicate classification. |
| `npm run test:integration --workspace=project-service` | 40/40 real HTTP/Mongo tests pass in two consecutive final runs. |
| `npm run typecheck --workspace=project-service` | Passed, exit 0. |
| `npm run build --workspace=project-service` | Passed, exit 0. |
| `npm run test --workspace=ai-orchestrator-service` | 14/14 existing regression tests pass; AI application code unchanged. |

Integration coverage adds owned historical-base forwarding, persisted parent/prompt/full snapshots/A/M/D, omitted-file preservation, explicit/deletion-only changes, immutable prior snapshot checks, read-only owned generation status and POST replay using Revision metadata despite missing Generation result. Barriers driven by observed fixture events verify same-key follow-ups (one model call) and distinct-key initial/follow-up races (one publication and one conflict at the captured version). It also verifies saved-result concurrent publication retry without another model call, no version reservation on failure, safe old-file availability, invalid/serialized-oversize legacy context rejected before paid work, and legacy incomplete intent never assigned a guessed version.

Test-only narrow Mongoose method fault injection covers result save failing before/after acknowledgement, Revision insert failing before commit, actual insert followed by lost acknowledgement, reconciliation-read failure, and post-insert bookkeeping failures. Real controllers/repositories/Mongo still run; only the deliberate fault point or localhost AI network response is replaced. These tests prove recovery paths, **not real process-kill or network-partition behavior**. No production fake-provider mode or generic dependency-injection framework was introduced.

Three focused tests were first observed failing against the old gated API/missing metadata/status route, then passed after implementation. A race fixture initially reused unchanged root output and correctly hit the no-op rejection; resetting that test fixture made its intended conflict scenario valid.

The initially empty local `agentforge_test_slice4_20261012` database was positively identified by a bounded read-only driver probe before fixture writes. Standalone topology was confirmed. Verification never imported models against the normal DB, migrated application records, or changed normal indexes. The final read-only probe confirmed zero Project/Revision/Generation fixture records and installed unique Revision `generationId`/`(projectId, version)` plus Generation `(projectId, idempotencyKey)` indexes. Indexes remain only in the dedicated test DB; no database was dropped.

Not run: paid-provider smoke/quality, frontend/browser restoration or full revision-loop E2E, real crash/partition experiments, generated-code build/execution, performance/load benchmarks, dependency-security audit or deployment. Project Service build compiles the platform service; it does not build generated projects. M1 remains incomplete pending frontend integration and browser proof.

## Slice 3 verification (2026-10-12)

- `npm run test --workspace=project-service`: 24 passing local unit/contract tests, including a localhost AI transport fixture. Coverage adds immutable complete snapshots, deterministic A/M/D, omitted-file preservation, deletion-only output, invalid/no-op/empty changes, canonical frontend paths, final count/content limits, request-ID correlation, old initial responses, and escaped/UTF-8 request-byte limits before fetch.
- `npm run test --workspace=ai-orchestrator-service`: 14 passing schema/prompt/HTTP checks. The HTTP app rejects wrong internal tokens, unsafe bases, oversized serialized context, and parser-sized bodies without making a model call. Prompt tests verify exactly the selected snapshot, escaping and no unrelated history. Generated manifests are checked independently against the same file/deletion policy.
- `npm run test:integration --workspace=project-service`: 27 passing real HTTP/Mongo regressions. Two added cases prove new internal metadata preserves initial public/stored/replayed snapshots and unsafe/mismatched model output creates no Revision. Existing owner isolation, legacy reads/replays and same-key concurrency regressions still pass.
- Both affected services' typecheck and build commands passed. New merge/prompt tests were observed failing on missing modules before implementation. No dependency was added and the installed AI SDK's bundled documentation/source was checked rather than guessing APIs.

Mongo tests use the positively identified, initially empty local `agentforge_test_slice3_20261012` database. Cleanup is fixture-scoped; no normal application records are used. Local HTTP fixtures are not a real provider smoke. Browser UI, provider quality, complete public follow-up publication, different-key publication conflicts, crash recovery, and generated-code builds/execution remain unverified/outside this slice. Historical results below retain their original dates/counts.

## Slice 2 verification (2026-10-11)

The existing commands below now run **11 unit tests** and **25 HTTP/Mongo/service integration tests**. The latest typecheck/build passed. The final integration suite passed three consecutive runs after adding a deterministic stale-snapshot regression. The new request-helper suite initially failed because the module did not exist; six focused integration cases initially failed for missing identity/replay behavior. Oversized-body and stale-pending-snapshot regressions were also observed failing before their fixes. Typecheck caught test-only undefined-array access and widened status-literal issues; both were corrected before commit.

Added coverage: canonical prompt/base fingerprints, strict body/key validation, exact duplicate-index classification against a real Mongo error, complete initial/replay response equality, changed-input mismatch, eight simultaneous same-key requests producing one Generation/Revision/fixture AI call, legacy empty-body replay, saved revisions overriding stale ready/pending/failed bookkeeping, metadata reread after an older pending snapshot, missing metadata/revision uncertainty, failed-attempt handling, safe follow-up gating, foreign-project/base hiding, and correct 413 oversized-JSON behavior.

A fresh, positively identified local `agentforge_test_slice2_*` database was used; normal application data was not used. Test indexes remain, and only known fixture records are cleaned. Provider transport is still a localhost test fixture: no paid provider, real generation quality, browser/frontend loop, different-key publication race, or crash/saved-result publication recovery is verified by this slice. Those require the later approved work. No new dependency was installed.

## Implemented Slice 1 checks (2026-10-10)

The remaining sections describe future V1 coverage. Slice 1 uses existing Node test/tsx tooling; no new package or production test-provider mode was added.

From the repository root:

```powershell
npm run test --workspace=project-service

# Set this explicitly to your separate local agentforge_test_* database.
# Never copy MONGODB_URI from the application's .env for testing.
$env:AGENTFORGE_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/agentforge_test_slice1_local'
npm run test:integration --workspace=project-service

npm run typecheck --workspace=project-service
npm run build --workspace=project-service
```

Integration tests fail closed if `AGENTFORGE_TEST_MONGODB_URI` is missing. The test URI must use a localhost/127.0.0.1 `mongodb://` endpoint, an explicit `agentforge_test_*` database, and no credentials or URI options. Verify the database is dedicated to these fixtures before running. The tests do not fall back to application dotenv settings. Test secrets/configuration are assigned before importing the app. Use one run per dedicated database; fixtures use deterministic IDs and are not intended for overlapping runs sharing a database.

Tests run the real Express Project API against real MongoDB. A localhost HTTP fixture replaces only the AI Orchestrator network boundary for the unchanged initial-generation regression check; it is not model-quality or real-provider evidence. Cleanup targets only known fixture project IDs and their revisions/generations, never `dropDatabase` or a normal application database. Collections/indexes remain in the isolated test database.

| Actual check | Result |
| --- | --- |
| Baseline Project typecheck | Passed before edits. |
| Initial project integration RED | 7 failures: GET routes were absent (404 instead of expected protected/read responses). |
| Initial validation RED | Missing validation module, as expected. |
| Response-bound RED | Oversized project metadata returned 200 instead of 413 before the guard existed. |
| Revision integration RED | 6 failures: revision GET routes were absent. |
| Revision validation RED | Missing `validateRevisionQuery` export, as expected. |
| `npm run test --workspace=project-service` | Passed, 5/5 unit tests. |
| `npm run test:integration --workspace=project-service` | Passed, 15/15 HTTP/Mongo integration tests. |
| Project typecheck and build | Passed, exit 0. |
| Diff/staged-diff whitespace and scope checks | Passed before each implementation commit. |
| Final isolated DB record-count probe | Zero Project, Revision, and Generation records remained. |

The unit tests cover strict IDs, canonical cursors/defaults/limits, rejection of unknown/non-scalar query input, positive safe-integer history boundaries, and UTF-8/JSON-escape byte limits. HTTP tests cover all four routes' missing/invalid/expired authentication, owner-only data, same-timestamp project pagination, one batched latest query rather than N+1, latest derived from saved revisions despite stale status/counters, missing/foreign 404s, empty pages, newest-first history and exclusive boundaries, exact saved files, unknown/recorded provenance, GET immutability, private-field/file-summary exclusion, and oversized legacy responses. Existing project creation and initial generation remain readable; replay preserves the saved revision identity and makes no second fixture AI call.

No frontend, browser, paid-provider, load benchmark, dependency-security audit, transaction, follow-up, or generation-publication race suite was run for this slice. Existing generation replay formatting/publication behavior is not redesigned or fully validated here. An existing Mongoose `new`-option deprecation warning appeared on the generation path and remains outside the read-API change.

## 1. Test pyramid

| Layer | Focus | Examples |
| --- | --- | --- |
| Unit | pure logic | token budget, router policy, file-path validation |
| Service | business rules | ownership, revision state transitions, refresh rotation |
| Contract | API compatibility | OpenAPI request/response validation |
| Integration | real dependencies | Mongo repositories, Redis queue, provider adapter fakes |
| E2E | critical user flow | sign in -> generate -> validate -> run -> view logs |
| Security | abuse resistance | IDOR, malicious file manifest, runner policy rejection |

## 2. Required coverage

- Auth: registration, duplicate email, bad password, refresh rotation, revoked session.
- Project: ownership, pagination, revision immutability, idempotency.
- AI: model policy, fallback only on eligible failures, token cap, output schema validation.
- Execution: trusted runner only, timeout, cancellation, cleanup, log redaction.
- Web: loading/error/empty states, accessible labels, no browser-visible secret.

## 3. Test data rules

- No production credentials or personal data.
- Provider adapters default to deterministic fixtures in CI.
- One separately marked smoke test may call a real provider with a dedicated low-budget test key.
- Seed data is repeatable and cleared by test database isolation, not production collection deletion.

## 4. Quality gates

Pull requests must pass formatting, lint, typecheck, unit tests, contract tests, vulnerability scan, and container/Kubernetes manifest policy scan. Staging E2E runs before manual demo release.
