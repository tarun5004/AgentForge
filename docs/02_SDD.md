# AgentForge V1 — Software Design Document

## 1. System shape

~~~text
Browser / Next.js web
          |
       Ingress
          |
  +-------+--------+---------+-------------+
  |       |        |         |             |
Auth   Project   AI Orchestrator      Execution
  |       |        |                 |
Auth DB Project DB  AI usage DB       Redis + isolated Jobs
~~~

The Next.js application is the frontend only. It never receives provider credentials. It calls the public APIs through HTTPS. Each service owns its data and validates the caller identity itself.

## 2. Services

### Auth service

Owns identity, password hashes, sessions, JWT signing keys, refresh token rotation, and a JWKS endpoint. It issues short-lived access tokens. Other services verify the token with the published public key; they do not share the signing private key.

### Project service

Owns projects, members, prompt records, immutable revisions, file manifests, and generation state. It is the authorization source for project-level actions.

### AI Orchestrator service

Owns provider adapters, model-policy configuration, prompt construction, structured-output validation, fallback policy, token/latency accounting, and redaction. It never persists a project directly; it returns a validated result to Project service.

### Execution service

Owns run requests and creates a short-lived, least-privilege Kubernetes Job from a trusted runner image. It streams sanitized logs and terminal state. It never accepts a user container image or arbitrary Kubernetes manifest.

## 3. Synchronous and asynchronous boundaries

- Authentication and project CRUD are synchronous REST calls.
- Initial generation is accepted by Project service, then dispatched to AI Orchestrator through a Redis-backed job queue.
- Execution is accepted by Execution service and dispatched to a run queue.
- Project service receives terminal generation events and persists the revision state.
- UI observes job state through polling in V1; WebSocket/SSE is a later optimization.

## 4. Generation pipeline

1. Validate prompt length, project ownership, template, and mode.
2. Select a supported template and produce a compact normalized specification.
3. Use deterministic routing policy to choose the first model.
4. Ask for schema-validated plan and file patch, with fixed output limits.
5. Validate paths, file count, file size, dependencies, and forbidden patterns.
6. Save a pending revision, then request a build validation run.
7. Mark the revision ready only after successful validation; otherwise preserve diagnostics.

## 5. Token policy

| Stage | Input | Output cap | Default strategy |
| --- | --- | --- | --- |
| Normalize request | prompt + selected template metadata | 500 tokens | economy model |
| Plan | normalized specification | 900 tokens | economy or quality model |
| Generate | relevant template files only | 6,000 tokens | selected coding model |
| Repair | failing diagnostic + affected files only | 2,000 tokens | same model, one retry |

The system must not send the whole repository or full chat history. Each revision has a hard token and request-count budget.

## 6. Reliability rules

- Idempotency key required for create-generation and create-run.
- Queue retries: one retry for transient provider/network errors only.
- Provider failures follow configured fallback order; validation failure does not silently switch to a weaker output.
- Execution timeout defaults to 90 seconds and cleanup is mandatory.
- Service health and readiness endpoints have no protected data.
