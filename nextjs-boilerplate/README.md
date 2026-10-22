# AgentForge Frontend

This Next.js application provides AgentForge's authentication screens and Cursor-inspired AI development workspace.

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

A protected Project API `401` clears the cached user/access token before redirecting to `/login`. Redirecting alone would let AuthForm send the stale user back to the workspace repeatedly. `invalidateSession` is a stable client callback; it does not revoke refresh cookies or replace the existing server logout flow. Pending generation keys stay user/project-scoped for later reconciliation after sign-in.

Authenticated workspace prompts call `POST /api/projects`. The Project Service validates the access token and prompt, then saves a draft project before any AI generation begins.

## Saved project and revision loop

- New conversation creates a draft once; initial generation uses its returned project ID.
- Saved projects/history come from paginated owner-scoped Project API reads, not mock chats.
- `/workspace?project=<id>&revision=<id>` restores the selected snapshot after AuthProvider restores a session. A project-only link loads its actual latest revision; a saved draft has an empty editor.
- A follow-up sends `{ prompt, baseRevisionId }` for the visible selected revision. Older parents are clearly labelled; published version order and parentage differ.
- `useWorkspace.ts` keeps request/selection/prompt state above responsive panels. Abortable reads cannot overwrite another selected project's files.
- Pending intent (key/prompt/base/optional generation ID) is stored in user/project-scoped sessionStorage, without tokens or generated code. Explicit retry reuses it; confirmed failures/new submissions use new keys. Disabled storage preserves in-session retries but cannot guarantee intent recovery after refresh.
- Committed POST files remain visible if metadata reload fails. Deleted paths are shown as D, never selectable as current files; unchanged files receive no change badge. Legacy provenance is labelled unknown.
- Preview/execution/build diagnostics remain unconnected, with sample terminal output explicitly labelled.

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
