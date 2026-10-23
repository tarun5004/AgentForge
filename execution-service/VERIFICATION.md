# Local preview verification

## Safe build diagnostics (B1) — 2026-10-23

Independent branch: `feature/execution-service-safe-build-diagnostics`, created from merged CSS fix PR #15 (`1de6c1f`). Scope is Execution only. No dependency, new endpoint, authentication, isolation, provider, real environment, Project schema/publication, or frontend component change.

**Implemented:** Docker process failures carry a trusted reason enum; the runner records its failed stage and replaces raw errors with fixed `RunBuildError` messages. Run Service preserves the existing response fields and `BUILD_FAILED` code. Unknown failures keep the generic message. A nonzero build exit identifies the command stage, not a proven syntax/type/import root cause. Timeout/output-limit/CLI-unavailable events have explicit fixed messages. Cleanup remains in `finally`, takes precedence over compilation/cancellation, and blocks later attempts with the same `CLEANUP_UNCONFIRMED` warning rather than degrading to a generic error.

| Check executed for B1 | Result |
| --- | --- |
| Execution unit/HTTP suite | **38/38 passed**, including child-process event fixtures, five runner stages, output/timeout/unavailable reasons, cancellation, cleanup precedence, warning-preserving retries and the exact unchanged HTTP DTO/redaction boundary. |
| Execution typecheck/build and explicit integration-file TypeScript check | Passed, exit 0. An initial test-double type error was fixed with a real unstarted `ChildProcess` instance; type checking was not disabled. |
| Frontend API/session compatibility unit tests | **23/23 passed**; frontend code unchanged. |
| Real Docker integration with existing `:css-check` image | **1/1 passed**, integration case 121.8 seconds. Real accepted run, Next build/export and served CSS; actual invalid TSX produces a safe compile-stage error; active-build cancellation and exact cleanup passed. No browser was launched in this diagnostics rerun; earlier CSS/browser evidence is separate. |
| Earlier Docker attempt | Timed out (240-second test limit; reported elapsed was about 1,343 seconds). Exact cause was not established. Subsequent inspection found a responsive Linux daemon, no remaining labeled containers and no owned test process. This is retained as a failed attempt, not counted as success. |

The failed attempt lacked progress evidence, so the integration now emits only fixed test-stage names and elapsed times. The controlled rerun recorded first build completion at 98.3 seconds, invalid-build classification/cleanup at 115.9 seconds and cancellation/cleanup at 121.8 seconds. Neither test nor production time/resource limits were increased. These are test-only checkpoints, not a production log-stream feature.

Evidence: ignored `output/playwright/execution-diagnostics-unit-final.log`, `execution-diagnostics-frontend-compat.log`, `execution-diagnostics-docker.log` (failed attempt), and `execution-diagnostics-docker-final.log` (passing rerun). Only deterministic fixture source and Project ownership transport were used; no paid/provider request, real Auth/Mongo flow, normal app data write, new image build or app/controller rollout. Existing dependency advisories and public-execution restrictions remain.

Self-review: failure classification does not parse potentially hostile compiler prose; raw messages/diagnostics/stacks never enter the public run DTO. First failure reason is retained if process termination emits another error. Cleanup and cancellation are tested separately. This implements B1's safe stage summaries only, not file/line compiler diagnostics, automated repair, secret/dependency analysis, or pre-publication verification.

## Fallback global-styles fix — 2026-10-23

Branch: `fix/execution-service-preview-styles`, based on clean merged `main` at `edadf58`. Only Execution code, trusted template, tests and documentation changed. No dependency, public API, authentication, AI prompt, real environment, database or frontend application change is included.

**Reproduced:** a snapshot containing `app/page.tsx` and `app/globals.css`, but no root layout, built successfully with the previous `agentforge-preview-runner:local` image. Its exported HTML had no stylesheet link. The strengthened real Docker test failed with `Saved globals.css must be linked from the exported HTML.` A saved file does not enter Next's CSS bundle until imported; the trusted fallback layout had omitted that import.

**Fix:** the small pure `preview/layout.mjs` helper supplies a root layout only when absent, importing the exact saved `app/globals.css` only when present. Custom root layouts remain untouched and own their imports; page-only snapshots do not get a nonexistent CSS import. The Dockerfile explicitly copies the new helper. Browser teardown errors now fail the integration test rather than being swallowed.

