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

## ADR-009: Reserve versioned requirement attempts; confirm separately

**Decision (2026-10-23, A2):** Project owns bounded cumulative answers and assessments in a new versioned Brief collection. Unique project/version and project/key indexes arbitrate admission before AI. Fingerprints bind input; conditional completion/abandonment avoids late resurrection. Model-ready and human confirmation are separate transitions. An additive initial-generation route loads approved text and delegates existing publication/build logic; the legacy API remains compatible.

**Why:** Browser state/stateless model calls cannot restore consent or protect retries. One atomic reservation fits standalone MongoDB without a new queue, service, mutable latest pointer or a multi-document transaction around AI. Existing SDK and database tools suffice; no new dependency.

**Consequence:** Pending ambiguity requires read/replay or explicit abandonment, not an automatic paid retry. A new deliberate key can spend again; cancellation/refunds are not promised. Current consent is checked at admission, not a cross-document transaction that cancels future edits. Historical generation replay remains possible; follow-ups stay on the selected-base legacy API. Frontend conversation and live-model quality remain separate A3/A4 work.

## ADR-010: One evidence-driven conversation, without another agent platform

**Decision (2026-10-25):** Present user messages, requirements, observed service activity, immutable results and Preview actions in one chat. Keep a small account/project-scoped browser journal for display history. Backend Project/Brief/Revision records remain authoritative for ownership, context, confirmation, files and publication. Reconstruct missing revision summaries, not missing tool events. Continue bounded GET polling rather than adding SSE, queues or an event store for this local showcase.

**Why:** Replacing one notice loses the working story; adding fake progress would misrepresent execution. A bounded display journal and existing status/build evidence make the workflow understandable without changing its generation logic or introducing another service/dependency. The proposed cross-service tool-provenance addition was removed during audit: it was unnecessary scope for a sidebar presentation change. No live skill/tool event is shown without an API source.

**Consequence:** Local chat is not cross-device synchronization, model memory, hidden reasoning, per-token streaming or a Codex-equivalent agent. Storage failures/trimming/interruption are visible; refresh never automatically starts AI. Requirements use saved cumulative answers and edits use the selected snapshot, not an ever-growing browser transcript. Only actual build proof earns a build-pass label. Restricted Markdown and the existing isolated Preview sandbox remain in place. No new model call is added by the UI.
