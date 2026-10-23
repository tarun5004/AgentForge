# AgentForge V1 — Architecture Decision Record

## ADR-001: Use four bounded services

**Decision:** Auth, Project, AI Orchestrator, and Execution are separate services.

**Why:** Their scaling, data ownership, external dependencies, and threat profiles differ. This gives a meaningful microservices learning boundary without inventing unnecessary services.

**Consequence:** Shared contracts and observability are mandatory; a service may not query another service's database.

## ADR-002: Generate constrained Next.js frontend projects only

**Decision:** V1 supports approved templates, components, dependencies, and file paths.

**Why:** Narrow scope makes smaller models more reliable and keeps execution defensible.

**Consequence:** Backend, secret-bearing integrations, and arbitrary language requests are rejected or converted into mocks.

## ADR-003: Use an AI gateway plus provider adapters

**Decision:** Providers are selected through a server-side policy with supported adapters.

**Why:** It enables failover, token accounting, and a clean comparison between providers without exposing keys.

**Consequence:** Model identifiers remain server configuration; user-facing modes are Auto, Economy, and Quality.

## ADR-004: Kubernetes Jobs, not raw Pods

**Decision:** Execution creates an isolated Job from a trusted runner image.

**Why:** Jobs provide terminal lifecycle, deadline, and cleanup controls missing from the current raw-pod proof of concept.

**Consequence:** Execution is asynchronous and requires queue/status handling.

## ADR-005: Keep V1 frontend in Next.js

**Decision:** The product UI uses Next.js App Router.

**Why:** It provides a professional frontend structure while preserving clear client/server boundaries.

**Consequence:** Browser code cannot access service secrets; editor and preview remain Client Components only where required.

## ADR-006: Publish a revision through one immutable insert

**Implemented:** 2026-10-12, Project Service Slice 4. Earlier ADRs retain their V1 target scope; this record describes current backend behavior.

**Decision:** Store complete immutable snapshots with explicit parent/prompt/change/provenance metadata. Capture the actual head's next version before AI, save validated output, then insert one Revision under existing unique generation/version indexes. A selected historical parent is allowed; concurrent head changes conflict instead of silently rebasing. The Revision is authority; Generation/Project statuses and counters are repairable hints.

**Why:** Standalone MongoDB does not offer multi-document transactions. One atomic insertion gives a recoverable commit point without holding a lock around the provider call. Saved-output replay avoids a second paid call when publication is retried. Full snapshots keep revision reads independent of parent-chain reconstruction.

**Consequence:** Competing keys can both spend model tokens but only one publishes at a captured version. Ambiguous acknowledgements require read/replay; there is no promise of background completion after a crash before output saving. Existing unique indexes remain unchanged and legacy provenance stays unknown. Manifest validation is not build/execution verification. Frontend restoration remains separate work.

## ADR-007: Opt-in candidate build gate before the immutable commit

**Decision (2026-10-23):** Capture build policy per new Generation, save AI output first, return 202 while a bounded in-process worker asks the existing trusted-host Execution controller to build that exact candidate. Require a separate service credential plus owner JWT; never persist the JWT. Bind successful proof to a canonical snapshot hash, fixed policy and pinned runner image, then enforce it again inside the publisher. Keep the Revision insertion as the only commit point.

**Why:** The 120-second build does not fit the existing browser/proxy request deadline. Checking a saved Revision would be too late; raw browser-provided files would create a broader execution API. A stored candidate provides an owned, bounded source and supports retry without a repeated paid model call. Shared Docker admission avoids parallel preview/check resource consumption.

**Consequence:** Infrastructure uncertainty remains pending, deterministic compile failure publishes nothing, and old successful revisions stay intact. A fresh authenticated same-key POST may resume checking/publication after restart, but there is no durable queue or automatic crash recovery. Gate-off/legacy records remain unverified; disabling configuration cannot bypass the policy of an already-gated candidate. Both controllers remain host-local, and existing dependency/public-isolation limitations are unchanged. No schema backfill, index migration, provider call or automatic repair is implied.

## ADR-008: Clarify requirements before generating, without replacing the stack

**Decision (2026-10-23):** Add a strict, bounded internal AI requirement-assessment API using the existing SDK/Gateway/authentication. It returns questions or a reviewable brief, not code. Introduce it additively before Project-owned persistence/confirmation and frontend dialogue in compatible service slices. The [portfolio delivery contract](AI_PORTFOLIO_DELIVERY_PLAN.md) supersedes fixture-first release criteria and overlapping future milestone orders.

**Why:** A vague portfolio request should not immediately invent personal details or consume a full generation. Structured decisions make the UI's next action explicit without an autonomous multi-agent loop or another provider framework. Existing four-service boundaries, revisions and execution checks remain useful.

**Consequence:** `ready` is not user consent to generate. Project Service must later load owned answers, enforce confirmation and protect repeated submissions; this stateless internal endpoint alone does not do so. New calls cap output/time and disable SDK retries; this is not a dollar budget or Gateway-attempt guarantee. Fixtures prove contracts only. Model behavior, hallucination rate and live integration require separate measured verification with explicit spending approval. No paid call, security-policy expansion, schema migration or framework/package upgrade is included.