| Check executed | Result |
| --- | --- |
| Execution unit/HTTP tests | **23/23 passed**, including four fallback-layout regressions: with CSS, without CSS, supplied root layout and unrelated/case-mismatched stylesheet paths. |
| Execution typecheck/build; `git diff --check` | Passed, exit 0. |
| Dedicated image `agentforge-preview-runner:css-check` | Built successfully. Existing `:local` image ID stayed `sha256:6895fcf073ed0d37c6c8534fa174957dfe823b6e1e5b6385681bd47f91c9d7b9`; no rollout/restart is claimed. Install again reported 8 high and 1 critical dependency advisories, not remediated here. |
| Real Docker HTTP/export/Edge regression | Initial fixed run passed; after the teardown self-audit, final rerun **1/1 passed**, 75.5 seconds for the integration case. Exported HTML links a capability-scoped CSS asset that serves as `text/css`; browser computed body background is `rgb(12, 34, 56)`, counter reaches Count 1, storage/fetch restrictions remain enforced. Invalid TSX rejection, active-build cancellation and exact container cleanup passed. |
| Final independent container check | No labeled preview build containers remained. Existing six Compose containers stayed running/healthy. |

Evidence (ignored local artifacts): `output/playwright/execution-preview-css-before.log` (expected regression failure), `execution-preview-css-image.log`, `execution-preview-css-unit-final.log`, `execution-preview-css-final.log`, and visually inspected `execution-preview-css.png`. Only deterministic fixture source and fixture Project ownership responses were used: no paid/provider request, real Auth/Mongo E2E, normal application data write, cloud sandbox or public deployment. The previously recorded workspace E2E is separate evidence, not rerun for this Execution-only fix. A normal controller needs its runner image rebuilt and controller restarted to adopt the template change; the controller pins its startup image ID.

Self-audit: the fallback never rewrites an existing layout, never adds an absent stylesheet import and does not change source/path, artifact, network or iframe policies. Build success alone was insufficient; the new regression follows HTML → exported CSS → browser computed style. This is a style-inclusion fix, not a deterministic quality gate or a security certification.

## Quality-gate delivery order — B1 implemented; B2/B3 proposed

The workspace-to-preview fixture loop is now recorded in [the testing strategy](../docs/08_TESTING_STRATEGY.md). It is not a mandatory pre-publication quality gate: `project-service/src/services/generation.service.ts` saves validated output and calls `publishGeneration`; `generation.publication.ts` inserts the immutable Revision without requesting a build. Execution's `POST /api/runs` accepts **already-saved revision IDs only** (`src/features/runs/run.routes.ts`). Calling that route before publication is therefore not a working gate.

Recommended order after the focused preview fixes are reviewed:

| Slice | Scope and acceptance | Boundary requiring a decision |
| --- | --- | --- |
| B1: safe build diagnostics | Implemented and tested above: trusted stages/reasons, fixed messages and existing public error codes. | No publication change; any richer result contract still needs review before consumers depend on it. |
| B2: candidate verification before publication | Project retains the model output as a candidate; Execution checks that exact bounded snapshot; Project publishes only after agreed checks pass. Bind evidence to snapshot hash, policy and runner version; replay must not rerun AI or accept a different snapshot's result. Test failures, ownership, concurrent attempts and lost acknowledgements. | Approve the authenticated candidate/check contract, diagnostic policy and recovery semantics first. The browser must not gain an arbitrary source/command execution endpoint. |
| B3: bounded repair | Only after B2: one explicitly capped repair attempt against approved diagnostics and affected files, with attempt history and deterministic fixtures before paid evaluation. | Provider spending and total-attempt limits require separate explicit approval; no autonomous unlimited retry loop. |

**Timing constraint:** today's AI boundary allows 90 seconds, the Next proxy 95 seconds, and the browser generation request 100 seconds; the Docker build alone allows 120 seconds. Simply adding a build fetch inside the existing synchronous generation request is not sufficient. B2 needs a reviewed asynchronous/status contract or a different measured deadline design, without claiming durable restart recovery before durable jobs exist. Existing saved history must remain readable, and no legacy revision may be relabelled `build_passed` without evidence.

B2/B3 remain proposals, not implemented checks, API additions, schema migrations or authorization to change authentication. B1 and the CSS fix do not change revision publication, model calls, public run fields/codes, container isolation or generation deadlines.

### B2 approval proposal: candidate build gate, not a new execution platform

Recommended first scope is **manifest + fixed-template build evidence**; do not claim dependency/secret scanning or a complete M3 security gate. Keep the existing local-only runner, limits, source policy, immutable Revision insert and idempotency identity.

