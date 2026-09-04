# AgentForge V1 — Official Delivery Roadmap

This is the official roadmap. Do not create duplicate root-level phase files.

## P0 — Repository foundation

- Rename repository/product references to AgentForge.
- Establish workspace layout, shared contracts, lint, typecheck, tests, and CI.
- Create local Docker Compose and a safe local Kubernetes development path.
- Exit: clean install, build, lint, and test commands documented and passing.

## P1 — Auth service hardening

- Remove duplicate routes and unsafe error exposure.
- Add validation, structured logging, rate limits, refresh-session persistence, and asymmetric JWT/JWKS flow.
- Exit: auth contract and security tests pass.

## P2 — Project service

- Replace raw GET Pod creation with project CRUD, ownership, revisions, and idempotent generation requests.
- Add Project database and contract tests.
- Exit: user can create, list, read, update, archive, and delete only their projects.

## P3 — AI Orchestrator

- Add provider adapters, server-side policy, schema-validated output, token budgets, usage records, and failure policy.
- Implement Auto, Economy, and Quality product modes.
- Exit: deterministic fixture and low-budget real-provider generation produce a validated file manifest.

## P4 — Next.js web application

- Replace starter screen with auth, dashboard, project workspace, prompt panel, file tree/editor, revision list, diagnostics, and run state.
- Implement accessible loading, empty, and error states.
- Exit: complete project-to-generation flow is usable in browser.

## P5 — Execution service

- Create queue-backed restricted Kubernetes Jobs, log handling, timeout, cancellation, quotas, and cleanup.
- Add NetworkPolicy, scoped RBAC, resource quota, and container-policy tests.
- Exit: approved revision can run; unsafe manifests are rejected; every completed Job is cleaned up.

## P6 — Demo release

- Deploy web and APIs, configure secret store/budgets, run staging E2E, publish architecture diagram and portfolio README.
- Exit: public demo succeeds end-to-end with documented cost controls and rollback.
