# Project Service

Project owns authenticated projects, immutable revision history and publication. AI Orchestrator owns model requests; Execution owns builds. Controllers forward validated input, services coordinate work, repositories own MongoDB access.

## Local setup

From the repository root run `npm ci`, copy this service's `.env.example` to its ignored `.env`, then run `npm --workspace project-service run dev`. Use a reachable MongoDB, Auth's same access-token verification secret, and AI Orchestrator URL/internal token. Never put credentials in frontend `NEXT_PUBLIC_*` variables. Existing Compose runs with the build gate disabled unless deliberately configured.

Host AI requests use `AI_ORCHESTRATOR_URL=http://localhost:6001`. Port 6000 is rejected at startup because Node Fetch blocks it. Update existing local `.env` files and restart Project/AI together; a server health check alone does not prove Project can call AI.

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

### Durable conversations and checked SSE (2026-10-26)

The legacy JSON POST below stays compatible. New owner-JWT routes are additive:

| Method/path | Input | Result |
| --- | --- | --- |
| GET `/api/conversations` | Optional `before` conversation ID | 20 metadata rows and `nextCursor`. |
| POST `/api/conversations/threads` | `{}` | 201 `{conversation}`; no Project or model call. |
| GET `/api/conversations/:id` | Optional integer `before` turn cursor | Latest 20 turns, `turnCount`, `nextBefore`; never inference. |
| POST `/api/conversations/:id/project` | `{projectId}` | Attach one owned project; no silent relinking. |
| POST `/api/conversations/:id/turns/stream` | `{key,message,projectId?,baseRevisionId?}` | Checked SSE; final saved before completion. |

`key` is 8-64 ASCII letters/digits/underscore/hyphen; `message` is trimmed 1-1,000 characters.
IDs are owned Mongo IDs; a base requires a project. No owner, model, system role, files or forged
transcript is accepted. Project reconstructs recent context from completed saved turns, bounded to
16 messages/16 KB. An unlinked conversation can attach a project after an explicit build.

One conversation document contains at most **100 turns**, so reserve and completion are atomic even
on standalone MongoDB. Sidebar index: `{ownerId:1,_id:-1}`. Owner identity comes only from JWT `sub`.
Admission atomically rejects duplicate keys, concurrent pending turns and full conversations. A completed
same-key/same-body replay reads the saved response with no new inference. Different-body reuse is 409
`IDEMPOTENCY_MISMATCH`; pending/interrupted replay is 409 `CHAT_OUTCOME_UNKNOWN`. New deliberate
turns can expire abandoned pending reservations after 75 seconds; they never auto-retry old work.

The stream emits `start {conversationId,key,contextTrimmed,replayed}`, provisional cumulative
`message {message}`, final `complete {response}` or terminal `error {code,message}`. A provisional
message cannot authorize generation. Project verifies the internal request ID, complete response
schema, UTF-8/frame/count/total-byte bounds and clean EOF before accepting success. The final reply
is saved before `complete`. Disconnect/55-second timeout cancels the upstream signal best-effort;
this is not provider-billing rollback or a durable worker. Raw provider errors never reach the browser.

New browser + same account + same running backend/database can retrieve these records. Existing
browser-only transcripts are not silently uploaded/backfilled. Keep API keys and JWTs out of stored
turns. No database reset/migration/new dependency/environment variable is required. A full conversation
returns 409 `CHAT_BUSY_OR_FULL`; start a new thread rather than allowing an unbounded Mongo document.

Tests: `npm --workspace project-service run test:chat-history` requires an explicit empty local
`AGENTFORGE_TEST_MONGODB_URI` named `agentforge_test_*`. Only AI transport is a fixture; JWT,
HTTP, atomic writes, cross-owner checks and Mongo persistence are real. Frontend integration is a
separate service slice; this backend addition alone does not change the normal browser UI.

### Conversation (no automatic project creation)

`POST /api/conversations` requires the existing owner JWT and accepts only
`{messages: [{role: "user" | "assistant", content}], projectId?, baseRevisionId?}`.
Send 1–16 messages, each 1–4,000 characters, ending with a user message; serialized
messages must fit 16,000 UTF-8 bytes. A base requires an owned project and a revision
belonging to that project. Files are loaded on the server, never supplied by the browser.
No base means no files, including for a saved draft. No query switches are accepted.

The response is `{response: {requestId, action: "reply" | "clarify" | "build", message,
prompt, sources: [{id,title}], retrieval: {method,embeddingModel,inputTokens}, model,
usage: {inputTokens,outputTokens,totalTokens}, latencyMs}}`. Only `build` carries a
10–1,000-character prompt; other actions carry null. A build decision does **not**
publish code: the frontend deliberately invokes the existing idempotent generation
workflow. Conversation/plan requests create no projects, revisions or generation records.

One internal AI request uses the existing URL/token, a 50-second timeout, no redirects
and no retries. Upstream failures return sanitized 502 `AI_UNAVAILABLE`, never browser
401/logout. A user-requested retry may spend again; chat responses are not durable jobs.
The model receives bounded client-supplied conversation plus optional owned revision
context; this is not cross-device server chat history. Legacy brief endpoints remain
supported but are not required by the new chat path. Sources/retrieval metadata describe
the AI service's local knowledge lookup; Project does not perform embeddings itself.

Run the real HTTP/Mongo fixture suite with an **empty dedicated** local
`AGENTFORGE_TEST_MONGODB_URI=mongodb://127.0.0.1:27029/agentforge_test_conversation_20261025`
and `npm --workspace project-service run test:conversation`. It never calls a paid model.

