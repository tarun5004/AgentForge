# Project Service

Project owns authenticated projects, immutable revision history and publication. AI Orchestrator owns model requests; Execution owns builds. Controllers forward validated input, services coordinate work, repositories own MongoDB access.

## Local setup

From the repository root run `npm ci`, copy this service's `.env.example` to its ignored `.env`, then run `npm --workspace project-service run dev`. Use a reachable MongoDB, Auth's same access-token verification secret, and AI Orchestrator URL/internal token. Never put credentials in frontend `NEXT_PUBLIC_*` variables. Existing Compose runs with the build gate disabled unless deliberately configured.

## Opt-in candidate build gate (B2/3)

```text
Owned prompt -> AI -> save candidate -> 202 pending
  -> Execution loads owned candidate -> restricted build/export/cleanup
  -> persist matching build evidence -> immutable Revision insert
  -> browser GET status observes ready
```

Set `BUILD_GATE_ENABLED=true`, a **separate** random `EXECUTION_CHECK_TOKEN` shared with Execution, and `EXECUTION_SERVICE_URL=http://127.0.0.1:5100`. Execution needs `LOCAL_PREVIEW_ENABLED=true`, the trusted pinned runner image, the same token, and `PROJECT_SERVICE_URL` pointing **directly** to this Project listener (for example `http://127.0.0.1:3000`), not the frontend proxy, which does not forward `/internal`.

Both control-plane services must run on the trusted host for this local-only configuration. `127.0.0.1` inside a Compose container is that container, not the host. Do not turn on the gate in the existing container stack and assume it can reach the host controller. This change does not publish controller ports, mount Docker sockets, rewrite real `.env` files or deploy public execution. Ordinary generation/preview behavior remains available with the gate disabled. Public production activation is rejected.

- A new attempt captures its build policy in the Generation insert. Turning off the flag later affects only new attempts; it cannot bypass an already-captured gate on replay.
- AI still uses its existing 90-second request boundary. Once validated output is saved, Project returns 202 and checks it in a bounded, process-local worker (maximum eight active tasks). The build request has its own 180-second deadline; no browser connection is held for the build.
- Only IDs/hash go to Execution. Owner JWT and separate service token travel in headers; JWTs exist only in active invocation memory. They are not saved in Mongo or pending browser intent.
- Successful evidence includes exact source hash, policy, pinned image ID, check ID and completion time. The publisher independently revalidates the snapshot and proof before its authoritative immutable insert. Ready responses and revision reads expose matching `buildVerification`; legacy records stay null/unverified.
- Compile rejection stores `BUILD_VERIFICATION_FAILED` and publishes nothing. Busy, timeouts, expired internal JWTs and transport/database uncertainty remain pending. The prior revision stays usable. GET status is read-only and never starts a check/model call.
- An explicit same-key/body POST resumes a saved candidate using the caller's fresh JWT. Saved proof can resume publication without another model **or build** call. A restarted process may need to repeat a build if no proof was saved; it is not a durable queue. Crashes before AI output saving retain the existing pending/unknown limitation.
- Existing head/version uniqueness still arbitrates competing candidates. They do not silently become consecutive edits. No model repair loop, dependency/secret scanner, live terminal, Kubernetes or production security certification is included.

## Routes

Public owner-JWT APIs: POST/GET `/api/projects`, GET project detail, GET revision list/detail, POST `/:projectId/generations` with `Idempotency-Key`, GET `/:projectId/generations/:generationId`. Initial body `{}`/`{prompt}`; follow-up `{prompt, baseRevisionId}`. Gated saved candidates return 202 pending; committed results/replays return 201. History/status reads return 200.

Internal candidate GET: `/internal/projects/:projectId/generations/:generationId/candidate`, protected by **both** `Authorization` and `X-Execution-Check-Token`. No-store response `{candidate: {projectId, generationId, snapshotHash, files}}`. Ownership and all IDs are rechecked; unowned/mismatched/failed candidates return 404; missing service auth is 403. Internal service failures do not invalidate the browser's login. See [actual API contracts](../docs/05_OPENAPI_SPEC.md).

## Verification

```powershell
npm --workspace project-service test
npm --workspace project-service run typecheck
npm --workspace project-service run build
# Choose an isolated local DB; never use normal application data.
$env:AGENTFORGE_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/agentforge_test_your_unique_run'
npm --workspace project-service run test:integration
# Cross-service fixtures consume Execution's compiled modules.
npm --workspace execution-service run build
npm --workspace project-service run test:build-gate
# Optional real build in the SAME suite; AI remains a deterministic transport fixture.
$env:RUN_DOCKER_TESTS='1'
$env:PREVIEW_RUNNER_IMAGE='agentforge-preview-runner:css-check' # select an existing trusted image
npm --workspace project-service run test:build-gate
```

Fixtures use random loopback listeners and only delete records under project IDs they created in the explicitly selected `agentforge_test_*` database. The default gate tests use a fake build runner but real Project/Execution HTTP, JWT ownership and Mongo. The opt-in final case delegates to real Docker. Neither is paid-model or logged-in browser verification. No index change or destructive migration is needed.

Recorded 2026-10-23: 30 unit, 40 existing Mongo integration and 5 deterministic gate cases passed; separate opt-in gate suite passed 6/6 including actual Docker publication (105.7 seconds for the real-build case). Typecheck/build passed. The gate suite covers unpublished 202, both credentials/foreign owner, same-key joining/mismatch, proof-blocked direct publication, failed follow-up preservation, flag-off replay, saved-proof publication outage recovery, and competing checked candidates. Final scoped-fixture cleanup was independently confirmed empty in both dedicated test DBs; no labeled build container remained. Ignored logs: `output/playwright/build-gate-project-{unit-final,integration-final,docker}.log` and `build-gate-legacy-integration.log`.
