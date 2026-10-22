# M1 acceptance review

Baseline review: 2026-10-18. Verification follow-up: 2026-10-21. Baseline: merged PR #6, `5651d5e`.

M1 means saved, owned frontend revisions can be generated, reopened and changed reliably. It does not mean generated code executes, a real provider has been evaluated, or generation survives a server crash. The authoritative requirements are the fifteen cases in `PROJECT_HISTORY_REVISION_PLAN.md`, section 7.

## Latest verification — 2026-10-21

The one-command launcher completed all six suites and exited 0. Ignored report `output/playwright/verification-1792605471891.json` records `cleanup: true` and no failure marker. This supersedes the earlier failed combined run; it does not erase that failure.

| Boundary | Executed evidence |
| --- | --- |
| Mocked UI transport | Links 3/3, history 3/3, access/legacy 4/4 scenarios passed. These are not database/auth evidence. |
| Real Auth/Project/Mongo | Revision loop 5/5, recovery 7/7 and state 9/9 checkpoints passed; only AI output and explicit fault/barrier boundaries are controlled. |
| Case 12 browser status recovery | Actual committed result recovered by generation-status GET after controlled 503; no extra generation POST/model call. |
| Case 13 browser state safety | Pending identity survives desktop/mobile/desktop reflow. Releasing a held old-project read cannot overwrite the newly selected project. |
| Local helpers and build | Frontend unit 10/10, verification guards 3/3, native command-wrapper regressions 12/12 and fixture cleanup 4/4 passed; frontend lint and production build passed. |
| Cleanup | Every real suite reported zero records; a separate post-run read confirmed users/projects/generations/revisions all zero in `agentforge_test_verify_next_20261021`. Dedicated ports 3102/4310/4311/4312 had no listeners after launcher exit. |

Each real suite now starts a fresh Next + fixture pair rather than retaining proxy connection pools across upstream restarts. No package, application API or database schema changed in this lifecycle follow-up. The initial preflight correctly refused an older test database containing one user; that data was preserved, not deleted to obtain a green run. Screenshots of recovered v2, mobile pending state and project-B selection were inspected.

Cases 12–13 now have repeatable browser evidence, and the combined-browser gap in case 15 is closed. The backend tests in the baseline inventory below are previously recorded evidence, not new runs in this follow-up. This supports review of deterministic M1 acceptance; it is not production certification or authorization to start M2.

## Baseline evidence inventory — 2026-10-18

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

## Original follow-up list — now implemented and browser-verified

1. Automate cases 12–13 at the browser boundary using real Auth/Project/Mongo with explicit test-only barriers/fault injection. Do not add fake modes to production services.
2. Provide one local verification launcher that owns its child processes, waits for readiness, refuses occupied ports/nonempty databases and always attempts scoped cleanup.
3. Run all existing browser suites plus the new state suite and record exact outcomes below. Do not mark every milestone complete merely because individual checks pass.

## Still outside the claim

Real provider availability/quality/cost; generated-project typecheck/build/execution; real crash recovery and database/network partitions; deployment; broad auth-expiry/disabled-storage/accessibility matrices. Queueing and secure execution require their own implementation/design decisions. A code-generation demo is not an autonomous tool-running agent.
