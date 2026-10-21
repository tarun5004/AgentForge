# AgentForge

AgentForge is a learning-focused, microservice-based AI frontend generation platform. The long-term product lets a user describe a website, review generated files, inspect terminal output, and launch an isolated preview from one developer workspace.

The repository currently contains a working Cursor-inspired frontend, authentication, project persistence, and the first synchronous AI code-generation flow. Background queues and Kubernetes previews are intentionally not presented as complete yet.

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
- authenticated prompt submission that creates a persisted draft project
- AI generation progress, success, failure, file-count, model, and token feedback
- committed AI-generated files appear in the editor and restore from the backend after refresh
- selectable code tabs with line numbers
- Terminal and Problems panels
- truthful added/modified/deleted changes; unchanged files have no fabricated badge
- targeted follow-up prompts against the visible selected revision, including historical bases
- same-key retry/status recovery for unconfirmed attempts, without silently creating another project
- mouse and keyboard accessible resizable panels on desktop
- stacked layout on smaller screens
- explicit local-demo labels wherever backend behavior is not connected

Optional sample assets remain in `workspace-data.ts`, but the editor never falls back to them. No selection, saved drafts, loading and failed loads have explicit states. Terminal output is labelled as an unconnected sample; generated projects are not executed by this UI.

The authentication forms validate input and call the Auth Service through the same-origin proxy. The short-lived access token stays only in React memory, while the refresh token stays in an HttpOnly cookie. Reloading the page restores the session through `/api/auth/refresh`, and unauthenticated workspace visits return to `/login`.

The frontend route guard is a user-experience check; every future protected backend endpoint must still validate the access token independently.

### Backend foundations

| Service | Port | Current status |
| --- | ---: | --- |
| Auth Service | `4000` | Register, login, refresh, logout, and authenticated profile endpoints |
| Project Service | `3000` | Authenticated projects, generation records, and immutable revisions in MongoDB |
| Execution Service | `5000` | Health endpoints, environment validation, run request schema, and reusable body validation |
| AI Orchestrator | `6000` | Internal Vercel AI Gateway call with schema and safe-file validation |

The Project Service no longer creates Kubernetes Pods. Runtime isolation belongs to the Execution Service and will be introduced only after the simpler project and generation flows work end to end. The Execution Service does **not** expose a completed `POST /runs` workflow yet.

Version Zero temporarily verifies Auth Service access tokens with a shared `ACCESS_TOKEN_SECRET`. The documented V1 target replaces this with asymmetric signing and JWKS verification so services never share a private signing secret.

### Project history progress (2026-10-12)

Owner-scoped project/revision reads and safe initial-generation replay are implemented. The next internal boundary is also ready: AI receives an optional bounded selected snapshot and returns complete changed files plus explicit deletion paths. Project Service independently merges these into a full snapshot, preserves omitted files, and computes added/modified/deleted changes without mutating the parent. Functions include short purpose/why comments; start with `project-service/src/services/revision-files.ts` and the AI `generation.prompt.ts` helper.

Public follow-up generation is now available in the **backend API**: submit a change prompt and an owned `baseRevisionId`. Historical parents are allowed; the new version follows the actual latest saved revision. One immutable Revision insert publishes the result, while unique indexes prevent competing attempts from silently overwriting history. Saved-result replay can retry publication without another AI call; a read-only owned generation-status endpoint reports uncertain attempts.

Slice 5 connects these contracts in the Next.js UI: `/workspace?project=<id>&revision=<id>` restores owned persisted files after session restoration. The sidebar opens saved projects and older revisions, and a prompt in an open revision creates a follow-up rather than a new project. Request state survives responsive panel remounts; obsolete GETs are aborted/ignored. A small user/project-scoped sessionStorage entry retains pending request identity only, never files or access tokens; retries reuse the exact key/prompt/base. Abandoning an attempt is an explicit local action, not server cancellation.

Real Auth/Project/Mongo browser checks used a deterministic AI transport fixture, not a paid provider. Static manifest validation still does not prove generated code builds or runs. See [the current history plan](docs/PROJECT_HISTORY_REVISION_PLAN.md) and [verified test results](docs/08_TESTING_STRATEGY.md) for exact progress and limits. Future changes use [service-scoped feature branches](docs/GIT_WORKFLOW.md); commits, PR creation and merging require explicit requests.

## Workspace layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Project header                         Branch   Preview       │
├───────────────┬──────────────────────────────┬───────────────┤
│ Chat/history  │ Code editor                  │ Changed files │
│               ├──────────────────────────────┤ Agent plan    │
│ Prompt input  │ Terminal / Problems          │               │
└───────────────┴──────────────────────────────┴───────────────┘
```

Desktop separators can resize the chat width, changes width, and terminal height. Minimum and maximum sizes keep every panel usable.

## Repository structure

```text
auth-service/          Express authentication service
project-service/       Project lifecycle and orchestration service
ai-orchestrator-service/  Model call, output schema, and generated-file safety policy
execution-service/     Isolated run and preview service foundation
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
        ├── TerminalPanel.tsx
        ├── ChangesPanel.tsx
        ├── ResizeHandle.tsx
        └── workspace-data.ts
```

## Technology choices

- **Next.js + React + TypeScript:** frontend and component state
- **Tailwind CSS:** compact responsive styling
- **react-markdown + remark-gfm:** retained Markdown helper; saved revision history currently renders plain text
- **react-resizable-panels:** constrained, keyboard-accessible IDE panel resizing
- **Lucide React:** consistent lightweight icons
- **Express + TypeScript:** backend services
- **MongoDB:** authentication and project persistence
- **Vercel AI SDK + AI Gateway:** structured model output through one provider-neutral API
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
npm install
```

Copy only the environment templates for the services you want to run. On PowerShell:

```powershell
Copy-Item auth-service/.env.example auth-service/.env
Copy-Item project-service/.env.example project-service/.env
Copy-Item ai-orchestrator-service/.env.example ai-orchestrator-service/.env
Copy-Item execution-service/.env.example execution-service/.env
Copy-Item nextjs-boilerplate/.env.example nextjs-boilerplate/.env.local
```

Never commit real `.env` files or API keys.

### Run applications

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
8. **Next:** review the history loop and close remaining automated browser acceptance gaps before starting execution work.
9. Add Execution Service runs and status tracking after bounded generated-code validation/isolation design.
10. Add BullMQ/Redis for background work.
11. Add restricted Kubernetes build and preview workloads.

This order keeps every stage runnable and explainable instead of introducing the full distributed architecture at once.

## Documentation

Detailed V1 documentation is available in [`docs`](./docs). The phase roadmap is maintained in [`docs/15_PHASE.md`](./docs/15_PHASE.md).
