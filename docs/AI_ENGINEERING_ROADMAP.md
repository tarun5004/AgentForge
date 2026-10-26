# AgentForge AI Engineering Roadmap

**Baseline:** M0 audit completed on 2026-10-10

**Purpose:** Convert the current synchronous generation demo into a reliable, explainable code-generation platform through small, verifiable milestones.

## Conversation reliability extension — 2026-10-26

Current verified core and real-provider evidence are in [Local workspace delivery](LOCAL_WORKSPACE_DELIVERY.md).
The user requested four next features and an explainable design: streaming, durable chat history,
stronger evaluations and bounded build repair. These extend the existing services; no new framework,
queue, vector database or public deployment is needed. Older dated roadmap sections below are historical.

### 1. Streaming: transport, not permission to execute

Proposed full path: browser authenticated POST -> Next proxy -> Project owner/context validation ->
AI SDK model stream -> Project SSE relay -> browser provisional text -> validated final response.

- Use `fetch` with a POST body and existing bearer JWT, reading the response body incrementally.
  Native `EventSource` cannot conveniently send that POST body or arbitrary authorization headers.
  SSE is one-way HTTP streaming; WebSockets are unnecessary for this request/response flow.
- Frames are `start`, cumulative `message`, `complete`, or terminal `error`. Never split a finished
  response with a timer and call that model streaming. Only final validated decisions can start generation.
- Preserve the old JSON route. Add separate streaming routes so existing clients/tests remain compatible.
- Project must verify correlation, schemas, per-event and total byte limits before relaying; it must
  not blindly proxy provider payloads. Disable proxy buffering and propagate cancellation upstream.
- A disconnect or EOF without `complete` means interrupted, not a successful reply/build. Do not retry
  automatically: another call can cost money. Keep the composer and original user message available.

**Current slices:** AI's internal additive SSE endpoint is merged through PR #46 (97 tests, build/typecheck).
Project's owner-scoped durable chat and bounded SSE relay are implemented on their focused branch;
browser consumption and cross-browser UI checks are not yet implemented.
Streaming generated file contents is not part of this first text-response feature; revisions remain atomic.

### 2. Durable history: database is truth, browser is presentation

Proposed ownership stays in Project Service and the existing MongoDB. Store conversations independently
of generated projects so greetings/plans can be saved without inventing an empty project.

- A conversation stores `ownerId`, title, optional project link and timestamps. Each turn stores its
  client request key, user text, selected project/base IDs, state, timestamp and final response.
  Implementation refinement: cap each conversation at 100 embedded turns. This makes admission and
  completion atomic on standalone Mongo without multi-document transactions. Read 20 turns per page;
  start a new conversation at the cap. Do not turn this into an endlessly growing array.
- JWT `sub` supplies owner identity. Every list/read/append checks ownership; never accept `ownerId`
  from the browser. A new browser logged into the same account queries the same database records.
- A single atomic admission predicate rejects existing request keys and concurrent pending turns;
  this is the embedded-document alternative to a unique turn-collection index. Reserve a turn before
  inference; save the validated final response before `complete`.
  Same-key replay reads saved completion without calling the provider again.
- Store pending/interrupted outcomes explicitly. A crash after provider work but before save is unknown,
  not proof that retry is free. No queue or automatic restart inference is implied by durable chat storage.
- Paginate display history but send only a bounded recent context window to the model. History storage
  and model context are separate: saving 100 messages does not mean paying to resend all 100 each turn.
- Test same-account fresh-browser restoration, cross-owner denial, duplicate keys, response loss,
  concurrent submits and failures. Existing browser-only history is not silently backfilled.

### 3. Evaluations: fixed cases, separate graders, measurable reports

Build on the existing reviewed routing cases, contract graders and opt-in live harness. Keep expected
behavior independent of the model. Reports must distinguish deterministic tests from live model quality.

- Routing checks: greeting/plan -> reply, essential detail -> clarify, explicit build/edit -> build.
- Code checks: schema/manifest -> real compiler/build -> browser assertion (for example a working counter).
  A syntactically valid JSON response is not build or usability proof.
- Report case ID, test/prompt version, model, pass/fail reasons, first-text and total latency, actual
  reported token usage, and build/browser evidence only where measured. Unknown usage stays unknown.
