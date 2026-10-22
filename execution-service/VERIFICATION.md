# Local preview verification — 2026-10-22

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
