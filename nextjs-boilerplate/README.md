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