- Summarize pass rate and latency distributions; compare runs on identical reviewed cases. Do not call
  mocked responses a benchmark or use an LLM judge to certify its own output as correct.
- Default commands are zero-provider-cost; live evaluation requires explicit flags, a small case limit
  and reviewed model/cost bounds. Stop on provider failure without automatic retries.

### 4. Bounded repair: fix once, rebuild, preserve previous good code

Approved policy: disabled by default; user explicitly requests one repair after
a deterministic candidate build failure. This can incur an additional model call and build.

- Project owns the repair attempt/state; Execution supplies allowlisted bounded compiler diagnostics;
  AI receives the original request, exact failed candidate and sanitized diagnostics as untrusted data.
- Do not send environment files, JWTs, arbitrary build logs or shell commands to the model. Redact/limit
  diagnostics; stop on transport/auth/unknown outcomes rather than trying to repair infrastructure.
- Allow one attempt with a saved request identity, output/time cap, no fallback and zero SDK retries.
  The repaired manifest goes through the same path/import validation and a fresh real build.
- Publish only after success, keeping old revisions immutable. Another failure stays failed; do not
  recurse. Repair is not a bypass of the gate or an unrestricted terminal tool.
- Tests must prove disabled means zero extra calls, duplicate clicks do not repeat a repair, unsafe
  diagnostics are withheld, a failed repair preserves the prior revision, and success requires new proof.

### Delivery sequence and interview summary

Deliver compatible service-scoped slices: AI stream -> Project relay -> frontend SSE; Project durable
history -> frontend restoration; evaluation reports; then the agreed repair policy. Separate branches
and verification keep source/output/transport/data bugs distinguishable. The user approved sequential
verified commit/push/PR/merge delivery; do not treat planned stages as already merged or tested.

Interview explanation: "SSE improves perceived latency, Mongo preserves owner-scoped conversation state,
evaluations measure correctness independently, and bounded repair uses compiler feedback without
creating an unlimited agent loop. Storage, model reasoning, execution and UI have separate owners."

## Authoritative continuation — live local AI workspace (2026-10-23)

The user clarified that advanced, useful AI skills must be demonstrated through **real model-driven local functionality**, not replaced by the fixture demo. The [AI portfolio delivery contract](AI_PORTFOLIO_DELIVERY_PLAN.md) is now the priority/acceptance source: a dated fresher-role sample, retrospective, skill-to-feature evidence map, core versus optional scope, and ordered service-specific phases A–F. Older six-phase/M0 sections below are historical proposals and evidence; their fixture-first completion target is not the final product requirement.

Start A1 (AI requirement assessment), then A2 owned saved/confirmed brief, A3 dialogue UI, and A4 explicitly budgeted provider-to-preview verification. Tests remain zero-provider-cost; the user's implementation request is not permission for a paid call, account change or public deployment. Critical dependency triage is also recorded as a separate service-branch priority. No stack rewrite, extra runtime service, vector database or generic agent framework is installed by this planning update.

## Current product boundary — local portfolio, free-first (2026-10-23)

The user clarified that this is a student major/CV project, not a service for public users. This section supersedes public-production deployment and paid-smoke requirements in older plans. Required outcome: a reliable localhost demo, understandable source/design, an honest screen recording, and a small static showcase linking the video, repository, architecture and limitations. Production architecture is a documented target, not a deployed or verified production claim.

- **Additional paid usage is not authorized.** Do not make paid model calls, purchase credits, create paid cloud resources, attach billing, or deploy temporarily without fresh explicit approval. Do not keep asking for a paid test budget as a completion requirement. Existing subscriptions/account caps are not permission to spend.
- Prefer zero-provider-cost deterministic fixtures for workflow verification. Any recorded/fixture-response demo must be explicitly labelled, with real Docker/build/persistence/browser behavior distinguished from simulated AI output. Never present a canned response as live model generation.
- A real-model integration remains optional and separately unverified until a genuinely free local/provider path is checked or an explicit paid exception is approved. Local models depend on available hardware; free quotas/hosting terms must be verified, not assumed. No provider or model migration is approved by this scope change.
- Keep local startup, replay/failure handling, resource bounds, code readability and design learning as priorities. Public ingress, HA clusters, paid monitoring and production multi-tenant isolation are architecture/design topics, not mandatory infrastructure to buy/build for the demo. Existing local secret/authorization/container restrictions still apply.
- The public-facing artifact, if later hosted on a confirmed zero-cost plan, is only a static showcase/video—not the execution control plane. Temporary cloud deployment is optional, not needed to claim an honest local demo. Source can still be pushed to GitHub independently of deployment.
- This records delivery/spending constraints; it does **not** implement an application-level billing block. The normal configured Gateway path can still charge if someone deliberately submits a real request. Keep fixture verification separate from real model mode.

