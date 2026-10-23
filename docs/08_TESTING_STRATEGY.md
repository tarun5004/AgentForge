# AgentForge V1 — Testing Strategy

## Build-gated browser flow — 2026-10-23

Scope: `test/frontend-build-gate-e2e`, from merged build-gate main `0df5037`. No application-service/UI behavior, dependency, real `.env`, normal Compose or deployment change. Existing launcher/fixtures now support explicit opt-in `--suite build-gate`, with process-only fake service credentials and deterministic AI Orchestrator HTTP output. Old history/preview suites explicitly stay gate-off. The operator-selected existing runner image is validated and shared by preflight/fixture; no image is pulled/built by verification.

**Executed pass:** Edge, dedicated `agentforge_test_gate_browser_20261023_b84f`, trusted existing `agentforge-preview-runner:css-check`. Launcher exited 0; `output/playwright/verification-1792731826489.json` records build-gate pass, `buildGate: true`, `cleanup: true`, `containerCleanup: true`. Browser success log: `build-gate-browser-e2e.log`. Inspected ready screenshot `verification-24488-build-gate-ready.png` shows real exported CSS and interactive Count 1.

| Boundary | Actual evidence |
| --- | --- |
| Auth + submission | Real disposable registration/session, Enter prompt, owned Project/Generation stored. Not a direct login-form endpoint test. |
| Unpublished pending | A test-only pre-build barrier holds the real candidate check. POST returns 202 without files/revision ID; Mongo has one Generation and zero Revisions. Same-key replay joins that attempt without a second AI fixture call. |
| Build → publication | Real candidate read/authentication, pinned restricted Docker build/export/cleanup, stored proof and immutable v1. Browser GET polling selects ready only; persisted source/proof match the committed response. |
| Saved revision → preview | Actual run API loads the real saved revision. A second real build serves the interactive iframe; Count 0 → 1, body background `rgb(12, 34, 56)`, sandbox exactly `allow-scripts`. Candidate artifacts are not reused. |
| Failure + refresh | Hard refresh restores v1/proof/session. A second AI fixture response contains invalid TSX; its real candidate build fails. No v2 is published; v1/source/proof remain unchanged and the user stays authenticated. |
| Ownership + replay + Stop | Second real owner receives 404 on foreign run create/read/cancel and Generation status. Anonymous run read is 401. Stop removes iframe; ready same-key replay returns v1. Exactly two fixture AI calls, two Generations and one Revision. |
| Cleanup | Fixture-owned users/projects/generations/revisions removed; a separate launcher Mongo client and later independent probe confirmed all four counts zero. Dedicated ports released, no labeled build containers; six normal Compose containers stayed healthy. |

**Negative startup check:** `--suite build-gate --fail-after-start` exited the expected 1, not counted as a user-flow pass. Report `verification-1792732127613.json` records `failed: true` with both cleanup flags true; no fixture records remained. Log: `build-gate-browser-startup-failure.log`. Hard OS crash cleanup is not promised.

Additional checks: verification-option/image guards **4/4**, actual native-command regressions **12/12**, fixture cleanup **4/4**, frontend unit **33/33**, frontend lint/production build, Auth/Project builds and Execution typecheck/build passed. Narrow strict TypeScript check of the modified Preview fixture passed. An exploratory single-compiler check combining Auth + Project source failed on their existing incompatible global Express `Request.user` declarations (`email` required vs optional); it is **not** a passing check. Service-local builds remain the supported boundaries. No application type was weakened or unrelated auth refactor attempted.

This evidence does not test a real model/provider, its costs/quality, the AI Orchestrator runtime itself, normal demo gate activation, a durable queue or public execution security. Phase 1's zero-cost slice is verified; the entire six-phase plan is not complete. Reproduce using [the frontend guide](../nextjs-boilerplate/README.md#build-gated-browser-to-preview-loop-phase-1); design practice is in [System Design Q&A](SYSTEM_DESIGN_QA.md).

## Workspace-to-Docker preview follow-up — 2026-10-22

Branch: `test/frontend-generation-preview`, fast-forwarded to merged Execution-origin dependency PR #12 (`0a35a51`) before restoring its own test work. No Execution/Auth/Project/AI application code changes are part of this frontend-verification slice. It reuses the existing launcher/fixture instead of adding a browser framework or production fake-provider mode.

