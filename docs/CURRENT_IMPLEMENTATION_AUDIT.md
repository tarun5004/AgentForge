# AgentForge Current Implementation Audit

## Current retrospective addendum — 2026-10-23

This section supersedes the stale capability classifications in the **historical M0 audit below**. Baseline inspected: `main` `ab783d1`; A1 implementation is isolated on `feature/ai-orchestrator-requirement-clarification`. No paid model, application MongoDB probe/write, normal Compose reconfiguration or public deployment was performed in this review.

| Finding | Current source evidence | Consequence |
| --- | --- | --- |
| Live model integration exists | AI `src/features/generations/generation.service.ts` calls Gateway `generateText` + `Output.object`; `generation.prompt.ts` bounds scope. | Do not build a second unrelated model integration. A passing mocked SDK/HTTP test does not establish provider auth or quality. |
| Project history/replay exist | Project `generation.service.ts`, `generation.publication.ts`, revision repositories/routes. | Preserve immutable publication/idempotency; the M0 missing-history findings are historical. |
| Direct-to-generation UI, no requirement conversation | Frontend `components/workspace/useWorkspace.ts` `submit` creates a project and calls `generateProject`; Project forwards generation intent. No brief/clarification endpoint was present before A1. | First missing user outcome is clarification and user-confirmed brief, not more fixture output. |
| Actual build/preview, not general agent tools | Execution `candidate.check.ts`, `docker.runner.ts`, `preview.server.ts`; frontend `PreviewLauncher.tsx`. | Real local static output exists. Builds are server-triggered, not LLM tool calls; no live terminal/general backend runtime/Kubernetes implementation claim. |
| Gate is opt-in; recovery isn't durable scheduling | Project `config/env.ts` defaults `BUILD_GATE_ENABLED` false; candidate worker lives in-process. | Show actual mode/proof; do not infer worker crash recovery or a mandatory safety scan from build success. |
| Runtime RAG/MCP/Python evaluation absent in reviewed paths | Memory design is explicitly target-only; workspace package scripts/dependencies and service paths do not wire a retriever, vector store, MCP server or Python eval runtime. No `.github/workflows` directory found. | Add meaningful evidence-producing slices, not a framework rename. |
| Current dependency advisory gate is not clean | Fresh `npm audit --json`: 11 findings (2 critical, 8 high, 1 moderate). Packages include direct `next` and transitive `proxy-addr`; dev/tooling chains also contribute. | Separate scoped advisory/exposure review and compatible patch tests. Do not claim all findings exploitable or run broad auto-fix. Keep host-local restriction. |

**Safe checks actually executed before A1:** AI tests 26/26, Project tests 30/30, Execution tests 45/45, frontend unit tests 33/33; all exit 0. These are unit/contract checks, not new Mongo/Docker/browser/live-provider runs. Fresh npm audit is a finding, **not a pass**. The complete unauthenticated Gateway model catalog was fetched: 478 entries, current source default listed; this proves listing only, not account access/structured-output quality. Installed SDK 7.0.105 versus npm-reported 7.0.150 is the same major; no dependency upgrade was made.

**Retrospective correction:** previous work conflated zero-cost fixture verification with the user's intended main experience. Keep the fixtures for tests, but the release must support a real configured model that clarifies, generates and feeds the existing local Preview. Another source of complexity was repeated overlapping milestone plans; [the stable delivery contract](AI_PORTFOLIO_DELIVERY_PLAN.md) now defines outcome/acceptance order. No evidence supports deleting ownership, immutable history, build bounds or tests as “overengineering”; those protect the real workflow. New services/queues/frameworks need a demonstrated purpose.

**A1 change/validation:** added strict requirement input/output schemas, a pure bounded prompt builder, existing Gateway/SDK assessment with timeout/output caps and zero SDK retries, an internal authenticated route, route-specific sanitized errors and explicit unknown-usage metadata. AI suite **39/39** (13 new cases), typecheck, build and whitespace checks passed. Tests use the real SDK mock provider and real loopback HTTP with non-loopback fetches refused; they are not live-model evaluation. This is not yet persisted or connected to the UI. Legacy generation API behavior remains unchanged. See the AI Service README for the exact contract/limits.

---

## Historical M0 audit (2026-10-10)

**Audit date:** 2026-10-10

**Milestone:** M0 — audit and architecture baseline

**Scope:** Repository inspection, safe local checks, current-state classification, and risk discovery. No application code was changed.

## Status definitions

