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