**Passing recorded run:** `npm run verify:workspace -- --suite preview-real`, explicit empty local `agentforge_test_preview_20261022_2340`, installed Edge channel. Launcher exit 0; ignored report `output/playwright/verification-1792692682129.json` has `preview-real: passed`, `cleanup: true`, `containerCleanup: true` and no failure marker. Real Auth/Project/Mongo, the actual Execution API, real Docker compilation/static export and browser iframe were used; only AI HTTP output was a deterministic fixture.

| Boundary | Executed evidence |
| --- | --- |
| Browser → Auth/Project | Real disposable registration/session; Enter submits a prompt and persists owned v1. |
| Saved revision → Execution | Browser submits IDs only; Execution loads actual owned Mongo snapshot through Project API, not fixture ownership responses. |
| Docker → browser | Actual static build publishes an iframe; React counter changes Count 0 → Count 1. Inspected ready screenshot: `output/playwright/verification-24236-preview-real-ready.png`. |
| Generation/build failures | Invalid AI output preserves v1; a later manifest-valid syntax error is saved as v2 but genuinely fails compilation, exposes no iframe and does not log out the user. No pre-publication quality gate is claimed. |
| Ownership/recovery | A second real account receives 404 for foreign run create/read/cancel; anonymous read receives 401. Refresh restores session/files; v1 stays immutable; replaying its original key returns v1 without another AI fixture request. |
| Stop and cleanup | Ready preview Stop removes the iframe and acknowledges cancellation. Exactly three AI fixture requests, two revisions and three Generation records were asserted before scoped cleanup. Launcher independently confirms zero users/projects/generations/revisions and no labeled preview containers after shutdown. |

Earlier attempts are retained, not counted as success: Chrome launch timed out; then Edge reached Docker-ready but CSP hardcoded port-3001 parents blocked the port-3102 workspace iframe. PR #12 fixed exact configurable loopback ancestors without weakening sandbox/network policy. This passing run uses that production fix. Ignored run log: `output/playwright/preview-real-after-origin-merge.log`.

Fresh helper checks in this follow-up: verification guards 3/3, native-command regression checks 12/12 and fixture-cleanup tests 4/4 passed. The production Execution dependency separately reran 19/19 tests plus typecheck/build before merge. A passing fixture flow is **not** proof of real-provider generation, model quality, provider spending, crash durability, public deployment or dependency remediation. Normal application database records and existing Compose containers were not modified.

Explicit startup-failure test also completed: `--suite preview-real --fail-after-start` exited the expected 1, while its report `output/playwright/verification-1792692873953.json` confirmed `failed: true`, `cleanup: true`, `containerCleanup: true`. That deliberate failure is not a passing user flow; it proves the ordinary failure path releases fixture records/listeners without deleting unknown containers. Independent port and Docker checks found no dedicated listeners or labeled build containers afterward.

After dedicated dev servers stopped, frontend unit tests **23/23**, lint and production build passed. `git diff --check` passed. These checks do not replace provider evaluation or the earlier labelled browser boundaries.