- **Implemented:** The capability is wired into the running product path and has direct code evidence.
- **Partial:** A useful slice exists, but the complete user outcome or operational protection is missing.
- **Planned:** Documentation describes the capability, but the current application path does not implement it.
- **Not started:** No meaningful implementation was found.
- **Blocked / unverified:** Code may exist, but this audit could not prove it safely in the available environment.

## Current system shape

```text
Browser (Next.js)
  ├─ /api/auth/*     -> Auth Service -> MongoDB
  └─ /api/projects/* -> Project Service -> MongoDB
                                  |
                                  └─ synchronous HTTP -> AI Orchestrator -> Vercel AI Gateway

Execution Service: health/readiness shell only; not connected to the user flow.
Redis: configuration placeholder only; no queue client or worker is wired.
Kubernetes: old Auth/Project manifests only; not the current complete system.
```

The working vertical slice is therefore: authenticate → create a project → synchronously generate a frontend manifest → persist one generation and one revision → show returned files in browser state.

## Evidence-backed capability matrix

| Area | Status | Repository evidence | Main gap / consequence |
|---|---|---|---|
| Monorepo service boundaries | Implemented | Root workspaces separate Auth, Project, AI Orchestrator, Execution, and Next.js UI. | Root scripts do not provide one-command lint, test, typecheck, or build verification. |
| Registration, login, refresh, logout, `/me` | Partial | Routes are mounted at `auth-service/src/routes/auth.routes.ts:22-50`; the refresh token hash is stored at `auth-service/src/models/user.model.ts:27`. | No automated auth tests, rate limiting, refresh-session collection, issuer/audience checks, or multi-device session management. |
| Browser auth lifecycle | Partial | `nextjs-boilerplate` keeps the access token in memory and uses an HttpOnly refresh cookie; `/workspace` uses `RequireAuth`. | Client guard is UX-only, and no end-to-end auth test proves refresh/reload behavior. |
| Project creation and ownership | Partial | The authenticated create route is at `project-service/src/routes/project.routes.ts:11`; owner-scoped lookup is at `project-service/src/repositories/project.repository.ts:17-18`. | No list, read, rename, archive, or delete endpoints, so a saved project cannot be reopened. |
| Initial AI generation | Implemented | The generation route is at `project-service/src/routes/project.routes.ts:13-16`; the synchronous downstream request and 90-second timeout are at `project-service/src/clients/ai-orchestrator.client.ts:26-38`. | Long requests tie up both services; provider failure classification and retry policy are absent. |
| Idempotency | Partial | Header validation starts at `project-service/src/services/generation.service.ts:20`; `{projectId, idempotencyKey}` is unique at `project-service/src/models/generation.model.ts:78`. | Check-then-create can race; duplicate-key handling is not converted into a stable idempotent response. |
| Revision persistence | Partial | Version reservation is at `project-service/src/repositories/project.repository.ts:28-39`; revision uniqueness is at `project-service/src/models/revision.model.ts:39`. | Writes are not transactional; revisions lack parent, source prompt, validation result, changed-file metadata, and an explicit latest-revision pointer. |
| Project reload and revision history | Not started | No GET project/revision routes were found; generated files live in `WorkspaceShell` state. | A browser refresh returns to demo files and loses the usable generated workspace. |
| Follow-up editing | Not started | `nextjs-boilerplate/components/workspace/ChatPanel.tsx:57-71` creates then generates a new project; `project-service/src/services/generation.service.ts:94` always sends `initialPrompt`. | Users cannot ask “change the hero section” against an existing revision. |
| AI request contract | Partial | `ai-orchestrator-service/src/features/generations/generation.schema.ts:3-8` restricts the request; structured generation is at `generation.service.ts:20-25`. | Only one model path exists; no provider adapter, routing, fallback, policy version, or prompt version is recorded. |
| Generated-output safety | Partial | Backend routes/server actions are rejected at `generation.schema.ts:53-66`; four cases live in `generation.schema.test.ts` and passed. | No dependency allowlist, AST/static analysis, secret scan, build/typecheck, or sandbox execution validates generated code. |
| Execution Service API | Not started | The unused body schema is at `execution-service/src/features/runs/run.schema.ts:8`; `execution-service/src/app/app.ts:32-36` mounts only status routes. | No `/runs` route, auth, ownership check, persistence, queue producer, logs, cancel endpoint, or status endpoint. |
| Queue / worker | Not started | `REDIS_URL` is parsed only. No BullMQ/Redis client or worker dependency is wired. | There is no asynchronous job lifecycle or retry/dead-letter behavior. |
| Sandboxed execution | Not started | No runner, container job, Kubernetes Job, resource limit, network policy, or cleanup controller exists. | Generated code must not be treated as safe to execute. |
| Logging and observability | Partial | Execution Service has Pino, request IDs, and redaction; other services expose basic logs/health routes. | Logging is inconsistent; no trace propagation, metrics, dashboards, alerts, or real dependency readiness probes. |
| Automated tests | Partial | AI Orchestrator has four manifest contract/safety tests. | Auth, Project, Execution, frontend, integration, contract, and end-to-end coverage are absent. |
| CI/CD | Not started | No `.github/workflows` files were found. | Nothing automatically enforces build, test, audit, image, or manifest quality on a pull request. |
| Kubernetes deployment | Partial / stale | `k8s/project-deployment.yml:17` assigns `resource-manager`; `k8s/rbac.yml:9-30` defines/binds its ClusterRole. | Auth lacks required `NODE_ENV`; Project lacks required internal-service configuration; AI/Execution are missing; no TLS or NetworkPolicy. |
| Engineering memory / retrieval | Not started | No memory schema, indexer, retriever, embeddings, vector store, or evaluation harness was found. | The model cannot reuse verified project knowledge or measure retrieval quality. |
| Obsidian integration | Not started | No vault scanner, safe path rules, sync format, or connector exists. | Local notes cannot safely contribute context. |
| MCP integration | Not started | No MCP client/server dependency, transport, tool registry, or policy layer was found. | MCP is documented aspiration, not a current capability. |

