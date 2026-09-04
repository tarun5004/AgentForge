# AgentForge V1 — Sequence Diagrams

## 1. Generate a revision

~~~mermaid
sequenceDiagram
  participant W as Next.js Web
  participant P as Project Service
  participant Q as Redis Queue
  participant A as AI Orchestrator
  participant M as Model Provider
  W->>P: POST generation with prompt and idempotency key
  P->>P: Verify JWT and project ownership
  P->>Q: Enqueue generation
  P-->>W: 202 generationId
  Q->>A: Deliver job
  A->>A: Normalize, budget, select provider
  A->>M: Structured generation request
  M-->>A: File manifest
  A->>A: Validate manifest and account usage
  A-->>P: Generation result event
  P->>P: Store immutable pending revision
  W->>P: GET generation status
  P-->>W: Ready or failed diagnostics
~~~

## 2. Run a revision

~~~mermaid
sequenceDiagram
  participant W as Next.js Web
  participant P as Project Service
  participant E as Execution Service
  participant K as Kubernetes
  W->>P: Request run for revision
  P->>P: Verify ownership and revision readiness
  P->>E: Internal create-run command
  E->>E: Validate manifest and enforce quota
  E->>K: Create restricted Job
  K-->>E: Status and sanitized logs
  E-->>P: Run state event
  W->>P: Poll run state
  P-->>W: Log preview and terminal state
  E->>K: Job TTL cleanup
~~~

## 3. Refresh session

~~~mermaid
sequenceDiagram
  participant W as Browser
  participant A as Auth Service
  participant D as Auth DB
  W->>A: POST refresh with HTTP-only cookie
  A->>A: Verify refresh JWT
  A->>D: Compare stored token hash
  D-->>A: Valid active session
  A->>D: Replace refresh token hash
  A-->>W: New access token and rotated cookie
~~~
