# AgentForge AI Engineering Roadmap

**Baseline:** M0 audit completed on 2026-10-10

**Purpose:** Convert the current synchronous generation demo into a reliable, explainable code-generation platform through small, verifiable milestones.

## Implementation progress — 2026-10-12

Slices 1–4 backend work and Slice 5 frontend integration are implemented. The UI restores owned snapshots from URL/backend after session restoration, lists saved history, submits against the visible parent, and retains one request key across uncertainty. Real Auth/Project/Mongo plus deterministic AI fixture browser checks proved create → v1 → hard refresh → v2 → hard refresh → reopen v1, failure preservation, responsive in-flight state, stale-response isolation and recovery. See `08_TESTING_STRATEGY.md` for exact checks. No paid-provider quality, real process-kill recovery or generated-code execution is claimed.

**Repeatable browser checks:** `npm run test:browser-links` now covers malformed workspace URLs and empty-draft recovery using mocked API transport. It does not replace the real-service checks above or prove database/auth/provider behavior.

**Next small slice:** extend browser coverage to pagination, cross-owner/auth-expiry and legacy/deleted-link scenarios. M1 is not marked fully complete: the core flow is browser-proven, but all mandatory acceptance cases are not yet automated. Backend PR #1 and frontend PR #2 are merged into `main`; this small browser-tooling slice uses `test/frontend-workspace-link-smoke` from updated `main`. Commit/push/PR/merge remain separate explicit requests.

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