## Required audit answers

### 1. What works today?

The repository can build all five workspaces. Auth Service can connect to the configured MongoDB and exposes a working health endpoint. The browser can register/login, create a project, request an initial frontend generation, receive validated structured files, and render those files in the editor UI. AI Orchestrator authentication, request validation, and manifest safety checks respond with the expected HTTP status codes.

### 2. What is partial?

Authentication, project ownership, generation persistence, revision numbering, AI output validation, logging, and Kubernetes manifests all have a useful foundation but lack the tests, recovery paths, production controls, or complete user journeys needed to call them finished.

### 3. What is mocked or demo-only?

Recent chats, the terminal, agent plan, and initial editor/change-list content are static UI data. Generated files replace the editor state only for the current browser session. Execution status is not connected to an actual runner.

### 4. What is missing?

Saved-project reopening, revision history APIs, follow-up revisions, project-aware generation context, Execution Service routes/workers, safe sandboxing, CI, end-to-end tests, consistent observability, memory/retrieval, Obsidian access, and MCP integration are missing.

### 5. Where are the important risks?

1. **Critical dependency exposure:** `npm audit` reports 11 known issues: 2 critical, 8 high, and 1 moderate. The direct Next.js dependency is within an affected range and has a non-major fix available.
2. **Unsafe future execution boundary:** output validation is useful, but it is not enough to execute untrusted AI code. Execution must remain disconnected until isolation, limits, networking, logs, timeouts, and cleanup are implemented and tested.
3. **Persistence consistency:** generation, revision creation, revision-number reservation, and project state changes are separate MongoDB writes. A mid-flow failure can leave partial or misleading state.
4. **Authentication hardening:** symmetric shared access-token secrets, missing issuer/audience validation in Auth, no rate limits, and one refresh token per user are below the documented V1 security target.
5. **Excess Kubernetes privilege:** Project Service currently receives cluster-wide pod/service permissions even though its current code no longer manages Kubernetes.
6. **Documentation drift:** several existing documents describe queues, provider routing, JWKS, complete Project APIs, execution Jobs, CI, and observability as if implemented. Current code does not support those claims.

### 6. Does the product have a real persisted project flow?

Only the write half. Project, generation, and revision documents are persisted, but no read/history endpoints let a user restore them. The frontend therefore behaves as session-only despite database writes.

### 7. Can the system perform a second targeted revision?

No. Each chat submission creates a new project, and the generation service always uses the original prompt. No base revision, current file set, parent revision, or requested change is passed to the model.

### 8. Is the execution path real?

No. The service starts and exposes health/readiness, but readiness does not check Redis and the run schema is not mounted on an API route. There is no queue or execution worker.

### 9. Are memory, Obsidian, or MCP capabilities real?

No. They are target architecture topics only. The safe design baseline is documented separately in `ENGINEERING_MEMORY_DESIGN.md`.

## Cross-service flow findings

### Current successful generation path

1. `ChatPanel` validates a non-empty prompt in the browser.
2. The frontend calls `POST /api/projects`; the Next.js rewrite forwards it to Project Service.
3. Project Service authenticates the HMAC access token and persists a draft project owned by `sub`.
4. The frontend calls `POST /api/projects/{id}/generations` with a random idempotency key.
5. Project Service verifies ownership, creates a pending Generation, and calls AI Orchestrator using a static internal token.
6. AI Orchestrator requests one structured frontend manifest from the configured AI Gateway model and validates paths/content.
7. Project Service saves the result, reserves a revision number, saves a Revision, and marks Generation/Project ready.
8. The browser maps returned files into editor state. It does not fetch them again after reload.

