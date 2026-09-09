# AgentForge

AgentForge is a learning-focused, microservice-based AI frontend generation platform. The long-term product lets a user describe a website, review generated files, inspect terminal output, and launch an isolated preview from one developer workspace.

The repository currently contains a working Cursor-inspired frontend prototype, a functional authentication service, and early Project/Execution service foundations. AI generation, background queues, and Kubernetes previews are intentionally not presented as complete yet.

## Current Version Zero

### Frontend workspace

The Next.js workspace currently provides:

- login and registration routes connected to the Auth Service
- root navigation that starts at the login screen
- same-origin `/api/auth/*` proxy to the independent Auth Service
- in-memory access token handling and HttpOnly refresh-cookie sessions
- session restoration, protected workspace access, and logout
- Cursor-inspired dark developer interface
- chat history, local prompt composer, and Markdown response rendering
- selectable code tabs with line numbers
- Terminal and Problems panels
- changed-files list and sample agent plan
- mouse and keyboard accessible resizable panels on desktop
- stacked layout on smaller screens
- explicit local-demo labels wherever backend behavior is not connected

The sample prompts, files, tasks, and terminal output live in `workspace-data.ts`. They demonstrate the UI only and are not claimed as real AI output.

The authentication forms validate input and call the Auth Service through the same-origin proxy. The short-lived access token stays only in React memory, while the refresh token stays in an HttpOnly cookie. Reloading the page restores the session through `/api/auth/refresh`, and unauthenticated workspace visits return to `/login`.

The frontend route guard is a user-experience check; every future protected backend endpoint must still validate the access token independently.

### Backend foundations

| Service | Port | Current status |
| --- | ---: | --- |
| Auth Service | `4000` | Register, login, refresh, logout, and authenticated profile endpoints |
| Project Service | `3000` | Early orchestration foundation; still contains the original Kubernetes experiment |
| Execution Service | `5000` | Health endpoints, environment validation, run request schema, and reusable body validation |
| AI Orchestrator | — | Planned after the frontend-to-project flow is understood |

The Execution Service does **not** expose a completed `POST /runs` workflow yet. BullMQ, Redis-backed workers, and Kubernetes execution will be introduced only after the simpler request flow works end to end.

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
- **react-markdown + remark-gfm:** safe Markdown and GitHub-flavored Markdown rendering
- **react-resizable-panels:** constrained, keyboard-accessible IDE panel resizing
- **Lucide React:** consistent lightweight icons
- **Express + TypeScript:** backend services
- **MongoDB:** authentication data; project persistence is planned
- **Redis + BullMQ:** planned background generation/execution jobs
- **Kubernetes:** planned isolated build and preview workloads

Monaco Editor is intentionally deferred. Version Zero uses a readable code viewer so the UI and data flow stay easy to understand before real file editing is introduced.

## Local setup

### Requirements

- Node.js `22` or newer
- npm
- MongoDB for the Auth Service
- Redis will be required later when BullMQ workers are connected

### Install

```bash
npm install
```

Copy only the environment templates for the services you want to run. On PowerShell:

```powershell
Copy-Item auth-service/.env.example auth-service/.env
Copy-Item project-service/.env.example project-service/.env
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
npm run dev:execution
```

Open the frontend at `http://localhost:3001`. The root route redirects to `/login`; the standalone workspace prototype is available at `/workspace`.

## Verification commands

```bash
npm run build:web
npm run build:auth
npm run build:project
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
4. Implement a real Project create endpoint and persistence.
5. Send one prompt from Project Service to one AI provider.
6. Display real generated files in the workspace.
7. Add Execution Service runs and status tracking.
8. Add BullMQ/Redis for background work.
9. Add restricted Kubernetes build and preview workloads.

This order keeps every stage runnable and explainable instead of introducing the full distributed architecture at once.

## Documentation

Detailed V1 documentation is available in [`docs`](./docs). The phase roadmap is maintained in [`docs/15_PHASE.md`](./docs/15_PHASE.md).