1. Project saves the generated full snapshot as a candidate, identified by Generation ID and canonical snapshot hash. No new model call is needed to retry a saved candidate's check.
2. Add a narrowly scoped authenticated Project-to-Execution candidate-check contract. Execution loads only that stored owned candidate through Project; browsers never gain a raw-files/commands/images submission API. The service credential plus owner-checking scheme must be agreed before adding this new authentication path; never store browser JWTs as durable worker credentials.
3. Bind check results to candidate hash, policy and runner identity. Project records the evidence and remains the only publication authority; failed/unknown checks cannot advertise build-verified success. Immutable legacy revisions stay readable and unverified, not silently reclassified.
4. Roll out frontend support for a documented `202 pending` generation response/status polling before enabling asynchronous checks in Project. Preserve completed `201` replays and stable request keys. Define who resumes saved-candidate checks after timeout/restart; in-process work alone is not a durable queue.
5. Deliver compatible service-scoped PRs in that order: contract/design approval, frontend pending-response compatibility, Execution candidate checking, then Project gating. Use fixtures to prove cross-owner rejection, hash mismatch, build failure, busy admission, concurrent replay, lost acknowledgement and unchanged prior revisions before any paid smoke.

**Required decision before B2 implementation:** approve the new candidate-auth/read contract and asynchronous public response semantics. This is a cross-service/authentication and behavioral contract change, not a safe extra `fetch` added to the current 100-second request. No B2 code, data migration or queue has been started.

## Exact frontend-origin follow-up — 2026-10-22

Independent branch: `fix/execution-service-preview-origin`, based on merged `main` at `00811ef`. Scope is Execution Service configuration, CSP policy, tests and documentation. The separate frontend E2E work and roadmap edit are preserved in named Git stashes, not mixed into this branch. No commit/push/merge is implied by this implementation.

**Reproduced cause:** the opt-in real-service workspace test used Next on `localhost:3102`. Login, saved revision and the real Docker build reached ready, but the preview server hardcoded `frame-ancestors` to the port-3001 aliases. Browser console explicitly reported the frame blocked by that directive. Snapshot `output/playwright/preview-real-debug.yml` recorded “Static Next.js build passed. Build container removed.” beside the blocked iframe. This is an origin mismatch, not a generation/auth failure; it is not evidence that normal port-3001 preview is broken.

**Change:** optional `PREVIEW_FRONTEND_ORIGIN`, validated as one exact loopback HTTP origin before listener startup. Unset keeps both original port-3001 aliases. A custom origin replaces them; no wildcard or reflected unvalidated header text. Sandbox, capability, no-referrer and network restrictions are unchanged.

| Check run for this fix | Actual result |
| --- | --- |
| Execution unit/HTTP regression suite | **19/19 passed**, including three new default/custom/invalid-origin and emitted-header checks. |
| Execution typecheck and build | Passed, exit 0. |
| Explicit `test:preview-browser`, installed Edge channel | **1/1 passed**, 40.4 seconds. Actual Preview HTTP server + interactive sandbox iframe under a custom random-port parent; a second parent is rejected by browser CSP. Storage and fetch remain blocked. Only artifact bytes are fixed fixtures; no HTTP interception or policy override. |
| Earlier zero-cost workspace attempts | First: Chrome startup timed out before application writes. Second: Edge reached real saved-code/Docker-ready state, then failed at the hardcoded ancestor policy. Neither is a successful full E2E run. |
| Cleanup after failed workspace attempts | Reports recorded empty dedicated test collections and no labeled preview containers; dedicated test ports were released. No normal app records or Compose containers were removed. |

Ignored browser-policy log: `output/playwright/execution-preview-origin-browser.log`. The original workspace evidence remains in `output/playwright/preview-real-verification.log` and `preview-real-verification-edge.log`. Paid providers, new Docker builds for this policy fix, dependency remediation and the full workspace E2E after this fix are **not** claimed. Per the chosen branch order, resume that frontend suite only after this dependency merges, configuring its real preview server for its actual frontend origin.

## Original local-preview verification and later audit

Branch: `feature/execution-service-local-preview`, independently based on `main` (`203f45f`). Changes are limited to Execution Service code, template, tests and documentation. Existing frontend-session and Compose commits remain on their own branches. The original implementation remained uncommitted; the subsequent audit/delivery turn was explicitly authorized to create focused commits and PRs.