### Failure semantics

- Auth and validation errors generally reach the caller, but error shapes differ between services.
- Project Service collapses downstream generation failures into `AI_GENERATION_FAILED` and HTTP 502, losing actionable categories.
- There is no database transaction around the multi-write success path.
- There is no durable async recovery when the HTTP request or service process stops.

## Documentation drift that must be corrected during implementation

- Treat `docs/15_PHASE.md` as the existing product roadmap, not proof of implementation.
- `docs/02_SDD.md`, `03_TDD.md`, `05_OPENAPI_SPEC.md`, `07_DEPLOYMENT_ARCHITECTURE.md`, `13_CICD_DOCUMENTATION.md`, and `14_OBSERVABILITY_DOCUMENTATION.md` contain target-state behavior beyond current code.
- New work should update the relevant contract/design document in the same milestone that implements the behavior.

## Verification record

| Safe command / check | Exact result | Evidence / limitation |
|---|---|---|
| `git status --short` | One untracked user input file before M0 docs | Only `AgentForge_Codex_Master_Plan_Audited.md`; no pre-existing tracked edits were found. |
| `npm ci` | Failed | Windows `EPERM` while unlinking the Tailwind native binary. |
| `npm install` | Passed | Restored dependencies; tracked manifests and lockfile did not change. |
| `npm ls --depth=0` | Exit 0 | All five workspaces resolved; six optional WASM/native helper packages were reported as extraneous. |
| `npm run build --workspace=auth-service` | Passed | TypeScript build completed. |
| `npm run test --workspace=auth-service` | Failed | Package script intentionally exits with `Error: no test specified`. |
| Auth process + HTTP GET checks | Health 200; readiness 404 | Mongo connection succeeded. No auth business request or user-data mutation was performed. |
| `npm run typecheck --workspace=project-service` | Passed | TypeScript reported no error. |
| `npm run build --workspace=project-service` | Passed | Build completed. |
| Project process startup | Unverified | Startup did not complete within the audit window while opening its Mongo connection; it was stopped without sending business requests. |
| `npm run test --workspace=ai-orchestrator-service` | Passed: 4/4 | Contract, safe manifest, backend/server-action rejection, and duplicate-path rejection passed. |
| AI workspace `typecheck` and `build` scripts | Passed | TypeScript checks and build completed. |
| AI process + HTTP checks | 200 / 401 / 400 | Health, missing internal token, and authorized invalid-body cases behaved as expected. No paid model request was made. |
| Execution workspace `typecheck` and `build` scripts | Passed | TypeScript checks and build completed. |
| Execution process + HTTP GET checks | Health 200; readiness 200 | Readiness is misleading because it does not connect to Redis; local Redis was not listening. |
| `npm run lint --workspace=nextjs-boilerplate` | Passed | ESLint reported no error. |
| `npm run build --workspace=nextjs-boilerplate` | Passed | Next.js 16.3.1 generated `/`, `/login`, `/register`, and `/workspace`. |
| `npm audit --json` | Failed quality gate | 11 vulnerabilities: 2 critical, 8 high, 1 moderate. |
| `docker version --format ...` | Blocked | Docker CLI 29.7.2 exists, but the Docker Desktop daemon was not running. Images were not built. |
| `kubectl version --client --output=yaml` | Passed | Client v1.36.1 is installed. |
| `kubectl create --dry-run=client --validate=false -f k8s -o name` | Blocked | No cluster/API server context was available; discovery against localhost:8080 failed. |

## Explicitly unverified

- A real provider generation with live AI credentials, token cost, latency, and generated-project build quality.
- Auth register/login/refresh against disposable test users; no production or user data was mutated during this audit.
- Project Service runtime and the complete browser → Project → AI → MongoDB flow.
- Docker image builds and Kubernetes resource admission.
- Browser-level responsive/accessibility/end-to-end behavior.
- Load, concurrency, idempotency races, provider timeout recovery, and database failure recovery.

## M0 conclusion

AgentForge has a credible initial-generation demo and understandable service boundaries, but it is not yet an execution platform. The highest-value next step is to complete the persisted project/revision loop before adding queues, Kubernetes execution, embeddings, vector databases, Obsidian, or MCP. That recommendation and its acceptance criteria are defined in `AI_ENGINEERING_ROADMAP.md`.
