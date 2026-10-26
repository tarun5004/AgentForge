# AgentForge Frontend

This Next.js application provides AgentForge's authentication screens and local AI development workspace.

## Unified agent chat — 2026-10-25

Stabilization cleanup: the unconnected sample Terminal/Problems panel and unused sample files/messages/tasks have been removed. The workspace displays only persisted files, actual change metadata, and real Preview status. This cleanup does not add general conversation or change the existing requirements API; those remain separate work.

The sidebar keeps requests, requirement replies, observed activity, results and follow-up changes in one timeline. Its compact header, plain assistant prose, inline expandable activity, header conversation picker and bottom composer follow the supplied Codex-sidebar reference. It is still a bounded frontend-building workflow, **not a general conversation endpoint**. A greeting currently goes through project/requirement assessment; conversational routing is the next separate slice, not claimed complete.

- **Actual evidence, not animation:** activity is recorded on requests/responses and existing generation GET polling. The current API does not report live skill/tool events, so the UI does not invent them. There is no token streaming, simulated reasoning, percentage progress or new event infrastructure. The proposed cross-service provenance plumbing was removed from this UI slice during audit.
- **Structured result:** summary, model/usage, A/M/D paths, build status and saved-revision actions. Only `buildVerification` produces a build-pass label; legacy records stay explicitly unverified. Preview uses the same existing modal/controller and iframe sandbox from both toolbar and chat.
- **Same-chat edits:** the selected immutable revision remains the explicit base. Request body/key are frozen for retries. Failures preserve files; refresh/status reads never automatically POST another AI request. Confirmation before initial generation remains unchanged.
- **Local persistence:** `localStorage` is scoped by account + project and read only after the backend proves ownership. It saves display messages/summary metadata, not JWTs, provider keys, generated files or private reasoning. Do not enter secrets in prompts. Upserts keep one activity card per request; refresh marks unfinished activity unconfirmed. A maximum of 120 entries / approximately 400 KB is retained, with visible trimming/storage warnings. This is same-browser history, **not** cross-device chat synchronization. Canonical project/revision metadata rebuilds missing summaries; unknown old activity is not invented.
- **Privacy/control:** “Clear local chat messages” removes only the display cache and rebuilds saved revision summaries. It never deletes backend files or pending request keys. Clearing browser site data also removes this local history. Chat display history is not automatically sent to the model: requirements use cumulative answers; edits use selected base files plus the change prompt.
- **Safety:** model replies use restricted Markdown, without raw HTML, external embeds or executable content. Restored cache data is runtime-validated and never authorizes API writes. No new package, environment variable, model call or public API request body is needed.

### Small-chunk plan and file map

1. **Sidebar presentation:** compact chat layout, existing build results, preserved request/refresh behavior. Uncommitted on `feature/frontend-agent-chat`, in `C:\vscode tool\agentforge-agent-chat`; the normal `loveable-main` checkout is not automatically updated by a worktree.
2. **Conversational reply path (not implemented):** an ordinary message such as “Hi buddy” must receive a real assistant reply without creating a project or starting generation. Use the configured provider; do not hardcode canned AI answers. Review that small API contract before wiring it into the composer.
3. **Build actions in that conversation (not implemented):** distinguish replies/questions from an actual build request, then reuse the existing owned project, selected snapshot and local Preview flow. Do not add an arbitrary shell agent, new agent framework or fake tool progress.

| File | One responsibility |
| --- | --- |
| [ChatPanel](components/workspace/ChatPanel.tsx) | Header, conversation picker, composer and change bar. |
| [ConversationTimeline](components/workspace/ConversationTimeline.tsx) | Draw messages, activity and results; no API calls. |
| [useWorkspace](components/workspace/useWorkspace.ts) | Existing request, selected-revision and retry behavior. |
| [useConversation](components/workspace/useConversation.ts) / [conversation](lib/conversation.ts) | Small display cache; not model context or backend authority. |
| [PreviewLauncher](components/workspace/PreviewLauncher.tsx) | Existing local Preview; cancel the Strict Mode probe's scheduled duplicate start. |

