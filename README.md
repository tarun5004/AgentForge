# AgentForge

AgentForge is a local AI frontend coding workspace. Chat or plan with one configured model, explicitly request a website/change, inspect saved files, and open a restricted Docker-built Preview.

**Delivery target:** a free-first localhost portfolio demo, source/design explanation, screen recording and an optional static showcase page. The full platform is not intended for public users or paid cloud deployment. Production architecture will be documented separately from what actually runs. Fixture/recorded AI output must be labelled; it is not proof of live model generation. See [current scope and cost boundaries](docs/AI_ENGINEERING_ROADMAP.md#current-product-boundary--local-portfolio-free-first-2026-10-23).

See the [current delivery, actual test evidence and remaining limits](docs/LOCAL_WORKSPACE_DELIVERY.md)
before using older milestone notes as a status report.

The repository currently contains a working Cursor-inspired frontend, authentication, project persistence, and the first synchronous AI code-generation flow. Background queues and Kubernetes previews are intentionally not presented as complete yet.

Start with the [real local setup](docs/LOCAL_DOCKER.md) and [current delivery contract](docs/AI_PORTFOLIO_DELIVERY_PLAN.md). Greetings/planning do not create projects. An explicit build/edit decision uses the existing validated generation and immutable revision pipeline; the old saved-brief APIs remain compatible, not a mandatory questionnaire. The [System Design Q&A](docs/SYSTEM_DESIGN_QA.md) explains ownership, Docker/static Preview and retry trade-offs. Optional build-before-publication remains off in normal Compose unless deliberately configured.

For a clearly labelled **zero-provider-cost manual demo**, use [`npm run demo:local`](docs/LOCAL_DEMO.md) with an explicit empty disposable MongoDB and an existing trusted runner image. It enables the real build gate/Preview in isolated local services; AI responses are fixed fixtures. Enter stops it and cleans tracked demo data. Use a private browser window so localhost cookies do not replace your normal session.

## Current Version Zero

### Frontend workspace

The Next.js workspace currently provides:

- login and registration routes connected to the Auth Service
- root navigation that starts at the login screen
- same-origin `/api/auth/*` proxy to the independent Auth Service
- in-memory access token handling and HttpOnly refresh-cookie sessions
- session restoration, protected workspace access, and logout
- Cursor-inspired dark developer interface
- paginated saved projects, revision history, and a controlled prompt composer
- authenticated conversation; only a build request creates a persisted project
- AI generation progress, success, failure, file-count, model, and token feedback
- committed AI-generated files appear in the editor and restore from the backend after refresh
- selectable code tabs with line numbers
- expandable observed activity/run reports, without fabricated terminal output
- truthful added/modified/deleted changes; unchanged files have no fabricated badge
- targeted follow-up prompts against the visible selected revision, including historical bases
- same-key retry/status recovery for unconfirmed attempts, without silently creating another project
- mouse and keyboard accessible resizable panels on desktop
- stacked layout on smaller screens
- explicit local-demo labels wherever backend behavior is not connected
- opt-in local static Preview for a selected saved revision, with build status, Stop and safe retry states

Unused sample data, sample Terminal/Problems and duplicate Changes panels were removed. The composer stays visible after replies and failures. No selection, loading and failed loads have explicit states. Preview requests a real restricted local build of saved files; the chat does not claim it ran a build unless saved execution evidence exists.

The authentication forms validate input and call the Auth Service through the same-origin proxy. The short-lived access token stays only in React memory, while the refresh token stays in an HttpOnly cookie. Reloading the page restores the session through `/api/auth/refresh`, and unauthenticated workspace visits return to `/login`.

The frontend route guard is a user-experience check; every future protected backend endpoint must still validate the access token independently.

### Backend foundations

| Service | Port | Current status |
| --- | ---: | --- |
| Auth Service | `4000` | Register, login, refresh, logout, and authenticated profile endpoints |
| Project Service | `3000` | Authenticated projects, generation records, and immutable revisions in MongoDB |
| Execution Service | `5000` status-only; opt-in host controller `5002`, preview `5101` | Owner-scoped `/api/runs`, bounded Docker static builds, status/cancel/expiry; disabled by default |
| AI Orchestrator | `6001` | Internal model call with schema and safe-file validation |

The Project Service does not create Kubernetes Pods. Execution Service owns the opt-in **local** `POST /api/runs` workflow: read owned saved files, build a trusted Next.js template in a restricted container, remove the container and serve bounded expiring static output. The frontend Preview dialog uses this API. [Setup/security limits](execution-service/README.md) and [audit evidence](execution-service/VERIFICATION.md) distinguish fixture verification from an unrun paid-provider end-to-end test. This is not a public multi-tenant sandbox or Kubernetes implementation.

Version Zero temporarily verifies Auth Service access tokens with a shared `ACCESS_TOKEN_SECRET`. The documented V1 target replaces this with asymmetric signing and JWKS verification so services never share a private signing secret.

### Project history progress (2026-10-12)

Owner-scoped project/revision reads and safe initial-generation replay are implemented. The next internal boundary is also ready: AI receives an optional bounded selected snapshot and returns complete changed files plus explicit deletion paths. Project Service independently merges these into a full snapshot, preserves omitted files, and computes added/modified/deleted changes without mutating the parent. Functions include short purpose/why comments; start with `project-service/src/services/revision-files.ts` and the AI `generation.prompt.ts` helper.

Public follow-up generation is now available in the **backend API**: submit a change prompt and an owned `baseRevisionId`. Historical parents are allowed; the new version follows the actual latest saved revision. One immutable Revision insert publishes the result, while unique indexes prevent competing attempts from silently overwriting history. Saved-result replay can retry publication without another AI call; a read-only owned generation-status endpoint reports uncertain attempts.

Slice 5 connects these contracts in the Next.js UI: `/workspace?project=<id>&revision=<id>` restores owned persisted files after session restoration. The sidebar opens saved projects and older revisions, and a prompt in an open revision creates a follow-up rather than a new project. Request state survives responsive panel remounts; obsolete GETs are aborted/ignored. A small user/project-scoped sessionStorage entry retains pending request identity only, never files or access tokens; retries reuse the exact key/prompt/base. Abandoning an attempt is an explicit local action, not server cancellation.

Real Auth/Project/Mongo browser checks used a deterministic AI transport fixture, not a paid provider. Static manifest validation still does not prove generated code builds or runs. See [the current history plan](docs/PROJECT_HISTORY_REVISION_PLAN.md) and [verified test results](docs/08_TESTING_STRATEGY.md) for exact progress and limits. Future changes use [service-scoped feature branches](docs/GIT_WORKFLOW.md); commits, PR creation and merging require explicit requests.

## Workspace layout

Desktop: chat/activity/history and the persistent composer on the left; saved-file editor on the right.
Preview opens in a dialog. The separator resizes the chat/editor split. Small screens stack both panels;
history/changes use the sidebar rather than extra permanent panels.

## Repository structure

```text
auth-service/          Express authentication service
project-service/       Project lifecycle and orchestration service
ai-orchestrator-service/  Model call, output schema, and generated-file safety policy
execution-service/     Opt-in local static build and preview service
nextjs-boilerplate/    Next.js AgentForge workspace UI
docs/                  Product, architecture, API, security, and phase docs
k8s/                   Early Kubernetes manifests
```

Important frontend files:

```text
nextjs-boilerplate/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx               Redirects `/` to `/login`
│   ├── login/page.tsx
│   ├── register/page.tsx
│   └── workspace/page.tsx
└── components/
    ├── auth/AuthForm.tsx
    └── workspace/
        ├── WorkspaceShell.tsx
        ├── ChatPanel.tsx
        ├── CodeWorkspace.tsx
        ├── EditorPanel.tsx
        ├── ConversationTimeline.tsx
        ├── PreviewLauncher.tsx
        ├── ResizeHandle.tsx
        └── useWorkspace.ts
```

## Technology choices

- **Next.js + React + TypeScript:** frontend and component state
- **Tailwind CSS:** compact responsive styling
- **react-markdown + remark-gfm:** restricted assistant Markdown without raw HTML or external embeds
- **react-resizable-panels:** constrained, keyboard-accessible IDE panel resizing
- **Lucide React:** consistent lightweight icons
- **Express + TypeScript:** backend services
- **MongoDB:** authentication and project persistence
- **Vercel AI SDK + direct Google or AI Gateway:** structured model output through one application model boundary
- **Redis + BullMQ:** planned background generation/execution jobs
- **Kubernetes:** planned isolated build and preview workloads

Monaco Editor is intentionally deferred. Version Zero uses a readable code viewer so the UI and data flow stay easy to understand before real file editing is introduced.

## Local setup

### Requirements

- Node.js `22` or newer
- npm
- MongoDB for the Auth Service and Project Service
- Redis will be required later when BullMQ workers are connected

### Install

```bash
npm ci
```

Create missing environment files only; never overwrite an existing key/configuration. On PowerShell:

```powershell
foreach ($service in @('auth-service','project-service','ai-orchestrator-service','execution-service')) {
  if (!(Test-Path "$service/.env")) { Copy-Item "$service/.env.example" "$service/.env" }
}
if (!(Test-Path 'nextjs-boilerplate/.env.local')) {
  Copy-Item 'nextjs-boilerplate/.env.example' 'nextjs-boilerplate/.env.local'
}
```

Never commit real `.env` files or API keys.

### Run applications

For a one-command local Docker stack, see [Local Docker Compose](docs/LOCAL_DOCKER.md).
It starts all five apps plus isolated MongoDB; it does not execute generated code or make AI usage free.
The optional local preview controller is started separately on the trusted host, following [Execution setup](execution-service/README.md); no Docker socket is mounted into the app containers.

Run each required application in its own terminal:

```bash
npm run dev:web
npm run dev:auth
npm run dev:project
npm run dev:ai
npm run dev:execution
```

Open the frontend at `http://localhost:3001`. The root route redirects to `/login`; the standalone workspace prototype is available at `/workspace`.

## Verification commands

For repeatable browser verification with launcher-owned local servers and scoped cleanup, see [the frontend verification guide](nextjs-boilerplate/README.md#one-command-local-verification-recommended). It requires an explicit empty local `agentforge_test_*` database and never executes generated code or calls a paid provider. [The M1 acceptance review](docs/M1_ACCEPTANCE_REVIEW.md) separates implemented functionality from actual evidence and remaining scope.

```bash
npm run build:web
npm run build:auth
npm run build:project
npm run build:ai
npm run build:execution
```

Frontend lint:

```bash
npm --workspace nextjs-boilerplate run lint
```

Execution Service typecheck:

```bash
npm --workspace execution-service run typecheck
```

## Beginner-first implementation order

1. **Complete:** build and understand the workspace UI.
2. **Complete:** build login/register UI with local form validation.
3. **Complete:** secure frontend-to-Auth-Service login, registration, refresh, logout, and workspace protection.
4. **Complete:** create authenticated draft projects from the workspace and persist them in MongoDB.
5. **Complete:** send a saved prompt through Project Service to the AI Orchestrator and persist a validated revision.
6. **Complete:** display a successful generation's real files in the workspace editor.
7. **Implemented:** reopen saved projects/revisions, restore after refresh, and submit targeted follow-ups. Deterministic browser checks passed; a complete repeatable CI browser suite remains future work.
8. **Implemented:** audited local Execution API, Docker static builds, cancellation/cleanup acknowledgement and expiry; frontend Preview wiring and zero-cost regression checks.
9. **Next:** controlled real-provider-to-preview smoke (only with approval), remaining integration/CI evidence and dependency remediation before any public execution deployment.
10. Add BullMQ/Redis for background work.
11. Add restricted Kubernetes build and preview workloads.

This order keeps every stage runnable and explainable instead of introducing the full distributed architecture at once.

## Documentation

Detailed V1 documentation is available in [`docs`](./docs). The phase roadmap is maintained in [`docs/15_PHASE.md`](./docs/15_PHASE.md).
