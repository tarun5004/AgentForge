# M1 acceptance review

Reviewed: 2026-10-18. Baseline: merged PR #6, `5651d5e`.

M1 means saved, owned frontend revisions can be generated, reopened and changed reliably. It does not mean generated code executes, a real provider has been evaluated, or generation survives a server crash. The authoritative requirements are the fifteen cases in `PROJECT_HISTORY_REVISION_PLAN.md`, section 7.

## Evidence inventory

Fresh checks in this delivery: frontend unit 9/9, fixture cleanup 4/4, Project unit/contract 25/25, real HTTP/Mongo integration 40/40, AI prompt/schema/HTTP-boundary 14/14; frontend lint/build, Project/Auth builds and AI typecheck/build passed. Integration used only the explicit empty `agentforge_test_m1_20261018` database; its scoped cleanup is checked separately. Provider output is a deterministic fixture, not a paid model.

Browser runs recorded on October 12–13 prove the core persisted loop, legacy/draft/error handling and controlled response-loss recovery. They are historical until explicitly rerun below. A passing helper test is not a browser test; a passing fixture flow is not live-provider evidence.

| Case | Evidence and present assessment |
| --- | --- |
| 1. Owned draft, one initial snapshot | HTTP/Mongo create and initial-generation tests; persisted browser loop recorded. Covered with deterministic AI. |
| 2. Session and revision refresh | Real Auth/browser loop and recovery suite recorded; uses actual refresh cookies and backend reads. |
| 3. Bounded, ordered history | Fresh HTTP/Mongo pagination tests and historical mocked-transport pagination UI checks. |
| 4. Parent, prompt, full files, truthful metadata | Fresh follow-up integration tests and file adapters; fixture provenance remains explicitly labelled. |
| 5. Selected base reaches AI | Fresh internal-client/prompt tests, integration request capture and recorded real-service browser assertions. |
| 6. Preserve unchanged files, explicit deletion, immutable parent | Fresh merge/deletion integration/unit tests and recorded browser checks. |
| 7. Owner isolation and unauthorized responses | Fresh HTTP/Mongo 401/404 tests including foreign revision/generation scope; second-owner browser-runner HTTP assertions recorded. |
| 8. Same-key replay and changed-input rejection | Fresh canonical-fingerprint and HTTP/Mongo tests; browser replay recorded. |
| 9. Same-key races converge | Fresh concurrent HTTP/Mongo tests: one logical attempt, one AI call, one committed revision. |
| 10. Different-key head conflict | Fresh competing-publication integration test; loser is not silently reassigned the next version. |
| 11. Failure before publication preserves head | Fresh failed-follow-up integration test and recorded recovery browser checks. |
| 12. Commit overrides stale bookkeeping | Fresh status/read/replay, lost-acknowledgement and saved-result publication tests. Failures are injected at repository boundaries, not real database partitions. Browser Check-status UI still needs a repeatable check. |
| 13. Resize/in-flight identity and stale selection | Historical manual browser evidence plus inspected shell-owned state/abort guards. Repeatable controlled-barrier automation is the remaining priority. |
| 14. Readable legacy revisions with unknown provenance | Fresh legacy API/adapter tests and recorded access-suite browser checks. |
| 15. Run relevant verification, state limitations | Fresh checks above passed. Combined repeatable browser rerun and its cleanup remain to be recorded; no live provider smoke claimed. |

## Smallest follow-up

1. Automate cases 12–13 at the browser boundary using real Auth/Project/Mongo with explicit test-only barriers/fault injection. Do not add fake modes to production services.
2. Provide one local verification launcher that owns its child processes, waits for readiness, refuses occupied ports/nonempty databases and always attempts scoped cleanup.
3. Run all existing browser suites plus the new state suite and record exact outcomes below. Do not mark every milestone complete merely because individual checks pass.

## Still outside the claim

Real provider availability/quality/cost; generated-project typecheck/build/execution; real crash recovery and database/network partitions; deployment; broad auth-expiry/disabled-storage/accessibility matrices. Queueing and secure execution require their own implementation/design decisions. A code-generation demo is not an autonomous tool-running agent.
