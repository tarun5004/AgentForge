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
