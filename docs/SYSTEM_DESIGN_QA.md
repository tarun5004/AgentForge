# AgentForge — system-design practice

Use these as short explanations, then open the linked code and trace one request yourself. AI-assisted implementation is fine; ownership means understanding and validating the decisions, not claiming every line was written manually. Proposed future phases are not implemented capabilities.

## 1. How does a prompt become a saved project?

**Problem:** a model response alone disappears on refresh and is not proof of a usable project.

**Design:** the workspace creates an owned Project, sends a generation request with a stable key, and Project Service saves validated output as a candidate. With the optional gate enabled, Execution builds it before Project inserts an immutable Revision. The browser reads that revision back.

**Trade-off:** synchronous AI still has a deadline; build work is process-local, not a durable queue. Gate-off/legacy revisions must not be called build-verified.

Trace: [workspace submission](../nextjs-boilerplate/components/workspace/useWorkspace.ts) → [Project orchestration](../project-service/src/services/generation.service.ts) → [build gate](../project-service/src/services/generation.build-gate.ts) → [publication](../project-service/src/services/generation.publication.ts).

## 2. How is Docker preview shown in the browser?

**Problem:** generated code must not run inside the platform's own API/frontend process with its secrets.

**Design:** browser sends saved project/revision IDs, not shell commands. Execution asks Project for the owned snapshot, validates allowed source, and uses a trusted fixed Next.js template in a restricted Docker container. The runner performs a static export, validates bounded artifact bytes and removes the build container. A separate local preview server serves those bytes; the workspace embeds its capability URL in a sandboxed iframe.

**Trade-off:** this is a static frontend demo, not an arbitrary backend/server runtime. The build container does **not** stay alive as the preview web server. Local Docker is not approved public multi-user isolation.

Trace: [Preview launcher](../nextjs-boilerplate/components/workspace/PreviewLauncher.tsx) → [run routes](../execution-service/src/features/runs/run.routes.ts) → [Docker runner](../execution-service/src/features/runs/docker.runner.ts) → [artifact policy](../execution-service/src/features/runs/run.artifacts.ts) → [preview server](../execution-service/src/features/runs/preview.server.ts).

## 3. Why are a build check and Preview separate?

**Problem:** publishing bad code then discovering the build error in Preview is too late for a quality gate.

**Design:** candidate checking runs before publication and returns evidence, not a public preview URL. Preview accepts only an already-saved revision. Both use the same runner and one local build slot.

**Trade-off:** candidate artifacts are discarded, so first Preview may build the saved revision again. This is simpler than persisting/reusing unpublished artifacts safely; it costs local build time. Artifact reuse is not implemented.

Trace: [candidate checks](../execution-service/src/features/runs/candidate.check.ts), [publisher proof guard](../project-service/src/services/generation.publication.ts).

## 4. Why both user JWT and service token?

**Problem:** a trusted service identity does not prove which user owns a project; a user's JWT alone should not grant an internal candidate API.

**Design:** JWT proves the owner through Project's existing verification. A separate internal token proves service access. The JWT is forwarded only in active invocation memory, never stored in Mongo/jobs or browser pending intent.

**Trade-off:** after restart, a fresh authenticated same-key POST is needed to resume a saved candidate. Automatic durable workers need a separately designed authorization scheme.

Trace: [candidate route](../project-service/src/routes/candidate.routes.ts), [Execution transport](../execution-service/src/features/runs/candidate.check.ts).

## 5. How do retries avoid another model bill?

**Problem:** a lost HTTP response does not mean the server failed. Blindly retrying with a new key could create another model call.

**Design:** bind a stable key to normalized prompt/base identity. Save output before checking/publication. Replay returns the committed revision or resumes saved output/proof. GET status only observes; it never calls the model or resumes work.

**Trade-off:** a crash before output is saved can still leave pending uncertainty. Idempotency is not the same as guaranteed exactly-once external provider execution across every crash.

Trace: [request identity](../project-service/src/services/generation-request.ts), [generation replay](../project-service/src/services/generation.service.ts), [GET polling](../nextjs-boilerplate/lib/generation-poll.ts).

## 6. What proves a build result belongs to this code?

**Problem:** a bare `passed: true` might refer to another snapshot or an old runner.

**Design:** hash complete file contents in a deterministic path order. Store the hash, policy, pinned image ID, check ID and timestamp. Publisher independently matches the proof to the final snapshot before insertion.

**Trade-off:** static build success does not prove UX quality, safe dependencies or absence of malicious browser behavior. Those need their own policies/tests.

Trace: [proof/hash contract](../project-service/src/clients/build-verification.ts), [Execution evidence](../execution-service/src/features/runs/candidate.check.ts).

## 7. What if two edits finish together?

**Design:** each attempt captures the next version from the current head. Unique project/version and generation indexes arbitrate the immutable insert. One publishes; a competing attempt conflicts instead of silently becoming the next edit. The selected historical parent and the latest version are different concepts.

**Trade-off:** competing requests may both consume model/build resources. Admission/durable scheduling is a later improvement, not something uniqueness alone solves.

Trace: [publication](../project-service/src/services/generation.publication.ts), [revision indexes](../project-service/src/models/revision.model.ts).

## 8. Why did prompt submission previously look like logout?

**Debugging method:** inspect the failed request/status in Network first, then its proxy/service logs. A definite protected 401 triggers bounded session refresh. A 502/503, build failure or timeout is an operation/infrastructure problem, not proof that login expired.

**Current design:** session requests refresh once and retry the same body/key; uncertainty preserves the existing project/files and pending identity. Do not say “fixed by clearing all errors” or claim a root cause from a screenshot alone.

Trace: [session request helper](../nextjs-boilerplate/lib/session-request.ts), [session regression tests](../nextjs-boilerplate/lib/session-request.test.ts).

## 9. How do we know this works without spending tokens?

**Design:** separate boundaries. Unit fixtures test rules. Real Mongo/HTTP tests prove persistence and ownership. Explicit Docker tests prove compile/export/cleanup. Browser tests prove actual rendering and interaction. Replacing only the AI network response avoids provider costs while exercising real downstream services.

**Trade-off:** fixture output cannot measure real model quality, provider authentication or actual token cost. A separately approved bounded provider smoke is still needed.

Trace: [testing evidence](08_TESTING_STRATEGY.md), [gate integration](../project-service/src/routes/build-gate.integration.test.ts), [browser composition](../tests/frontend-history.fixture.mts).

## 10. What remains before calling it complete?

Follow the [six-phase plan](AI_ENGINEERING_ROADMAP.md#portfolio-v1-delivery-plan--six-phases-2026-10-23). Durable jobs, scanners, bounded repair, cost enforcement, security release and deployment are separate acceptance criteria, not implicit benefits of having four services.

Practice answer: “I used AI for implementation help. I can explain the service boundaries, the immutable commit point, the container/iframe boundary and failure recovery, and show the tests that support each claim. I also know which parts are still demo-only.”