| Check actually run | Result |
| --- | --- |
| `npm --workspace execution-service test` | 9/9 passed: IDs-only contract, stored file policy, artifact limits, container arguments, duplicate/cancel admission, failure redaction, simulated expiry, preview headers/capability, HTTP authorization/errors/disabled mode. |
| `npm --workspace execution-service run typecheck` | Passed. |
| `npm --workspace execution-service run build` | Passed. |
| Trusted runner image build | Passed with root workspace lockfile; no source `.env` or broad context copy. |
| `RUN_DOCKER_TESTS=1`, `VERIFY_PREVIEW_BROWSER=1`, `npm --workspace execution-service run test:docker` | Passed, final integration duration 136.4 seconds. Real Next.js static export; read-only/offline/no-app-secret probes in exported HTML; React counter clicked in browser; sandbox storage and fetch restrictions verified; invalid TSX failed; cancellation interrupted an actual Next.js build; each exact container removed. |
| Runtime container policy inspection | Observed network `none`, read-only root, 1 GiB memory/swap total, 1 CPU, 128 PID limit, no host binds, all capabilities dropped, UID/GID `1000:1000`. |
| Final `docker ps -a --filter label=agentforge.local-preview=true` | Empty: no preview build containers left. |
| Existing `agentforge-local` stack | All six existing containers remained healthy; not recreated/stopped by this slice. |
| `git diff --check` | Passed; platform LF/CRLF warnings are not behavioral failures. |

## Failures found and fixed

- A double-slash generated path initially passed a regular expression; explicit empty-segment rejection and regression coverage now prevent it.
- A Fetch-based Host test did not actually transmit its overridden Host. The test now uses raw HTTP and checks the real DNS-rebinding guard.
- First real builds compiled JS but attempted an offline installation of missing `@types/node`. The shared lockfile puts the frontend's types in its nested workspace directory; the trusted image now exposes that preinstalled dependency to the fixed template. No generated dependency installation/network allowance was added.
- Added large-valid-artifact coverage and linear base64 validation, avoiding a repeated-group expression on large output.
- Cancellation admission remains occupied until runner cleanup settles. Export directory/symlink checks and cleanup-failure fail-closed behavior were reviewed.

## Scope and limitations of this evidence

- **No paid/model API requests and no normal application database writes.** Source pages and HTTP ownership responses are deterministic test fixtures.
- HTTP authorization tests prove forwarding and status handling against a fixture Project API, not a new real Auth/Mongo persistence E2E.
- The original browser verification used a test-only artifact lookup. The subsequent audited test replaces that lookup with the real HTTP run API, Run Service registry and production preview server; only the upstream Project ownership response remains a fixture. It is still not a real Auth/Mongo or logged-in workspace Preview-button flow.
- Browser `connect-src`/storage restrictions are not a claim that every possible browser navigation is network-isolated. Docker's build network isolation is a separate control.
- Startup/shutdown cleanup and fail-closed code do not guarantee cleanup after a hard host crash; labeled orphan recovery is documented in README.
- The dependency installation reported **8 high and 1 critical vulnerability**. No dependency versions were silently upgraded. Public multi-user execution remains blocked on vulnerability remediation and a reviewed stronger isolation/deployment design.

Local ignored log: `output/playwright/execution-preview-docker.log`. Setup and API contracts: [README](README.md).

## Follow-up self-audit fixes

- Cancel now reports `cancelling` until cleanup finishes. Cleanup failure is typed and visible as `failed` / `CLEANUP_UNCONFIRMED`; another cancel cannot hide the warning.
- Shutdown cancels worker tasks immediately, before waiting for HTTP clients, and bounds connection draining. Repeated shutdown signals are idempotent.
- Artifact reads loop through short reads to EOF, enforcing the remaining byte budget. Observed symlinks/non-regular files are rejected; mutable in-container directory races are not claimed to be completely eliminated by path checks.
- Canonical `app/page.tsx` case is required for Linux builds; already-aborted runs do not start a Docker process or attempt cleanup of an uncreated job.
- Regression suite expanded from 9 to **16 passing tests**, including failed cleanup, short-read truncation, UTF-8 chunk boundaries, and shutdown with an active HTTP response. Typecheck and build passed again.
- **Revised composed integration passed (64.2 seconds):** HTTP POST run -> token-forwarded fixture Project API -> real Docker build -> HTTP status -> actual API-returned preview URL -> browser counter/storage/fetch checks; invalid-build and active-cancellation cleanup also passed. This supersedes the original browser artifact-lookup fixture. No real model, Auth service or normal MongoDB records were used.
- Fresh runner image rebuild passed; no labeled preview containers remained afterward. Current ignored logs: `output/playwright/execution-audit-unit.log`, `execution-audit-image-final.log`, `execution-audit-docker.log`.
