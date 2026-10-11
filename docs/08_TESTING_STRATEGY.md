# AgentForge V1 — Testing Strategy

## Slice 2 verification (2026-10-11)

The existing commands below now run **11 unit tests** and **25 HTTP/Mongo/service integration tests**. The latest typecheck/build passed. The final integration suite passed three consecutive runs after adding a deterministic stale-snapshot regression. The new request-helper suite initially failed because the module did not exist; six focused integration cases initially failed for missing identity/replay behavior. Oversized-body and stale-pending-snapshot regressions were also observed failing before their fixes. Typecheck caught test-only undefined-array access and widened status-literal issues; both were corrected before commit.

Added coverage: canonical prompt/base fingerprints, strict body/key validation, exact duplicate-index classification against a real Mongo error, complete initial/replay response equality, changed-input mismatch, eight simultaneous same-key requests producing one Generation/Revision/fixture AI call, legacy empty-body replay, saved revisions overriding stale ready/pending/failed bookkeeping, metadata reread after an older pending snapshot, missing metadata/revision uncertainty, failed-attempt handling, safe follow-up gating, foreign-project/base hiding, and correct 413 oversized-JSON behavior.

A fresh, positively identified local `agentforge_test_slice2_*` database was used; normal application data was not used. Test indexes remain, and only known fixture records are cleaned. Provider transport is still a localhost test fixture: no paid provider, real generation quality, browser/frontend loop, different-key publication race, or crash/saved-result publication recovery is verified by this slice. Those require the later approved work. No new dependency was installed.

## Implemented Slice 1 checks (2026-10-10)

The remaining sections describe future V1 coverage. Slice 1 uses existing Node test/tsx tooling; no new package or production test-provider mode was added.

From the repository root:

```powershell
npm run test --workspace=project-service

# Set this explicitly to your separate local agentforge_test_* database.
# Never copy MONGODB_URI from the application's .env for testing.
$env:AGENTFORGE_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/agentforge_test_slice1_local'
npm run test:integration --workspace=project-service

npm run typecheck --workspace=project-service
npm run build --workspace=project-service
```

Integration tests fail closed if `AGENTFORGE_TEST_MONGODB_URI` is missing. The test URI must use a localhost/127.0.0.1 `mongodb://` endpoint, an explicit `agentforge_test_*` database, and no credentials or URI options. Verify the database is dedicated to these fixtures before running. The tests do not fall back to application dotenv settings. Test secrets/configuration are assigned before importing the app. Use one run per dedicated database; fixtures use deterministic IDs and are not intended for overlapping runs sharing a database.

Tests run the real Express Project API against real MongoDB. A localhost HTTP fixture replaces only the AI Orchestrator network boundary for the unchanged initial-generation regression check; it is not model-quality or real-provider evidence. Cleanup targets only known fixture project IDs and their revisions/generations, never `dropDatabase` or a normal application database. Collections/indexes remain in the isolated test database.

| Actual check | Result |
| --- | --- |
| Baseline Project typecheck | Passed before edits. |
| Initial project integration RED | 7 failures: GET routes were absent (404 instead of expected protected/read responses). |
| Initial validation RED | Missing validation module, as expected. |
| Response-bound RED | Oversized project metadata returned 200 instead of 413 before the guard existed. |
| Revision integration RED | 6 failures: revision GET routes were absent. |
| Revision validation RED | Missing `validateRevisionQuery` export, as expected. |
| `npm run test --workspace=project-service` | Passed, 5/5 unit tests. |
| `npm run test:integration --workspace=project-service` | Passed, 15/15 HTTP/Mongo integration tests. |
| Project typecheck and build | Passed, exit 0. |
| Diff/staged-diff whitespace and scope checks | Passed before each implementation commit. |
| Final isolated DB record-count probe | Zero Project, Revision, and Generation records remained. |

The unit tests cover strict IDs, canonical cursors/defaults/limits, rejection of unknown/non-scalar query input, positive safe-integer history boundaries, and UTF-8/JSON-escape byte limits. HTTP tests cover all four routes' missing/invalid/expired authentication, owner-only data, same-timestamp project pagination, one batched latest query rather than N+1, latest derived from saved revisions despite stale status/counters, missing/foreign 404s, empty pages, newest-first history and exclusive boundaries, exact saved files, unknown/recorded provenance, GET immutability, private-field/file-summary exclusion, and oversized legacy responses. Existing project creation and initial generation remain readable; replay preserves the saved revision identity and makes no second fixture AI call.

No frontend, browser, paid-provider, load benchmark, dependency-security audit, transaction, follow-up, or generation-publication race suite was run for this slice. Existing generation replay formatting/publication behavior is not redesigned or fully validated here. An existing Mongoose `new`-option deprecation warning appeared on the generation path and remains outside the read-API change.

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