## Portfolio V1 delivery plan — six phases (2026-10-23)

The user approved progressing this six-phase plan, with beginner-friendly code and a design explanation/Q&A for each slice. These are delivery groups, not a replacement for the historical milestone numbering below. Finish and verify one compatible service-scoped slice before starting its dependency. Do not call all six complete because a build passes.

| Phase | Small implementation slices | Completion evidence / boundary |
| --- | --- | --- |
| 1. Prove the complete local flow | Extend existing isolated browser composition to enable the real build gate; test session, pending candidate, publication, refresh, interactive preview, failed follow-up and owner separation. Then provide a clearly labelled repeatable local demonstration. | Real Auth/Project/Mongo/Execution/Docker/browser with deterministic AI; paid-provider smoke is NOT required for this local-demo scope. State that the real-model boundary is unverified, unless a separately verified free path is used. |
| 2. Quality and bounded repair | Add deterministic secret/unsupported-dependency diagnostics to candidate validation. Define a safe diagnostics contract; then at most one optional repair with recorded attempts. | Fixture cases must prove reject/preserve/revalidate and no repair loop. Agree supported imports, allowed diagnostics, repair token/spending caps and whether repair is opt-in before changing AI/security policy. Build evidence alone is not a security scan. |
| 3. Durable jobs | Design saved work states, worker ownership, retry/cancel and idempotent publication; add a durable job transport only after its contract is accepted. | Actual worker kill/restart, duplicate delivery, cancel and lost-ack tests. Do not store owner JWTs in jobs: durable worker authorization is a new security design requiring approval, not a reuse of today's memory-only token. Choose Mongo-backed jobs vs Redis/BullMQ from deployment/resource needs. |
| 4. Model and cost policy | Keep Gateway integration available but real paid requests out of routine tests/demo; centralize mode/token/retry controls and safe usage reporting. Evaluate a genuinely free model path only after checking hardware/terms. | Fixture provider-error/spending-control tests; real-model availability/quality is separately labelled. No automatic paid fallback/repair. Concrete limits still need agreement before enforcement; no stronger-model performance guarantee. |
| 5. Local-demo security + production design | Triage dependency advisories, patch compatible packages with regression evidence, test owner access/redaction and document the threat model. Describe stronger public isolation as future architecture. | No cross-owner access or secret leakage; record unresolved advisories. Local demo is not called production-ready. Public deployment/isolation infrastructure is outside current delivery. |
| 6. Local portfolio release | Reproducible local startup, CI checks, safe logs/health, design Q&A, a screen-recording script and a small static showcase with repository/video/architecture links. | Fresh-machine setup + fixture E2E + recorded honest walkthrough. Static-page hosting is optional and must be verified zero-cost before publishing. Full-system cloud deployment, even temporary, is not required or authorized. |

**Current execution:** Phase 1's zero-cost gated browser slice passed with real Auth/Project/Mongo/Execution/Docker and interactive iframe; only AI HTTP output was a transport fixture. Evidence: `output/playwright/verification-1792731826489.json` (`buildGate`, suite pass and both cleanup flags true). Deliberate startup failure exited the expected 1 with cleanup confirmed in `verification-1792732127613.json`. The remaining convenient demo workflow is now supplied by [`npm run demo:local`](LOCAL_DEMO.md), with a server-rendered fixture notice, manual lifetime and tracked-account cleanup. Its actual Edge build-gate flow and Enter shutdown were verified; [evidence and the Windows pipe correction](08_TESTING_STRATEGY.md#manual-local-demo--2026-10-23) distinguish the first cleanup-success/exit-hang from the corrected exit-0 run. Phase 1's scoped local fixture workflow is complete, not real-model evaluation or a fresh-machine release. Phases 2–6 remain incomplete; Phase 2 policy implementation is on hold at the user's request. Explain it before asking for approval again.

