# AgentForge V1 — Testing Strategy

## 1. Test pyramid

| Layer | Focus | Examples |
| --- | --- | --- |
| Unit | pure logic | token budget, router policy, file-path validation |
| Service | business rules | ownership, revision state transitions, refresh rotation |
| Contract | API compatibility | OpenAPI request/response validation |
| Integration | real dependencies | Mongo repositories, Redis queue, provider adapter fakes |
| E2E | critical user flow | sign in -> generate -> validate -> run -> view logs |
| Security | abuse resistance | IDOR, malicious file manifest, runner policy rejection |

## 2. Required coverage

- Auth: registration, duplicate email, bad password, refresh rotation, revoked session.
- Project: ownership, pagination, revision immutability, idempotency.
- AI: model policy, fallback only on eligible failures, token cap, output schema validation.
- Execution: trusted runner only, timeout, cancellation, cleanup, log redaction.
- Web: loading/error/empty states, accessible labels, no browser-visible secret.

## 3. Test data rules

- No production credentials or personal data.
- Provider adapters default to deterministic fixtures in CI.
- One separately marked smoke test may call a real provider with a dedicated low-budget test key.
- Seed data is repeatable and cleared by test database isolation, not production collection deletion.

## 4. Quality gates

Pull requests must pass formatting, lint, typecheck, unit tests, contract tests, vulnerability scan, and container/Kubernetes manifest policy scan. Staging E2E runs before manual demo release.