### Saved requirements and confirmation (A2)

Backend flow: `create project → assess → answer → review → confirm → generate`.
The frontend still uses direct generation until A3. No new dependency/env variable is needed; deploy A1's internal assessment endpoint first.

Paths below are relative to `/api/projects/:projectId`; all require owner JWT and reject query switches:

| Method/path | Input | Result |
| --- | --- | --- |
| GET `/brief` | None | 200 `{brief}` or null; no model work. |
| POST `/brief` | `{expectedVersion, answers?: [{question, answer}]}` + `Idempotency-Key` | 200 `{brief}` after assessment or terminal replay. Initial version is 0. |
| POST `/brief/:briefId/confirm` | Empty | 200 `{brief}`; current completed/ready version only. |
| POST `/brief/:briefId/abandon` | Empty | 200 `{brief}`; current pending version only. |
| POST `/brief/:briefId/generations` | Empty + generation `Idempotency-Key` | Existing 201 ready / 202 build-pending `{generation}`, using stored approved brief text. |

The public brief contains `id/version/sourcePrompt/answers/status/assessment/confirmedAt/errorCode/createdAt`; no keys/fingerprints/DB internals. Attempt status (`pending/completed/failed`) is separate from assessment status (`needs_clarification/ready/unsupported`). Confirmation and creation dates are ISO strings, confirmation nullable. AI usage remains null when unknown.

- Submit **all** answers with the last observed version. Only recorded questions may be answered; earlier answers cannot disappear. Maximum six pairs, question 240/answer 1000 characters. Edited answers create an unconfirmed version. Existing public parser is 16 KiB; internal context additionally has a 20,000-byte bound, never truncation.
- Unique version/key indexes initialize before HTTP startup. Pending work blocks new assessments. Same-key changed input is 409 `IDEMPOTENCY_MISMATCH`; stale version is `BRIEF_VERSION_CONFLICT`; pending replay is `BRIEF_IN_PROGRESS`. Terminal replay returns 200 with saved state, including failure, and never repeats AI.
- One upstream HTTP attempt, no redirects/retries, 50-second deadline, 20,000-byte response limit. Sanitized upstream failure is 502 `ASSESSMENT_OUTCOME_UNKNOWN`; persistence uncertainty is 503 `OUTCOME_UNKNOWN`. Preserve key, read/replay first. A deliberate new key may spend again.
- Crash recovery is explicit: GET never resumes model work. Abandonment prevents late resurrection, but cannot cancel/refund a provider call. No automatic background resumption.
- `ready` is not consent. New generation checks the latest confirmed version at admission; later edits do not cancel already admitted work. Historical same-key generation replay retains its frozen prompt/result.
- This additive generation action is **initial-only**, with no base field. Existing follow-ups still use `{prompt, baseRevisionId}` on the original route. That legacy route remains compatible and is **not globally brief-gated**. Old records require no backfill.

See [API details](../docs/05_OPENAPI_SPEC.md#a2-project-owned-requirement-brief--2026-10-23) and [design Q&A](../docs/SYSTEM_DESIGN_QA.md#14-why-store-a-versioned-brief-and-require-confirmation).

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
# Brief suite also refuses a populated test database.
$env:AGENTFORGE_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/agentforge_test_brief_your_unique_run'
npm --workspace project-service run test:brief
# Cross-service fixtures consume Execution's compiled modules.
npm --workspace execution-service run build
npm --workspace project-service run test:build-gate
# Optional real build in the SAME suite; AI remains a deterministic transport fixture.
$env:RUN_DOCKER_TESTS='1'
$env:PREVIEW_RUNNER_IMAGE='agentforge-preview-runner:css-check' # select an existing trusted image
npm --workspace project-service run test:build-gate
```

Fixtures use random loopback listeners and delete only their created project IDs in an explicitly selected `agentforge_test_*` database. Gate tests use a fake build runner by default; the opt-in case uses Docker. Neither proves paid-model/browser behavior. A2 adds two unique indexes on its new `projectbriefs` collection; existing collections need no migration.

A2 evidence (2026-10-23): **34/34 unit, 18/18 brief HTTP/Mongo, 40/40 existing integration, 5/5 deterministic build-gate cases** passed; the opt-in real Docker case was deliberately skipped. Project typecheck/build and Execution build passed. Brief tests cover reconnect/persistence, ownership, races, consent/edits, abandonment/late response, bounded invalid upstream responses, lost acknowledgements and approved-brief generation/replay. AI is a local transport fixture; the brief suite has the build gate disabled. No browser dialogue/live model/preview verification is claimed. Initial Mongo attempt hit an unexposed host port; rerun used a temporary isolated Mongo container on loopback 27028, never the Compose application DB.

Recorded 2026-10-23: 30 unit, 40 existing Mongo integration and 5 deterministic gate cases passed; separate opt-in gate suite passed 6/6 including actual Docker publication (105.7 seconds for the real-build case). Typecheck/build passed. The gate suite covers unpublished 202, both credentials/foreign owner, same-key joining/mismatch, proof-blocked direct publication, failed follow-up preservation, flag-off replay, saved-proof publication outage recovery, and competing checked candidates. Final scoped-fixture cleanup was independently confirmed empty in both dedicated test DBs; no labeled build container remained. Ignored logs: `output/playwright/build-gate-project-{unit-final,integration-final,docker}.log` and `build-gate-legacy-integration.log`.