**Learning deliverable:** maintain [System Design Q&A](SYSTEM_DESIGN_QA.md) with actual source links: problem, chosen design, rejected alternative, failure behavior and test evidence. It is a practice guide, not a claim that the learner hand-wrote AI-assisted code. Explain one flow at a time in later Q&A sessions.

## Build-before-publication slice — 2026-10-23

Frontend pending support (PR #17) and Execution candidate checks (PR #18) are merged. The Project B2/3 slice adds opt-in captured build policy, owner-plus-service authenticated candidate reads, bounded in-process checking and proof-enforced immutable publication. Build failure keeps prior revisions; uncertainty retains saved output/key; GET status never starts work. Setup/limitations: [Project Service](../project-service/README.md). This supersedes older manifest-only publication descriptions only for newly gated attempts.

Evidence for this slice: Project **30/30 unit tests**, **40/40 existing Mongo integration tests**, **5/5 deterministic gate integration cases** (optional Docker case skipped in that run), and a separate explicit **6/6 gate run including real Project HTTP/Mongo/Execution HTTP/Docker publication** (real build case 105.7 seconds). Typecheck/build passed. Frontend **33/33**, lint/build and mocked-transport Edge pending/ready/failure/outage/refresh checks passed; Execution **44/44**, typecheck/build and real valid/invalid Docker candidate checks passed. Two dedicated test DBs were independently read after scoped cleanup: zero Project/Generation/Revision records. No labeled preview containers remained.

Only model transport and most build cases were fixtures; the explicit real-build case used a trusted existing `:css-check` image. No paid model, real Auth-login browser-to-gate flow, normal app data, normal Compose activation, new dependencies, queue or public deployment was used. Gate remains off by default. Snapshot/policy/image-bound static build evidence is not a secret/dependency/security scanner or a full M3 completion claim. Durable jobs, actual crash-kill tests, bounded AI repair and deployment/isolation work remain separate phases.

Self-audit follow-up: Execution now classifies an owned hash-matching unsupported snapshot as terminal `CANDIDATE_UNSUPPORTED`, before Docker admission. Project already maps that explicit rejection to failed verification. Identity/hash/transport mismatches remain uncertain, never a build pass. A focused regression confirms unsupported source starts no container; Execution suite is now **45/45**. This correction changes failure classification, not the source policy or isolation boundary.

## M1 verification follow-up — 2026-10-21

PR #6 is merged (`5651d5e`). The focused `test/frontend-m1-verification` branch adds acceptance mapping, a 95-second proxy deadline aligned with the existing 90-second backend/100-second browser limits, repeatable state/status checks and an isolated one-command launcher. Each real suite gets a fresh Next + fixture pair to avoid carrying proxy connections across upstream restarts. No queue, provider expansion, execution service or deployment was added.

The final combined launcher run passed all six browser suites: mocked links/history/access and real Auth/Project/Mongo loop/recovery/state with deterministic AI. This includes actual status-GET recovery without another generation, frozen request identity across responsive reflow, and delayed old-project read isolation. Scoped cleanup and an independent Mongo read reported zero records in the new dedicated test database; test ports were released. Frontend unit tests 10/10, lint and production build passed. Exact evidence and previous failed runs are retained in `08_TESTING_STRATEGY.md` and `M1_ACCEPTANCE_REVIEW.md`.

**Next decision:** review deterministic M1 acceptance against the recorded backend and browser evidence, then approve one bounded M2 design slice if desired. Do not infer crash durability from HTTP response-loss recovery. Paid-provider quality/cost, generated-code validation/execution and deployment remain unverified; the older roadmap sections below are historical proposals, not fresh completion claims.

## Recovery automation — 2026-10-13

PR #5 is merged (`7e1e730`). The next independent slice on `test/frontend-generation-recovery` adds `npm run test:browser-recovery`: seven real-service browser checkpoints verify terminal follow-up failure leaves v1/history unchanged; controlled loss of an actual committed v2 response retains request identity across refresh; explicit same-key/body retry recovers that exact revision without another AI call; and a final refresh loads v2 without pending controls. Real Auth/Project/Mongo are unchanged, with only deterministic AI transport and one deliberate browser-response drop controlled. No new dependency or production implementation is introduced. See the testing strategy for exact evidence/limits.

**Next small slice:** audit remaining M1 acceptance evidence and focus on publication/status uncertainty only where coverage is missing. Queueing, provider routing, execution and deployment remain later, separately approved milestones. M1 is not declared fully accepted by these seven checks; process-crash/database-partition and broader race/auth/storage verification remain separate gaps. This turn requests implementation, not commit/push/merge.

## Historical implementation progress — 2026-10-13

`npm run test:browser-real` now automates the real Next/Auth/Project/Mongo revision loop with only the AI HTTP transport replaced by deterministic test output. Five checkpoints passed: create/generate v1, hard refresh, follow-up v2, hard refresh and reopen immutable v1. Real API assertions also prove selected-base forwarding, parent linkage, unchanged-file preservation, explicit deletion, same-key replay with only two AI calls, and a second owner's empty list/404 reads. Scoped fixture cleanup and a separate read-only probe confirmed zero remaining records. See `08_TESTING_STRATEGY.md` and the frontend README for evidence and reproduction.

This test-only slice originally started from merged `main` (`f15936e`, PR #3) on `test/frontend-real-revision-loop`, independently of the access/legacy slice. PR #4 subsequently merged access/legacy checks into `main` (`93f5964`). PR #5's conflict resolution brings that merged baseline into the real-loop branch, preserving both test commands and documentation. No production API/schema, environment file or package dependency changed. Resolution commit/push are requested; merging PR #5 remains separate.

**Next small slice:** automate a real-service failed follow-up preserving the prior revision, then controlled lost-response/same-key recovery. M1 is not marked fully accepted: broader failure/race/crash coverage remains. No paid-provider quality, generated-code execution, queue or deployment work is authorized by this verification slice.

## Historical implementation progress — 2026-10-12

Slices 1–4 backend work and Slice 5 frontend integration are implemented. The UI restores owned snapshots from URL/backend after session restoration, lists saved history, submits against the visible parent, and retains one request key across uncertainty. Real Auth/Project/Mongo plus deterministic AI fixture browser checks proved create → v1 → hard refresh → v2 → hard refresh → reopen v1, failure preservation, responsive in-flight state, stale-response isolation and recovery. See `08_TESTING_STRATEGY.md` for exact checks. No paid-provider quality, real process-kill recovery or generated-code execution is claimed.

**Repeatable browser checks:** `npm run test:browser-links` covers malformed workspace URLs/empty-draft recovery. `npm run test:browser-history` covers project/history pagination and protected-401 login recovery; it caught and prompted a fix for stale-session redirect loops. `npm run test:browser-access` adds legacy provenance, genuine saved drafts and unavailable project/revision read/retry/recovery. These use mocked API transport, not real database/auth/provider verification or server ownership proof.

**Next small slice:** automate the real-service revision loop using isolated Auth/Project/Mongo and deterministic AI transport, including actual ownership and persistence assertions. Broader auth-expiry/disabled-storage/crash cases remain separate gaps. M1 is not marked fully complete. Backend PR #1, frontend PR #2 and browser/session-fix PR #3 are merged into `main`; the new access/legacy checks use fresh `test/frontend-workspace-access-legacy`. No commit/push/PR/merge is implied by ordinary implementation.

## Historical implementation progress — 2026-10-11

- Slice 1: owner-scoped project/revision read APIs are implemented and integration-tested; the frontend still does not restore selected projects.
- Slice 2: initial-generation request identity, exact same-key race handling, complete replay/version output, and legacy/stale-snapshot compatibility are implemented. Explicit initial prompts are recorded and used; follow-up attempts are gated until base-context and merge support exist.
- M1 is **not complete**. Next is the bounded base-context/upsert/deletion contract with pure merge/prompt tests; reliable publication and frontend restoration remain separate later slices.

The detailed `PROJECT_HISTORY_REVISION_PLAN.md` refines this original M0 proposal: its standalone-Mongo publication authority and historical-base policy supersede the older mutable-pointer/transaction/stale-base suggestions below. Slice 4 implements that backend strategy and removes counter-based version reservation; the preceding Slice 2 update is historical.

## Relationship to the existing roadmap

`docs/15_PHASE.md` remains the broad product-phase document. This file is the evidence-based engineering sequence produced by M0. It does not mark aspirational features as complete, and each milestone must update the older documents when the implemented contract changes.

## Delivery principles

1. Complete one user-visible vertical slice at a time.
2. Preserve current Auth, Project, AI Orchestrator, Execution, and Next.js boundaries unless measured requirements justify a new service.
3. Project Service owns projects and revision history; AI Orchestrator owns model calls and generated-output policy; Execution Service owns untrusted run lifecycle.
4. Do not execute generated code until the isolation boundary is designed, implemented, and tested.
5. Add a queue only when work must survive HTTP disconnects or needs controlled retries/concurrency.
6. Every milestone needs automated acceptance evidence, not only a successful build.

## Dependency-ordered milestones

| Milestone | Outcome | Depends on | Completion evidence |
|---|---|---|---|
| **M0 — Audit baseline** | Truthful current-state, risks, roadmap, and memory design. | None | These three M0 documents plus recorded checks. |
| **M1 — Persistent revision loop** | User can reopen a saved project, inspect revision 1, request a targeted change, persist revision 2, and reload it. | M0 | API/service tests and one frontend integration flow prove create → generate → reload → revise → reload. |
| **M2 — Reliable generation jobs** | Generation survives client disconnects and has explicit queued/running/succeeded/failed states. | M1 stable revision contracts | Queue integration tests, idempotency concurrency test, retry rules, and status polling/streaming evidence. |
| **M3 — Generation quality gate** | Each generated revision receives deterministic validation diagnostics before it is marked usable. | M1 | Fixture tests for manifest, dependency policy, secret scan, typecheck/build result, and failure classification. |
| **M4 — Secure execution MVP** | An authenticated owner can run an approved revision in an isolated, limited environment and view status/logs. | M1 + M3 | Threat-model update, isolation tests, time/resource limits, network policy, cleanup, cancel, and log redaction. |
| **M5 — Provider routing and cost controls** | Explicit economy/quality policies route across supported providers with budgets and measured fallback. | Reliable M2 job state | Provider-contract tests, recorded model/policy version, token/cost ledger, and controlled fallback tests. |
| **M6 — Engineering memory MVP** | Verified project knowledge can be stored, retrieved with provenance, and evaluated against a no-memory baseline. | Stable project/revision IDs from M1 | Retrieval fixtures, privacy tests, Recall@k/MRR report, and end-task quality comparison. |
| **M7 — Obsidian local connector** | Opt-in local vault notes can be safely indexed without exposing excluded paths or secrets. | M6 memory contract | Local scanner tests, allow/deny rules, incremental sync, deletion propagation, and provenance display. |
| **M8 — MCP integration** | Selected external tools/resources are exposed through a policy-controlled MCP boundary. | Stable auth, audit, memory, and tool policy | Tool allowlist, confirmation rules, auth isolation, audit trail, and adversarial tests. |

Only **M1** is recommended for approval now. Later milestones are sequencing guidance, not authorization to implement them.

## Recommended first milestone: M1 — Persistent revision loop

### User outcome

A signed-in user can generate a project, leave or refresh the page, reopen the same project and revision, submit a follow-up instruction such as “make the hero background darker,” receive revision 2 based on revision 1, and reopen either revision later.

### Why M1 comes first

The database already stores projects and revisions, but the product cannot read them back or create a related second revision. Completing this loop turns temporary demo output into a durable product foundation. Queueing, execution, memory, and evaluation all need stable project/revision identity and history.

### In scope

- Owner-scoped project list and project detail APIs.
- Owner-scoped revision list and revision detail APIs.
- A follow-up generation request containing a change prompt and a required base revision.
- Parent-linked immutable revisions and explicit latest-revision tracking.
- AI Orchestrator input containing the base files plus requested change.
- A response that records the complete resulting manifest and changed-file summary.
- Frontend saved-project selection, loading/empty/error states, revision selection, and follow-up prompt behavior.
- Stable error contracts for not found, forbidden-by-ownership hiding, revision conflict, validation failure, and downstream AI failure.
- Focused service, contract, and frontend tests.
- Matching OpenAPI and sequence-diagram updates.

### Out of scope

- BullMQ/Redis, background workers, streaming, or retries.
- Executing or previewing generated code.
- Multiple AI providers or automatic fallback.
- Embeddings, vector databases, engineering memory, Obsidian, or MCP.
- Kubernetes redesign beyond documenting any newly discovered constraint.

### Proposed API slice

```text
GET  /api/projects
GET  /api/projects/:projectId
GET  /api/projects/:projectId/revisions
GET  /api/projects/:projectId/revisions/:revisionId
POST /api/projects/:projectId/generations
     body: { prompt, baseRevisionId }
     header: Idempotency-Key
```

For the first generation, project creation remains separate and `baseRevisionId` is omitted only when the project has no revisions. For follow-up generation, `baseRevisionId` is required and must belong to the same owner and project. The server—not the browser—loads authoritative base files.

### Expected files to change

Exact names may be refined after the implementation plan, but changes should remain inside this slice:

- `project-service/src/models/project.model.ts`
- `project-service/src/models/revision.model.ts`
- `project-service/src/models/generation.model.ts`
- `project-service/src/repositories/project.repository.ts`
- `project-service/src/repositories/revision.repository.ts`
- `project-service/src/repositories/generation.repository.ts`
- `project-service/src/services/project.service.ts`
- `project-service/src/services/generation.service.ts`
- `project-service/src/controllers/project.controller.ts`
- `project-service/src/routes/project.routes.ts`
- `project-service/src/clients/ai-orchestrator.client.ts`
- New focused Project Service test files and test setup.
- `ai-orchestrator-service/src/features/generations/generation.schema.ts`
- `ai-orchestrator-service/src/features/generations/generation.service.ts`
- `ai-orchestrator-service/src/features/generations/generation.schema.test.ts`
- `nextjs-boilerplate/lib/project-api.ts`
- `nextjs-boilerplate/components/workspace/ChatPanel.tsx`
- `nextjs-boilerplate/components/workspace/WorkspaceShell.tsx`
- A small saved-project/revision UI component if separation improves readability.
- Focused frontend API/state tests.
- `docs/05_OPENAPI_SPEC.md` and `docs/12_SEQUENCE_DIAGRAMS.md`.

### Test plan

1. Repository/service tests prove owner-scoped list/read behavior and prevent cross-user access.
2. Revision tests prove immutable versions, parent linkage, latest pointer updates, and base-revision/project matching.
3. Idempotency tests include two concurrent requests with the same key and require one durable result.
4. Failure tests prove no revision is advertised as latest when AI or persistence fails.
5. AI contract tests prove base files and change prompts are bounded and unsafe outputs remain rejected.
6. Frontend tests cover loading, empty, error, initial generation, saved-project reload, revision selection, and follow-up revision state.
7. One integration flow proves create → revision 1 → reload → targeted revision 2 → reload revision 2.

### Main risks and controls

| Risk | Control in M1 |
|---|---|
| Concurrent revisions choose the same base/version | Use an atomic compare-and-update strategy or Mongo transaction; return a clear revision conflict rather than silently forking. |
| Prompt size grows with complete source files | Enforce file/count/byte limits, send only the authoritative base revision, and record truncation as an error rather than silently dropping context. |
| Cross-user project/revision access | Every repository read includes `ownerId`; externally return a consistent not-found response to avoid resource enumeration. |
| Partial multi-document writes | Use a transaction when the configured Mongo deployment supports it, with an explicit tested fallback or fail-fast requirement. |
| Generated code replaces files unexpectedly | Persist a changed-file summary and always retain the complete immutable revision for recovery/comparison. |

### Estimated scope

**Medium architectural slice:** approximately 15–22 source/test/document files, one database migration/backfill decision for existing revisions, and no new infrastructure service. The implementation should be split into small focused commits, but accepted only when the complete vertical flow passes.

### Acceptance criteria

- [ ] Existing users can list only their projects.
- [ ] A saved project and any owned revision can be reopened after browser refresh.
- [ ] Revision 1 remains unchanged after revision 2 is created.
- [ ] Revision 2 stores `parentRevisionId`, source change prompt, complete files, changed-file summary, model/policy metadata, and validation status.
- [ ] The server rejects a missing, foreign, or stale base revision with a stable error.
- [ ] Repeating the same idempotency key returns the same generation result, including under a concurrency test.
- [ ] Failed AI/persistence work does not move the project's latest-revision pointer.
- [ ] Loading, empty, and error states are visible and accessible in the UI.
- [ ] Project, AI contract, and frontend tests pass; all workspaces typecheck/build.
- [ ] OpenAPI and sequence documentation match the implemented contract.

## Approval gate

M0 stops here. No M1 application changes, queue setup, execution work, provider expansion, memory indexing, Obsidian connector, or MCP integration should begin until the M1 scope is reviewed and explicitly approved.
