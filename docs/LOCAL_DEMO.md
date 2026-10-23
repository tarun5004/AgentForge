# AgentForge — free local demonstration

This mode is for exploring/recording the workflow without model bills. **AI output is a deterministic fixture**, not a live model response or a personalised design. Real Auth, Project API, MongoDB, candidate build verification, Docker static export and browser Preview are used. The AI Orchestrator runtime itself is not started or evaluated by this mode.

## Start

Requirements: Windows PowerShell, Node 22+, installed workspace dependencies (`npm ci`), local MongoDB and Linux Docker Desktop. Prepare a trusted runner image using [Execution setup](../execution-service/README.md). The launcher inspects the selected existing image; it never pulls/builds one automatically. Ordinary Compose services can stay running; this demo uses separate ports and data.

From the repository root:

```powershell
# Must be an EMPTY disposable database, never your normal application database.
$env:AGENTFORGE_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/agentforge_test_my_local_demo'
# Select your existing trusted image with the CSS import fix.
$env:PREVIEW_RUNNER_IMAGE='agentforge-preview-runner:css-check'
npm run demo:local
```

Open **http://localhost:3102/register in a fresh InPrivate/incognito window**. Use a disposable name/email/password. Do not reuse a normal localhost browser profile: cookies are scoped to a hostname, not a port, so the demo's refresh cookie could replace another localhost session. Ports 3102/4310/4311/4312/5310/5311 must be free; the launcher never kills existing services to free them.

The amber **Fixture AI · local demo** notice must be visible. The launcher overrides its child-process service URLs and fake credentials without editing `.env`. `AGENTFORGE_LOCAL_DEMO=1` alone is only a label, **not a billing switch**. Do not enable that flag in a normal paid-provider session and assume it prevents charges.

## Four-minute recording outline

1. Say: “The AI response is a fixture to avoid token costs. Authentication, persistence and restricted Docker builds are real.” Show the amber notice.
2. Register and submit `Build a portfolio website page` using Enter. Show the pending candidate, then v1 with **static build verified**. Initial fixture output is the same interactive counter page for any normal initial prompt.
3. Open Preview. The saved files undergo another real static build. Click **Count 0 → Count 1**. The build container is removed; Preview serves exported HTML/JS/CSS, not a long-running generated backend or Kubernetes Pod.
4. Stop/close Preview and refresh the page. The real session and stored revision restore without asking AI again.
5. Submit `Return broken preview syntax for this change`. Its deterministic invalid TSX must fail the build gate; v1 stays available. This demonstrates failure preservation, not AI repair.
6. Optionally submit `Make a small change` to obtain a fixed follow-up page and v2; it is not a model interpreting your requested styling. `remove old` also explicitly deletes the fixture's old component.
7. Return to the launcher terminal and press **Enter**. Wait for the cleanup report before closing it. Close the private browser window. The demo is disposable, not a persistent project workspace.

## What shutdown does

- Cancels/awaits owned build work, closes owned listeners and removes only tracked registration accounts and their owned Project/Generation/Revision records (plus the existing fixture accounts).
- Independently checks all four collections are empty and no labelled preview containers remain. Unknown records are preserved and cause a failing cleanup report; the database is never dropped.
- Writes an ignored summary to `output/playwright/verification-*.json`. `manualDemo.started/stopped` describe launcher lifetime, **not automatic proof that a person completed the browser flow**.
- Enter/EOF and ordinary handled termination return to cleanup. Hard process kill/power loss cannot guarantee it. Inspect leftovers rather than broad-deleting them or treating an interrupted run as a pass.

No Playwright installation/bootstrap is needed just to use manual mode. Repeatable browser assertions remain separate:

```powershell
npm run test:verification
npm run test:demo-accounts
# Uses an explicitly selected empty disposable DB, existing image and installed browser.
$env:AGENTFORGE_BROWSER_CHANNEL='msedge'
npm run verify:workspace -- --suite build-gate
```

Do not run the automated launcher while the manual one owns the same ports. Neither fixture mode evaluates live provider credentials, model quality or real token prices. Normal configured AI requests outside this isolated composition may still incur charges.