Reproduction, port/database/image guards and optional browser-channel selection: [frontend guide](../nextjs-boilerplate/README.md#full-workspace-to-preview-verification-zero-provider-cost). Docker/browser verification is explicit opt-in and remains outside the default `all` suite.

**Delivery recheck — 2026-10-23:** after AI-smoke PR #13 merged, the frontend branch fast-forwarded to `d2ab0d1`; its PR still contains only frontend verification helpers, fixtures and documentation. A fresh Edge `preview-real` run passed with dedicated database `agentforge_test_preview_delivery_20261023`; report `output/playwright/verification-1792694250739.json` confirms the real/fixture boundaries, `cleanup: true` and `containerCleanup: true`. Inspected screenshot `output/playwright/verification-10796-preview-real-ready.png` shows the built page and Count 1. The startup-failure rerun exited the expected 1; `verification-1792694405395.json` confirms failure and both cleanup flags. No dedicated listeners or labeled build containers remained. Verification guards 3/3, native-command checks 12/12, fixture cleanup 4/4, frontend tests 23/23, frontend lint/build, and Execution tests 19/19/typecheck/build passed again. No live provider call was made; existing Compose services were left running.

## Verification launcher lifecycle follow-up (2026-10-21)

The earlier combined report recorded links/history/access/loop passes, then a recovery failure after response loss; it is not a six-suite success. A subsequent attempt had no completed summary and is not counted as a pass. Reusing the proxy across upstream fixture restarts was a suspected source of stale connections. The launcher now stops and awaits its owned Next process, then starts a fresh Next + fixture pair for each real suite. Assertions, application APIs and dependencies are unchanged.

- A fresh focused recovery run passed **7/7 checkpoints**, including refresh after response loss and exact-key/body replay with no additional AI request or Revision. Launcher exit was 0; fixture shutdown and an independent launcher Mongo client confirmed zero records in all four collections. Report: ignored `output/playwright/verification-1792605340027.json`.
- Frontend unit tests passed **10/10**, lint passed; verification guards passed **3/3**, actual PowerShell command-wrapper regressions **12/12**, and cleanup tests **4/4**. Deliberate failure markers in the helper tests are expected assertions, not a failed suite.
- The old `agentforge_test_workspace_20261021` database was refused before writes because it contained one user and no project/generation/revision records. It was **not cleaned or dropped**. A separately selected empty `agentforge_test_verify_next_20261021` was used instead. Passing ordinary cleanup does not promise cleanup after hard termination.
- Inspected screenshot `output/playwright/verification-2632-recovery-recovered.png` shows recovered v2, parent v1, modified/deleted paths and honest unconnected preview/terminal labels. Paid model quality, generated-code execution and real crash/database-partition recovery are outside this evidence.

The complete rerun then passed **6/6 suites**, exit 0: links 3/3, history 3/3, access 4/4 scenarios; real loop 5/5, recovery 7/7, state 9/9 checkpoints. Report: ignored `output/playwright/verification-1792605471891.json`, `cleanup: true`, no failure marker. State checks exercised a real pending Generation across desktop/mobile/desktop, a real status GET after controlled post-commit 503 without a new generation, and a held old-project response released after selecting another project. The browser scenario outputs are not interchangeable with the helper-test counts.

After launcher exit, an independent read confirmed zero users/projects/generations/revisions in the newly selected test database, and no listeners remained on ports 3102/4310/4311/4312. Frontend production build passed, exit 0, after all dev servers stopped. Inspected `verification-20596-state-selection.png` and `state-mobile-1792605702754.png` show the newer project selection and disabled pending mobile controls respectively. Artifacts remain ignored. The refused older database was not altered. Baseline backend results are recorded in `M1_ACCEPTANCE_REVIEW.md`; backend/provider suites were not rerun in this lifecycle-only follow-up.

## Real-service terminal failure and response-loss recovery (2026-10-13)

PR #5 was verified merged at `7e1e730`; this focused slice starts from that baseline on `test/frontend-generation-recovery`. Story: real browser submission → Next rewrites → Auth/Project/Mongo → terminal AI-output rejection or committed response loss → truthful retained files/pending intent → explicit replay → restored committed revision. The existing deterministic AI transport is reused; no production service code, contracts, dependencies or environment files changed.

`npm run test:browser-recovery` selects the shared runner's recovery suite. Setup and mandatory cleanup are in the frontend README. A fresh dedicated fixture is required for each suite; wait for its ready message before starting the browser command.

- **Executed: 7/7 checkpoints:** initial v1; invalid-output follow-up rejected; v1/history preserved after refresh; actual committed v2 response deliberately dropped; pending request retained after refresh without automatic resubmission; exact same-key/body retry recovered v2; refreshed v2 had no pending controls. Expected terminal API response was 502; original publication and replay returned 201. No uncaught page/observer errors occurred.
- Browser assertions read real persisted project/history/revision/generation records. V1 files remain equal to the original response; v2 has v1 as parent, complete merged files, preserved CSS and explicit `components/Old.tsx` deletion. The failed Generation has no saved result/revision. Exactly four browser generation POSTs used three distinct logical keys; the fourth reused the third key/body. One project, three Generation records, two Revisions and three AI requests remained: replay/refresh did not spend another call.
- The loss mechanism is explicit test-only transport fault injection: Playwright forwards one POST to the real Project API, requires its actual 201, privately retains that committed result and aborts browser delivery. It does not fabricate success, replace backend persistence, alter React state or write pending intent itself. The browser's normal app stores/restores intent. This proves controlled post-commit response loss, not server crash or database partition recovery.
- Dedicated `agentforge_test_recovery_20261013` was verified empty through a read-only preflight. Both follow-up AI requests received version 1 and the exact three initial files. Scoped fixture shutdown exited 0 with zero users/projects/revisions/generations; an independent read-only probe confirmed zero. Collections/indexes were retained, normal data untouched, and the dedicated Next server/browser were closed.
- Screenshots `output/playwright/workspace-real-72ff7bc3-uncertain.png` and `workspace-real-72ff7bc3-recovered.png` were inspected. The uncertain screen retains v1, shows latest-v2 history and a disabled new prompt with explicit retry. The recovered screen shows v2, parent v1, modified/deleted changes and no pending controls. Artifacts remain ignored and tokens private.
- Frontend unit tests passed 9/9, fixture-cleanup tests 4/4, frontend lint and production build passed. JavaScript/PowerShell syntax and diff checks passed. A premature initial browser invocation failed its fixture-connection preflight before browser startup/writes; after confirmed startup the complete scenario passed. Other browser suites and backend integration/provider suites were not rerun this turn.

Remaining gaps: process-kill/database-partition/publication uncertainty, broader auth/storage/race cases, actual provider quality/cost and generated-code build/execution. M1 is not marked fully accepted. Implementation alone does not authorize commit/push/PR/merge; unrelated `.github/` work remains excluded.

## PR #5 conflict-resolution recheck (2026-10-13)

Merged the PR #4 baseline (`93f5964`) into `test/frontend-real-revision-loop`, retaining both access/legacy and real-service commands/docs. The three conflicts were documentation and root npm scripts only; production application code, environment files and dependencies were unchanged. Frontend unit tests passed 9/9, fixture-cleanup tests 4/4, frontend lint and production build passed. JSON parsing confirmed all five browser/fixture commands; both runner scripts and browser snippets passed syntax checks, and no conflict markers/unmerged entries remained. An overlapping second build invocation hit Next's build lock; the original lint/build invocation completed successfully. Browser/database/provider suites were not rerun for this integration-only change. Unrelated `.github/` work remains excluded. Resolution commit/push does not merge the GitHub PR.

## Repeatable real-service revision loop (2026-10-13)

Story: browser registration → Next rewrites → real Auth session and Project API → MongoDB revisions → deterministic AI HTTP fixture → hard refresh/reopen. The AI SDK/provider is not exercised; browser/API/database persistence is real, with no transport interception or React-state injection.

From merged `main` (`f15936e`, PR #3), the independent `test/frontend-real-revision-loop` slice adds `npm run fixture:browser` and `npm run test:browser-real`. Its original verification did not include or depend on the access/legacy branch. After PR #4 merged, PR #5's conflict resolution incorporates `main` (`93f5964`) while preserving access/legacy and real-loop commands/documentation. The dated browser results below remain the original runs, not fresh browser rerun claims. Reproduction, dedicated ports, process-only environment overrides and mandatory fixture shutdown instructions are in `nextjs-boilerplate/README.md`.

- **Executed:** 5/5 ordered browser checkpoints passed: initial v1, hard-refresh session/v1 restoration, follow-up v2, hard-refresh v2 restoration and historical v1 reopening. The selected URL and displayed source match each revision.
- Actual Project API reads compare complete snapshots with committed responses, prove v1 immutability and v2's v1 parent, preserve unchanged CSS and verify explicit `components/Old.tsx` deletion. The same key/body replays the same v2 revision. A second real account sees an empty project list and receives 404 for the first owner's project/revision; these second-owner checks are HTTP assertions inside the runner, not an interactive second browser login.
- A read-only preflight confirmed zero records in `agentforge_test_real_loop_20261013`. After the scenario, counts were users 2 / projects 1 / revisions 2 / generations 2. The fixture recorded exactly two AI requests; the follow-up received base version 1 with all three initial files matching exactly. Refresh, reads and replay did not call AI again.
- Rerunning against the non-fresh fixture exited 1 before browser startup/writes. Loopback/database guards and identity-header probes through both rewrites reduce accidental normal-service writes; they do not defend against a malicious localhost impersonator.
- Fixture-cleanup unit tests passed 4/4; frontend unit tests 9/9, lint and production build passed. Auth and Project builds, JavaScript/PowerShell syntax and diff checks passed. Existing backend integration and mocked browser suites were not rerun for this test-only slice.
- The final screenshot `output/playwright/workspace-real-87f10b79.png` was inspected: v1 source/three files are visible with latest-v2 history and honest unconnected-terminal labels. Unauthorized probes returned 401, owned reads 200, replay 201 and foreign reads 404. Tokens/cookies and database credentials are not printed by assertions.
- Scoped fixture shutdown exited 0 and reported all four collection counts zero; an independent read-only Mongo probe confirmed them. Collections/indexes were retained, not dropped. The runner closed its own browser; the manually started dedicated Next server was stopped separately. Always request fixture shutdown even after a failed test, and investigate unknown records instead of deleting broadly.

No production application/auth/schema, `.env`, dependency or lockfile changes. Remaining work includes real-service failure preservation/lost-response automation, broader auth/storage/race/crash cases, provider quality/cost and generated-code build/execution/deployment. M1 is not marked fully accepted.

## Legacy, saved drafts and unavailable selections (2026-10-12)

PR #3 was confirmed merged at `f15936e`; this test-only slice starts from updated `main` on `test/frontend-workspace-access-legacy`. Story: real Next/React selection reads → mocked legacy/draft/not-found API responses → truthful code/metadata or disabled empty/error UI → explicit read retry → New conversation recovery.

```powershell
# Repository root, with Next already running:
npm run test:browser-access
# Dedicated test port alternative:
npm run test:browser-access -- -BaseUrl http://localhost:3102
```

- **Executed 4/4 scenarios, 8 checkpoints:** legacy snapshot, saved draft, unavailable project, unavailable revision. Legacy code loads without invented A/M badges; model/usage, parent, producing prompt, validation and change metadata remain labelled unknown. Drafts show no generated/demo tabs and accept an unsent prompt.
- Project/revision `404` responses disable generation and display no files. Retry issues another read against the same scoped IDs; counters are checked after DOM readiness and compared with the last recorded read, allowing development-mode aborted reads without falsely accepting a stale error. New conversation clears each error and restores an empty usable draft. All writes/unknown API paths are blocked; no unexpected calls or uncaught page errors occurred.
- Shared-runner regression checks were rerun: malformed links 3/3 and history/pagination/session rejection 3/3. Total this turn: **10 browser scenarios**, frontend unit tests 9/9, lint, production build, snippet/PowerShell syntax and diff checks passed. Application/service code and dependencies are unchanged.
- Legacy and not-found screenshots `output/playwright/workspace-access-f144e36e-legacy.png` and `workspace-access-f144e36e-project404.png` were inspected. Scenario/recovery artifacts remain ignored. Test browser sessions and the dedicated Next server were closed after verification; unrelated `.github/` work was preserved.

**Evidence boundary:** every API response is mocked before navigation. The generic unavailable response represents missing/deleted/foreign resources without distinguishing them; this verifies frontend handling, not real cross-owner authorization or an implemented deletion API. No normal/dedicated database was accessed, no paid provider called, no credentials or `.env` changed. Backend integration suites were not rerun. Next is automated real Auth/Project/Mongo revision-loop coverage with deterministic AI transport; broader auth-expiry/storage/crash cases remain, so M1 is not marked fully accepted. Setup and all three commands are in the frontend README.

**Delivery recheck — 2026-10-13:** access scenarios 4/4, frontend unit tests 9/9, lint, production build, snippet/PowerShell syntax and diff checks passed again before the requested commit/push. The other two browser suites' 6 passing scenarios above are 2026-10-12 evidence, not rerun claims for this delivery turn. The test browser/server were stopped; unrelated `.github/` work remains excluded. Real-service automation has not started and awaits this slice's PR merge.

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