```powershell
npm --workspace nextjs-boilerplate test
npm --workspace nextjs-boilerplate run lint
npm --workspace nextjs-boilerplate run build
# Owned local frontend, all API calls intercepted before navigation:
powershell -NoProfile -File scripts/verify-workspace-links.ps1 -BaseUrl http://localhost:3103 -Suite chat
```

No Project/AI API or database changes are required for this presentation slice. Existing Gemini work is preserved separately. This is a focused Codex-inspired sidebar, not equivalent Codex model capabilities, general chat, or an arbitrary command-running agent. UI fixtures prove presentation/recovery only; live model behavior must be reported separately.

Audit verification (2026-10-25): **49 frontend tests**, lint, production build, and production-browser chat/history/requirements suites passed. Browser APIs were intercepted; no paid/live AI call or general-chat behavior is claimed. The Preview duplicate-start regression was also reproduced and checked in development Strict Mode before the production run. Gemini regression checks separately passed 57 tests plus typecheck/build. The extra uncommitted Project tool-provenance changes were reverted; their recoverable patch is in the original checkout's ignored `output/playwright/deferred-tool-provenance.patch`. No commits, pushes or merges were made.

## A3: requirements before initial generation — 2026-10-23

New-project flow: **Send request → answer essential questions → review draft brief → Confirm brief → Generate code**. A complete request may go directly to review, but model-ready never automatically starts generation. Questions/brief come from AI Orchestrator through the authenticated Project Service, not a hardcoded questionnaire or a browser-held provider key. This needs A1 and A2 backend code (PRs #24/#25); rebuild outdated local service images before manual use. No new dependency or environment variable.

- Draft projects load saved requirements after session restoration. Existing revisions keep their explicit selected-base follow-up flow. The initial composer is hidden for saved drafts so typed text cannot be silently ignored in favor of the stored initial prompt.
- Answers and request state live in the shell-owned hook, above responsive panels. Editing an answer requires reassessment and fresh consent. Loading/error/unsupported/pending states have explicit controls; failures never invent files or start Preview.
- A bounded user/project-scoped sessionStorage record holds assessment key/version/answers for **explicit** same-key replay after refresh. It is untrusted retry metadata, not the source of saved briefs. It contains personal answer text: use non-secret project details. No JWTs, provider keys or generated files are stored there. If storage is disabled, only the mounted shell retains retry identity; a hard refresh cannot recover an unsaved key.
- GET/reload never starts AI. Unknown results keep their key; no automatic POST retry except the existing one-time definite-401 session refresh with identical identity. A request never received by the server may start its first model call on explicit replay. New attempts/abandonment warn about possible additional spend; abandonment cannot cancel/refund provider work.
- Initial generation sends only the confirmed brief ID plus a separate key and empty body. That brief ID survives generation refresh/retry; pending polling/status checks stay unchanged. Old stored generation intents remain compatible with the original API. No global consent retrofit, streaming, tools, RAG or live-provider quality claim is included.

Implementation: [workspace state](components/workspace/useWorkspace.ts), [requirements panel](components/workspace/RequirementPanel.tsx), [runtime guards and retry storage](lib/requirement-brief.ts), [API helpers](lib/project-api.ts).

```powershell
npm --workspace nextjs-boilerplate test
npm --workspace nextjs-boilerplate run lint
npm --workspace nextjs-boilerplate run build
# Against an isolated owned frontend: all API requests are intercepted before navigation.
powershell -NoProfile -File scripts/verify-workspace-links.ps1 -Suite requirements -BaseUrl http://localhost:3102
# Real Auth/Project/Mongo; only AI transport is a deterministic fixture. Requires an empty dedicated DB.
$env:AGENTFORGE_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/agentforge_test_brief_ui_your_run'
node scripts/verify-workspace.mjs --suite loop
```

The requirements UI suite checks questions, resize-preserved answers, lost acknowledgement + refresh/same-key replay, edit-invalidated confirmation, explicit generation and saved-file reload. The real-loop fixture now supports assessment/confirmation and cleans only its own Brief records alongside Project/Generation/Revision data. Neither fixture measures model reasoning/quality; budget-approved live-provider-to-preview smoke remains A4.

Verified 2026-10-23: **40/40 frontend unit tests**, lint/build, 8 launcher tests, 12 native-command checks, and 4 cleanup tests passed. Browser suites passed for requirements, session/keyboard, pending generation, and 4/4 access/legacy cases. First browser run exposed the answer-reset bug described in the design Q&A; a session assertion needed to wait for saved-draft navigation rather than an obsolete composer, and a concurrent access run timed out taking a screenshot (solo rerun passed). These failures are not silently counted as passes.

Real Auth/Project/Mongo browser loop: **5/5 checkpoints passed**, including stored-confirmation → v1, refresh, selected-base v2, immutable v1 reopening, same-key replay and second-owner 404s. Recovery **7/7** and state **9/9** also passed after adapting the initial consent route: failed follow-ups preserve v1; lost-success replay adds no model call; responsive layout retains request identity; status recovery uses GET; delayed project-A reads cannot replace project-B files. Only AI HTTP output was a fixture, with controlled response loss/barriers/read delays in the corresponding suites. Cleanup independently returned zero users/projects/projectbriefs/generations/revisions; the owned temporary Mongo container was removed without touching application data. Reports: ignored `output/playwright/verification-1792753838275.json` (loop), `verification-1792769299142.json` (recovery), `verification-1792769452247.json` (state); screenshots: `requirements-questions.png`, `requirements-complete.png`. Preview/build-gate browser suites were adapted but **not rerun** in A3. No live provider call, generated-code execution, production deployment or security certification.

## B2/1: pending-generation compatibility — 2026-10-23

The frontend accepts both the existing completed generation response and a future `202 {generation: {id, status: "pending", hasSavedResult, errorCode: null}}` response. It stores the accepted Generation ID alongside the existing user/project-scoped key/body **before** polling. GET-only polling waits two seconds between reads, is capped at 180 reads and a six-minute UI deadline, and stops on unmount, terminal evidence or a read failure. Each status GET has a ten-second deadline. No timer submits another generation POST or model call.

While waiting, saved files remain visible and selection/submission controls stay frozen. A committed result advances the editor; a confirmed failed result keeps earlier files. Read outages (including proxy 502), malformed data and polling timeout preserve the key/ID for explicit status/replay. A definite 401 follows the existing session recovery path. Refresh restores pending intent and its manual controls; it does not automatically restart paid generation. Pending state is not a success or a build guarantee.

Optional backend-issued `buildVerification` evidence has a separate runtime guard (status, policy, snapshot hash, runner image ID, check ID and timestamp). Only records carrying that evidence get the static-build badge. Legacy/manifest-only records retain their old label; the browser does not independently execute a build or cryptographically certify the backend's claim.

**Rollout boundary:** this frontend-only slice does not add candidate authentication, enable a Project publication gate, change service environment files or alter saved data. Execution candidate checking and Project gating remain later compatible service slices. Until then the current backend continues returning its existing completed responses.

Checks: `npm --workspace nextjs-boilerplate test`, `npm --workspace nextjs-boilerplate run lint`, `npm --workspace nextjs-boilerplate run build`, and `npm run test:verification`. The explicit UI contract check uses the existing CLI wrapper:

```powershell
# Run against an owned local frontend; every API request is intercepted before navigation.
$env:AGENTFORGE_BROWSER_CHANNEL='msedge' # optional; default chrome
powershell -NoProfile -File scripts/verify-workspace-links.ps1 -BaseUrl http://localhost:3102 -Suite pending
```

The browser check covers pending files/disabled selection, accepted-ID storage, ready-only v2 selection/badge, failed-check preservation and status-outage refresh without another POST or logout. This is **mocked API transport**, not real Auth/Mongo/build/provider evidence. Ignored artifacts: `output/playwright/frontend-pending-browser.log` and `frontend-pending-gate-20261023.png`. The test uses a fresh browser session and never reuses a real account's cookies.

## Local development

Copy the environment example:

```powershell
Copy-Item .env.example .env.local
```

Start the frontend on `http://localhost:3001`:

```bash
npm run dev
```

The Auth Service and Project Service must be running at the server-only URLs configured in `.env.local`.

## Authentication flow

```text
Browser /api/auth request
        |
        v
Next.js same-origin rewrite
        |
        v
Independent Auth Service
```

The access token is kept in React memory. The refresh token is set and rotated by the Auth Service as an HttpOnly cookie, so frontend JavaScript cannot read it.

The installed Next rewrite proxy defaults to a 30-second timeout. `next.config.ts` explicitly permits 95 seconds, allowing the Project Service's 90-second AI deadline to respond before the browser client's 100-second deadline. This is bounded synchronous-request handling, not a promise of background completion or a deployment platform's maximum duration.

A protected Project API `401` first renews the session through the HttpOnly refresh cookie and retries the identical request once. Concurrent rejections share one refresh; late rejections reuse the newer token. Retrying preserves the body, idempotency key and cancellation deadline. Only a rejected refresh (`401`) or a second Project `401` clears identity and redirects to `/login`; network/server failures keep the session and draft visible. A late refresh cannot restore a logged-out session. `invalidateSession` does not revoke refresh cookies or replace server logout. Pending keys remain user/project-scoped for reconciliation after sign-in.

Prompt keyboard controls: **Enter** sends a valid prompt, **Shift+Enter** adds a line. IME composition and held/repeated Enter do not submit. Minimum trimmed prompt length is 10 characters; in-flight submission controls remain disabled.

Zero-cost session/keyboard browser regression: set `AGENTFORGE_TEST_MONGODB_URI` to an empty dedicated local `agentforge_test_*` database, then run `npm run verify:workspace -- --suite session`. Every API is intercepted; no real provider is called. The full verification suite includes this regression too. Logout waits for any pending cookie rotation before revoking the cookie.

Authenticated workspace prompts call `POST /api/projects`. The Project Service validates the access token and prompt, then saves a draft project before any AI generation begins.

## Saved project and revision loop

- New conversation creates a draft once; initial generation uses its returned project ID.
- Saved projects/history come from paginated owner-scoped Project API reads, not mock chats.
- `/workspace?project=<id>&revision=<id>` restores the selected snapshot after AuthProvider restores a session. A project-only link loads its actual latest revision; a saved draft has an empty editor.
- A follow-up sends `{ prompt, baseRevisionId }` for the visible selected revision. Older parents are clearly labelled; published version order and parentage differ.
- `useWorkspace.ts` keeps request/selection/prompt state above responsive panels. Abortable reads cannot overwrite another selected project's files.
- Pending intent (key/prompt/base/optional generation ID) is stored in user/project-scoped sessionStorage, without tokens or generated code. Explicit retry reuses it; confirmed failures/new submissions use new keys. Disabled storage preserves in-session retries but cannot guarantee intent recovery after refresh.
- Committed POST files remain visible if metadata reload fails. Deleted paths are shown as D, never selectable as current files; unchanged files receive no change badge. Legacy provenance is labelled unknown.
- Preview builds the selected saved revision through the opt-in local Execution Service. Interactive terminal/build-log diagnostics remain unconnected and sample output stays labelled.

## Local saved-revision preview

Enable/start the trusted host-run controller using [Execution setup](../execution-service/README.md). The frontend proxies `/api/runs` to server-only `EXECUTION_SERVICE_URL` (host dev default `http://127.0.0.1:5002`; frontend Docker image default `http://host.docker.internal:5002`). Restart Next after changing this setting. Docker Desktop-to-controller health connectivity was tested without exposing the controller on a public bind address.

Select a saved revision, then click **Preview**. A native modal freezes background selection while the backend builds. It polls status, supports Stop, and displays cleanup uncertainty instead of offering a blind retry. A definite 401 follows the existing single-refresh/session-expiry path; 422/429/503/build failures do not log out the user. Superseded/unmounted polls are aborted, response identity is checked, and the launcher resets by user/project/revision rather than carrying another project's iframe across navigation.

The iframe accepts only validated loopback capability URLs and uses `sandbox="allow-scripts"` **without `allow-same-origin`**, plus `no-referrer`. No access token or provider key is put into the URL/frame. Preview is static frontend execution, not SSR/API routes, a terminal, HMR, arbitrary package installation, or Kubernetes. Closing a ready dialog leaves its bounded preview cache to expire; Stop removes it immediately. **Keep preview alive** is explicit authenticated activity, not an automatic polling heartbeat. A hard navigation during a build may leave bounded server work to finish or time out; client request abortion is not a server-cancel guarantee.

Zero-cost UI regression with Next on a dedicated local port:

```powershell
powershell -NoProfile -File scripts/verify-workspace-links.ps1 -Suite preview -BaseUrl http://127.0.0.1:3002
```

This suite intercepts every API and preview document before navigation, covering success, cancellation acknowledgement, outage retry without logout, and cleanup-warning behavior. It does **not** prove real Auth/Mongo/provider execution. The separate Execution suite verifies the real API/Docker/preview-server/browser path with only Project ownership transport substituted. A paid-model-to-workspace-to-preview E2E has not been run. Existing dependency advisories still block public hostile multi-user execution.

## Verification

```powershell
npm --workspace nextjs-boilerplate run test
npm --workspace nextjs-boilerplate run lint
npm --workspace nextjs-boilerplate run build
```

Local API/selection/storage/adapter tests use Node 22's type stripping; no new test dependency is required. The module-detection warning is informational; do not change runtime module style just to silence it. Safe real-service browser-fixture setup and exact checked/unverified cases are in `docs/08_TESTING_STRATEGY.md` at the repository root. A production frontend build does not verify provider quality or generated-code execution.

### Repeatable malformed-link browser smoke (Windows)

From the repository root, start Next in one terminal and run the check in another:

```powershell
npm run dev:web
# In another terminal, also at the repository root:
npm run test:browser-links
# Or, if Next is already running on a dedicated test port:
npm run test:browser-links -- -BaseUrl http://localhost:3102
```

Requires a standard Node.js/npm installation, Windows PowerShell and Chrome available to Playwright CLI. The runner uses pinned `@playwright/cli@0.1.22` through npx; the first run may download the tool into npm's cache. No dependency is added to the application or lockfile. The command does not start/stop Next for you; stop the server you started when finished.

The real browser checks invalid project IDs, duplicate project query values and revision-without-project links. Each must disable submission and show no file tabs; **New conversation** must restore an empty, usable draft. All `/api/**` requests are intercepted before navigation: refresh/list responses are synthetic and unexpected requests abort and fail the check. No real login, database, project creation or provider call is made. This is UI regression evidence, **not** real-service persistence/authentication evidence.

Only localhost HTTP origins are accepted. A fresh named browser session closes in `finally`; failures exit nonzero. Snapshots/screenshots go to ignored `output/playwright/` and `.playwright-cli/` directories. Runner steps are in `scripts/verify-workspace-links.ps1`; the file-based JavaScript snippet in `scripts/workspace-links.browser.js` avoids Windows multiline-command quoting and is test tooling only.

### Pagination and protected-session rejection smoke

With Next running, from the repository root:

```powershell
npm run test:browser-history
# Dedicated port alternative:
npm run test:browser-history -- -BaseUrl http://localhost:3102
```

This uses the same Windows runner with `-Suite history` and `scripts/workspace-history.browser.js`. It checks project load-more, revision load-more and protected-401 login recovery through five ordered UI checkpoints. Cursor requests are checked exactly; deliberately overlapping mock pages must not duplicate rows, and exhausted pagination controls disappear. The expiry case must leave the workspace, stay on login and make exactly one rejected protected read, rather than retry/bounce.

The real Next/React UI runs, but **every API response is mocked**; unexpected calls and all writes are blocked. No real JWT expiry, ownership enforcement, cookie rotation, MongoDB pagination or provider is verified here. Do not edit app files during these browser checks: dev Fast Refresh can reload the page and reset UI state mid-scenario. Run all three smoke commands after changing the shared runner or auth/workspace state.

### Real-service revision-loop check (Windows)

This check uses real Next, Auth, Project and MongoDB persistence. Only the AI Orchestrator HTTP boundary is replaced with deterministic test output: no paid model request or generated-code execution. Requires Windows PowerShell, Node/npm, local MongoDB and Chrome available to Playwright CLI.

Use three terminals, starting at the repository root. Ports 4310, 4311, 4312 and 3102 must be free. The database below must be dedicated to tests and empty; never substitute the normal service database.

```powershell
# Terminal 1: isolated Auth/Project services and AI transport fixture
$env:AGENTFORGE_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/agentforge_test_real_loop_local'
npm run fixture:browser

# Terminal 2: process-only test rewrites; no .env edits
$env:AUTH_SERVICE_URL='http://127.0.0.1:4310'
$env:PROJECT_SERVICE_URL='http://127.0.0.1:4311'
cd nextjs-boilerplate
node ../node_modules/next/dist/bin/next dev --port 3102

# Terminal 3: repository root
npm run test:browser-real
```

The fixture rejects remote/credentialed/option-bearing URIs, names without the `agentforge_test_` prefix and nonempty collections before importing application models. The browser runner checks fresh fixture counts and identity headers through both Next rewrites before writes. These are accidental-misconfiguration guards, not authentication against a malicious localhost process.

Five checkpoints cover register/create/v1 → hard refresh → follow-up v2 with deletion → hard refresh → reopen v1. Actual API reads check parent linkage, immutable snapshots, preserved CSS, explicit deletion, same-key replay without another AI call, and a second real owner's empty list/404 reads. Tokens remain private to the runner; there is no API interception or React-state injection. The second owner's assertions use real HTTP inside the runner, not a second interactive browser login.

Always shut down the fixture from Terminal 3, **even if the browser command fails**:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4312/__fixture/shutdown
```

Wait for Terminal 1 to exit successfully with zero user/project/revision/generation counts, then stop only the dedicated Next server in Terminal 2 with Ctrl+C. Cleanup removes the two allowlisted fixture accounts and their owned records; collections/indexes remain. Unknown records are preserved and cause a cleanup failure: investigate rather than broadly deleting the database. The browser runner closes its own session, but does not own the manually started servers. Restart a clean fixture before each run; a non-fresh rerun is rejected before opening a browser.

Snapshots/screenshots remain in ignored `output/playwright/` and `.playwright-cli/`. Pinned Playwright CLI is reused without a new application dependency. This does not verify the real AI SDK/provider, generated-project builds/execution, all failure/crash cases or deployment. Exact dated results are in the root testing strategy.

### Legacy, draft and unavailable-selection smoke


With Next running, from the repository root:

```powershell
npm run test:browser-access
# Dedicated port alternative:
npm run test:browser-access -- -BaseUrl http://localhost:3102
```

This uses `-Suite access` and `scripts/workspace-access.browser.js`. Four scenarios verify that legacy files remain readable with unknown provenance and no invented change badges; saved drafts stay genuinely empty/usable; and project/revision `404` responses disable generation and show no file tabs. Each unavailable selection is retried against the same IDs, then **New conversation** restores a usable empty draft. Eight completed checkpoints are required; unexpected API calls/writes and uncaught page errors fail the command.

All API responses are synthetic. An unavailable resource could be missing, deleted or owned by someone else; the mock returns the same public not-found shape without exposing private data. This proves **frontend handling only**, not actual server ownership filtering or a deletion feature. Real authorization requires the dedicated Project API/Mongo integration suite. There are no real account/database/provider writes or new packages; artifacts use the same ignored output directories and the runner closes only its own browser session.

### Real-service failure and response-loss recovery

Start a **fresh, empty** dedicated fixture and Next with the process-only rewrites described under the real-service revision-loop check. Once Terminal 1 prints `Browser fixture ready`, run this from the repository root instead of `test:browser-real`:

```powershell
npm run test:browser-recovery
# Dedicated local origin alternative:
npm run test:browser-recovery -- -BaseUrl http://localhost:3102
```

The shared runner's `-Suite recovery` selects `scripts/workspace-recovery.browser.js`. Seven checkpoints cover v1 creation; a real Project API rejection of invalid fixture AI output; preserved v1 after refresh; a committed v2 response deliberately dropped before delivery; pending intent restored after refresh; explicit same-key/body retry; and the recovered v2 after refresh. Mongo/API reads verify one project, three Generation attempts (one failed), exactly two immutable Revisions and three AI fixture calls. Retry must add neither a revision nor an AI call.

Only the deterministic AI transport and one post-commit browser response drop are controlled. Playwright forwards that POST to the real Project API first, records its actual 201 result privately, then aborts delivery; it does not fabricate a success or inject React/sessionStorage state. An uncertain UI intentionally keeps the selected v1 visible even though v2 is committed server-side; **Retry same attempt** reconciles the result. A terminal failure instead clears its key and permits a new request. These are different outcomes, not a universal automatic-retry policy.

Always use the fixture shutdown command above even after failure, confirm zero remaining records and stop the dedicated Next server. Restart the fixture before running another suite. The browser closes in `finally`; tokens are private, artifacts ignored and no package added. This verifies controlled response loss after commit, not process-kill recovery, database partitions, failed publication or provider behavior. Generated code remains unexecuted.

### State safety and status recovery

With a fresh fixture and Next already running, `npm run test:browser-state` runs nine checkpoints. A test-only AI barrier holds an actual pending Generation while the browser reflows desktop → mobile → desktop; prompt, navigation and logout must stay frozen. After commit a controlled proxy 503 preserves the actual generation ID. **Check status** must read the real ready result without another POST/model call. A real project-A detail response is then held while B is selected; releasing A must not overwrite B. Successful project/files/status data is never fabricated. The barrier/proxy/read delay are test controls, not production crash simulations.

### One-command local verification (recommended)

Requires Windows PowerShell, Node 22+, installed workspace dependencies, Chrome available to the pinned Playwright CLI and a running local MongoDB. Run from the repository root:

```powershell
$env:AGENTFORGE_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/agentforge_test_workspace_local'
npm run verify:workspace
# A focused suite:
npm run verify:workspace -- --suite state
```

The explicit database must be empty and named `agentforge_test_*`, with a loopback host and no credentials/URI options. The launcher never reads an application `.env` to select a database and never drops one. Ports 3102/4310/4311/4312 must be free; existing processes are refused, not reused or killed. No new package is installed into the project.

The launcher starts its own Next server with process-only test rewrites, waits for HTTP readiness, and runs mocked link/history/access suites and the real loop/recovery/state suites. Each real suite gets a fresh **Next + fixture pair**: reusing a proxy while restarting its upstream services can retain stale pooled connections between scenarios. It attempts HTTP fixture shutdown in `finally`, checks zero remaining records through a separate Mongo client, and stops only its own process trees. Failure/timeout exits nonzero; unexpected records are preserved for investigation. Runtime summaries and browser artifacts remain ignored under `output/playwright/`. No provider credits or generated-code execution are involved.

If preflight reports a nonempty database, no records are deleted. Inspect that dedicated database separately; do not remove its contents just to make the check green. An explicitly selected, different empty test database can be used without touching the refused database. Abrupt termination of an earlier run may require this investigation even when ordinary cleanup tests pass.

Pinned Playwright CLI 0.1.22 is bootstrapped/version-checked once, then invoked directly so npm startup is not repeated for each click. Normal stderr notices do not masquerade as failures; actual exit codes and CLI assertion errors still fail the run. The launcher supplies unique browser session names and attempts to close only those sessions during cleanup.

Use `--suite loop|recovery|state|mocked|all` to limit scope. `--fail-after-start` deliberately fails after both servers are ready so cleanup can be tested without browser writes; its expected exit code is 1. Hard OS termination/power loss cannot guarantee finally cleanup. The acceptance matrix in `docs/M1_ACCEPTANCE_REVIEW.md` separates implemented behavior, executed checks and remaining scope.

### Full workspace-to-preview verification (zero provider cost)

The separate **opt-in** `preview-real` suite extends the same launcher through the actual Execution API, Docker static build and workspace iframe. It is not included in `all`, so ordinary history checks do not unexpectedly require Docker. Build the trusted image first using [Execution setup](../execution-service/README.md); Linux Docker and ports 5310/5311 must also be available.

```powershell
# Explicit empty disposable database; never use an application database.
$env:AGENTFORGE_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/agentforge_test_workspace_preview'
$env:AGENTFORGE_BROWSER_CHANNEL='msedge' # optional for real suites; default is chrome
npm run verify:workspace -- --suite preview-real
```

The test composes real Auth/Project APIs, MongoDB and production Execution modules; **only the upstream AI response is a deterministic fixture**. No successful app/run response or iframe document is mocked. The production Preview server is configured for the test frontend's exact `http://localhost:3102` origin, using the merged origin-policy fix, not an overridden CSP header.

Checks cover Enter-to-submit, saved v1, a real build and React counter click, refresh/session restoration, invalid-output failure preserving v1, manifest-valid but broken TSX producing a real failed build without an iframe, immutable-v1 reopen, Stop, same-key replay without another AI call, and another owner's create/read/cancel rejection. The broken revision being saved before its build explicitly demonstrates why a mandatory quality gate is still future work.

Preflight refuses occupied ports, a nonempty test database, missing trusted image, non-Linux Docker or existing labeled preview containers; it never deletes unknown containers. Finally awaits owned builds/listeners, cleans only fixture-owned records, independently checks empty collections and confirms no labeled build containers. Reports include fixture-vs-real boundaries, `cleanup` and `containerCleanup`. `--suite preview-real --fail-after-start` exercises startup failure cleanup (expected exit 1). Hard host termination is not covered.

This is not live-provider availability/quality/cost evidence, durable crash recovery or production multi-user security certification. Evidence and earlier failed runs are recorded in [the testing strategy](../docs/08_TESTING_STRATEGY.md).

### Build-gated browser-to-preview loop (Phase 1)

For manual exploration/recording rather than automated assertions, follow [the local demo guide](../docs/LOCAL_DEMO.md). `npm run demo:local` keeps isolated services running until Enter and shows an explicit fixture-AI notice. It needs no paid key or Playwright bootstrap; disposable data is cleaned on normal exit.

`preview-real` deliberately keeps its original gate-off behavior. The new opt-in `build-gate` suite enables captured build policy in the isolated test Project, real candidate checks in Execution, and the browser's 202/status flow. Both share the same actual Docker runner. Normal `.env`, Compose and application data are unchanged.

```powershell
$env:AGENTFORGE_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/agentforge_test_your_unique_gate_run'
$env:PREVIEW_RUNNER_IMAGE='agentforge-preview-runner:css-check' # choose an EXISTING trusted image with the CSS fix
$env:AGENTFORGE_BROWSER_CHANNEL='msedge' # optional; default chrome
npm run verify:workspace -- --suite build-gate
```

The launcher never pulls/builds a runner image; its preflight and fixture use the same validated image name. Docker suites remain outside default `all`.

Checks: real registration/session; Enter prompt; a test-only barrier proves 202 candidate is not a Revision; same-key pending replay adds no model request; actual build evidence appears on committed v1; a second build produces interactive preview/CSS in a sandbox iframe; refresh restores v1/proof; broken TSX fails the pre-publication check without creating v2; foreign-owner run/status access is rejected; Stop removes the iframe; replay adds no paid/model request. Only AI Orchestrator HTTP output is a deterministic transport fixture, not real provider evaluation. The barrier/counters exist solely in test composition; production source/admission/cleanup is unchanged.

Reports identify `buildGate: true`, real-vs-fixture boundaries and independent DB/container cleanup results. The deliberate `--suite build-gate --fail-after-start` case must exit 1 and still report cleanup. Never treat a failed/interrupted run as a pass. Hard OS crash durability, normal demo activation and a separately approved live-provider smoke remain outside this test.

Design reasoning and practice questions: [System Design Q&A](../docs/SYSTEM_DESIGN_QA.md).
