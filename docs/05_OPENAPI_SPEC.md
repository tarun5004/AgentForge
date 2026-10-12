# AgentForge V1 — Public API Contract

The V1 target contract uses `/api/v1` and request IDs. These are future conventions, not guarantees of the current application. The implemented Project Service routes below use `/api/projects` and the existing `{ message }` error wrapper.

## Current Slice 4 — owned follow-ups and reliable publication (2026-10-12)

This section supersedes the dated Slice 2/3 gates and publication limitations below. Authentication, normalized 10–1,000-character prompts, strict body fields and `Idempotency-Key` rules remain unchanged. There is no public `/api/v1`, queue or 202 response in this slice.

`POST /api/projects/{projectId}/generations` supports initial omitted/empty bodies or `{ prompt }` when the project has no saved revision. A **new** attempt on a project with revisions requires `{ prompt, baseRevisionId }`; missing base returns 400 `BASE_REVISION_REQUIRED`. The selected revision must belong to the owned project (otherwise 404), but may be historical. Project Service loads its files, revalidates/bounds the context, and captures `expectedVersion = actual latest saved version + 1` before calling AI. Browser-supplied files, ownership, provider/model, counters and credentials remain prohibited.

```json
{
  "prompt": "Make the hero background darker",
  "baseRevisionId": "66d123456789abcdef123456"
}
```

HTTP 201 `{ generation }` contains the existing ready result (`id`, `status`, `revisionId`, `revisionVersion`, `summary`, **complete** `files`, provider/model, usage and latency). It additionally returns `parentRevisionId`, `sourcePrompt`, deterministic `fileChanges: [{ path, status: "A" | "M" | "D" }]`, and `validation`. Unchanged files have no change entry; a deleted path has no current file content. New validation is `{ policyVersion: "frontend-manifest-v1", status: "manifest_validated" }`, earned by local independent checks, not an assumed upstream claim or build/run proof. Unknown legacy lineage/change/validation fields are `null`.

Revision detail GET adds nullable `fileChanges`, provider/model, usage/latency, validation and `schemaVersion` (2 for new snapshots); legacy absent metadata stays `null`. History lists continue to omit files and full provider metadata. Old revisions are not altered by follow-ups. Published version order is not lineage: v3 may intentionally have v1 as its parent.

### Request replay and publication

Resolve an existing matching key before applying new-request base rules. Different normalized input returns 409 `IDEMPOTENCY_MISMATCH`. Publication saves validated full output then atomically inserts one immutable Revision under existing unique indexes. Counter reservation is removed; failed attempts create no version gap. Captured-head conflicts return 409, never an automatically reassigned version.

| Persisted evidence | POST replay behavior |
| --- | --- |
| Revision committed for this attempt | 201 saved revision/version, even with stale pending/failed status; repair secondary hints best-effort. New revisions carry their own provider metadata. |
| Pending without saved result | 409 `GENERATION_IN_PROGRESS` with `generationId`; no additional AI call. |
| Pending with validated saved result | Retry publication at the original captured version; no additional AI call. |
| Terminal conflict without Revision | 409 `REVISION_CONFLICT`; a deliberate new attempt needs a new key. |
| Other terminal failure without Revision | 409 `GENERATION_FAILED`; do not silently restart the model. |
| Write acknowledgement/read cannot establish outcome | 503 `OUTCOME_UNKNOWN`; preserve the key and reconcile via read/replay. |
| Legacy intent/version cannot establish safe publication | 503 `OUTCOME_UNKNOWN`; never infer a candidate version/parent. Existing committed empty-body replay remains supported. |

Different keys may both call AI while observing the same head, but only one publishes its candidate version. A conflicting response includes `generationId` and `latestRevisionId` when established; repeated conflict responses need not include the latter. Same-key competitors create one attempt and at most one revision. Lost insert acknowledgement is checked against actual Revision evidence; a failure updating ready/status/counter after insertion cannot turn committed success into failure.

### Read-only generation status

`GET /api/projects/{projectId}/generations/{generationId}` requires bearer auth, valid IDs, owned project and an attempt matching project/owner/ID. No query parameters are accepted. Foreign/missing project or attempt returns 404. It never calls AI, publishes output or repairs bookkeeping.

- Committed Revision: HTTP 200 `{ generation }` with the same complete ready shape as POST replay.
- No Revision: HTTP 200 `{ generation: { id, status: "pending" | "failed", hasSavedResult, errorCode } }`. Pending has `errorCode: null`; failed exposes a bounded stable code. A pending record is not proof of a running worker.
- Stored ready status without an established Revision, or missing required committed metadata: 503 `OUTCOME_UNKNOWN`.

Status/detail reads retain the 1 MiB UTF-8 response bound. Errors keep `message` plus optional `code`, `generationId`, `latestRevisionId`. Unsafe historical context is still viewable but yields 400 `BASE_REVISION_INVALID` before a new attempt; oversized context/merged output yields 413 `CONTEXT_TOO_LARGE`/`SNAPSHOT_TOO_LARGE`. Upstream/invalid AI output yields sanitized 502; uncertain persistence yields 503. Browser history/follow-up wiring, durable workers, build checks and real provider quality remain outside this backend slice.

## Implemented Slice 1 — project and revision reads

Verified on 2026-10-10. Every route requires `Authorization: Bearer <access-token>`; ownership comes only from the verified JWT subject. IDs must be exactly 24 hexadecimal characters. Unknown, repeated, nested, or malformed query values are rejected before database access. Detail routes accept no query parameters.

| Method/path | Accepted query | HTTP 200 wrapper |
| --- | --- | --- |
| GET `/api/projects` | `limit`, opaque `cursor` | `{ projects, nextCursor }` |
| GET `/api/projects/{projectId}` | None | `{ project }` |
| GET `/api/projects/{projectId}/revisions` | `limit`, positive safe-integer `beforeVersion` | `{ revisions, nextCursor }` |
| GET `/api/projects/{projectId}/revisions/{revisionId}` | None | `{ revision }` |

Both lists default to 20 records and permit limits from 1 to 50. Use canonical decimal integers without leading zeroes. An empty or exhausted list has `nextCursor: null`.

Project pages sort by `createdAt` descending, then ID descending to break timestamp ties. Pass the returned opaque `nextCursor` unchanged as `cursor` on the next request. It encodes only the last date/ID position, never ownership or MongoDB operators. The authenticated owner filter is reapplied on every page.

Revision history sorts by `version` descending. Its `nextCursor` is a decimal version **string**, not the project cursor format: pass it as `beforeVersion` on the next request. The boundary is exclusive. Example: versions 3 and 2 yield `nextCursor: "2"`; `?beforeVersion=2` reads versions below 2. Do not send `cursor` to the history route.

A project contains `id`, `name`, `initialPrompt`, `template`, stored advisory `status`, ISO `createdAt`/`updatedAt`, and `latestRevision`. The latest metadata is derived from the highest saved Revision version, not Project counters/status; it is `null` if no revision exists. A failed generation does not hide an earlier saved revision. Listing fetches latest metadata in one batch, not one query per project.

Revision summaries contain `id`, `projectId`, `generationId`, `version`, `summary`, `parentRevisionId`, `sourcePrompt`, and ISO `createdAt`/`updatedAt`. They never contain `files`. Missing legacy parent/prompt fields return `null` meaning **unknown**; no parent or producing prompt is guessed. Existing recorded values are returned when present. There is no lineage backfill or schema migration in this slice.

Revision detail adds the complete saved `files` array, containing only `{ path, content }`. It is filtered by both project ID and revision ID, after checking project ownership. File reads do not run code or prove build correctness.

All four read responses have a 1 MiB serialized UTF-8 byte ceiling, including the wrapper. Oversized legacy records return 413 without truncating content. A limit on records alone does not protect against unusually large historical content.

| Status | Meaning / existing response shape |
| --- | --- |
| 400 | Invalid IDs, unsupported query, malformed cursor, or invalid pagination: `{ "message": "..." }` |
| 401 | Missing, invalid, or expired access token: `{ "message": "..." }` |
| 404 | Missing/foreign project: `{ "message": "Project not found." }`; missing or wrong-project revision within an owned project: `{ "message": "Revision not found." }` |
| 413 | Saved response exceeds the byte ceiling: `{ "message": "Saved data exceeds the 1 MiB read response limit." }` |
| 500 | Unexpected database/server failure: the existing sanitized error handler applies. |

These GET routes do not change existing create-project or initial-generation POST contracts. Follow-up generation, generation-status GET, frontend reload/history integration, and `/api/v1` routing are not implemented by Slice 1.

## Implemented Slice 2 — initial request identity and replay (2026-10-11)

`POST /api/projects/{projectId}/generations` still requires a bearer token and an `Idempotency-Key` of 1–100 trimmed characters. An omitted body or `{}` uses the owned Project's saved initial prompt. A new initial attempt may supply `{ "prompt": "Build a restaurant landing page" }`; the trimmed 10–1,000-character prompt is recorded and is the actual prompt sent to AI. Unknown body fields, malformed IDs, and invalid prompts are rejected before database reads. Express retains its 16 KiB JSON-body limit; oversized bodies return 413 `REQUEST_TOO_LARGE` rather than 500.

New attempts save `sourcePrompt`, nullable `baseRevisionId`, a SHA-256 fingerprint of normalized project/prompt/base, `expectedVersion`, and `requestPolicyVersion: "generation-request-v1"` before calling AI. The fingerprint identifies input; it does not encrypt the prompt or replace JWT authorization. Whitespace around a prompt and casing of base IDs normalize consistently.

The same key plus equivalent input resolves the original attempt. Different valid input returns 409 `IDEMPOTENCY_MISMATCH`. A duplicate insert under the exact installed `(projectId, idempotencyKey)` unique index rereads the winner; only the insert winner starts an AI call. Other duplicate constraints are not disguised as retries.

Replays look for the saved Revision by project and generation ID, rather than trusting a mutable status or revision pointer. A saved revision returns HTTP 201 with complete snapshot files, model/usage metadata, and `revisionVersion`, even when bookkeeping still says pending/failed. If a pending snapshot was read before the winner saved output, metadata is reread once. There is no repair of bookkeeping in this slice.

| Existing attempt state | Current replay behavior |
| --- | --- |
| Committed revision and result metadata exist | Return saved success; no additional AI call. |
| Pending without a saved revision | 409 `GENERATION_IN_PROGRESS` with `generationId`; this is a pending record, not a promise that a worker is running. |
| Failed without a saved revision | 409 `GENERATION_FAILED` with `generationId`. A deliberate new initial attempt on a project without revisions may use a new key. |
| Ready but revision is absent, or committed revision lacks result metadata | 503 `OUTCOME_UNKNOWN`; retain the key rather than silently starting another model call. |
| Legacy record without a fingerprint | Only its original omitted/empty body can replay. Explicit input is unverifiable and returns 409 `IDEMPOTENCY_MISMATCH`; no guessed fingerprint/backfill. |

Errors retain `{ message }` and may add `code` and `generationId`. Owner/project/revision hiding remains 404.

**Intentional gate:** a new key on a project that already has a revision requires a change prompt and base (`400 BASE_REVISION_REQUIRED` if absent). An explicit base must belong to the owned project; a missing/foreign base returns 404. A valid owned base currently returns `409 FOLLOW_UP_NOT_AVAILABLE`. Public follow-up publication is not implemented; the internal context/merge boundary is available in Slice 3 below. No prompt is silently treated as an original-prompt regeneration. Replay is resolved before this new-request gate.

This is an initial-generation identity slice, not the complete revision loop. New `expectedVersion` is 1 because only initial attempts are admitted; it is preparatory metadata, **not yet publication authority**. The existing revision-counter allocation/publication path, different-key concurrency, crash recovery before publication, and saved-result publication retries still require the later publication slice. No queue, status GET, frontend, provider integration change, or schema backfill was added.

## Implemented Slice 3 — internal context and file-change boundary (2026-10-12)

This slice changes the **internal** Project↔AI contract, not browser follow-up availability. `POST /internal/generations` retains internal-token authentication and existing `requestId`, `projectId`, `prompt`, `template: "nextjs"`, and `mode: "economy"`. An optional `baseRevision` has exactly `{ id, version, files }`: a 24-hex ID, positive safe-integer version, and a complete nonempty generated-file snapshot. Project Service must load that owned revision itself when the later publication slice enables follow-ups; browser-supplied files remain prohibited.

Both services validate frontend paths/content and reject ambiguous path aliases/case duplicates. Limits remain 12 files, 120-character paths, 30,000 characters per file, 120,000 total snapshot characters, and 1,000-character user prompts. The serialized internal request must be at most **240,000 UTF-8 bytes**, below the unchanged 256 KiB AI parser ceiling. Oversize input is rejected, never truncated. Project Client checks before fetch; AI returns 413 `CONTEXT_TOO_LARGE` for the context or parser ceiling.

Initial model prompts remain the original user prompt. Follow-up prompts encode only `{ changePrompt, baseRevision }` as JSON; file contents are untrusted data, not higher-priority instructions. Model output retains `summary` and `files`, where internal `files` now means **complete-content upserts** (add/replace), plus `deletedPaths`. Omitted files are preserved. An absent `deletedPaths` defaults to `[]` for compatibility. Deletion-only follow-ups are valid, but missing/duplicate deletion targets, overlapping update/delete operations, case-only aliases, no-ops, and empty or oversized final snapshots are rejected. Initial output must contain files and cannot delete anything.

The AI response adds `validation: { policyVersion: "frontend-manifest-v1", status: "manifest_validated" }`. This is a bounded static manifest policy, not a complete JavaScript security scan, build result, or execution proof. Old initial responses may omit validation metadata; Project Service does not fabricate it.

Project Client correlates the returned `requestId`, independently validates/merges operations, and returns a local `snapshot: { files, fileChanges }` to its caller. Changes are deterministic A/M/D entries (added/modified/deleted), with no entry for unchanged files. Parent input is not mutated. Initial publication now saves this locally validated full snapshot; public `generation.files` remains the complete snapshot and exposes neither internal deletion operations nor the local helper wrapper. Invalid AI output cannot create a Revision. Current generation error handling still maps initial-generation failures to its existing sanitized 502 response; precise publication/failure recovery remains a later slice.

No database schema/index, public route, frontend, dependency, model selection, queue, or execution change was made. Public follow-ups remain gated until reliable revision publication is implemented. Selected-base context was verified through local contract/prompt/HTTP fixtures, not a paid provider or browser revision loop.

## Auth service

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /auth/register | Create user and session |
| POST | /auth/login | Start session |
| POST | /auth/refresh | Rotate refresh token |
| POST | /auth/logout | Revoke current session |
| GET | /auth/me | Current user |
| GET | /.well-known/jwks.json | JWT verification keys |

## Project service

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /projects | Create project |
| GET | /projects | List caller's projects |
| GET | /projects/{projectId} | Read owned project |
| PATCH | /projects/{projectId} | Rename/archive project |
| DELETE | /projects/{projectId} | Request project deletion |
| POST | /projects/{projectId}/generations | Start generation |
| GET | /projects/{projectId}/generations/{generationId} | Generation status |
| GET | /projects/{projectId}/revisions | List revisions |
| GET | /projects/{projectId}/revisions/{revisionId} | Read revision files |

Version Zero create-project request (currently exposed at `POST /api/projects`):

~~~json
{ "prompt": "Build a portfolio for a frontend developer" }
~~~

Successful response: HTTP 201 with a `project` containing `id`, derived `name`, `initialPrompt`, `template`, `status`, and `createdAt`. The authenticated user's id becomes the internal `ownerId` and is never accepted from the request body.

Version Zero create-generation request (currently exposed at `POST /api/projects/{projectId}/generations`):

- Requires the normal bearer access token.
- Requires an `Idempotency-Key` header (maximum 100 characters).
- An omitted/empty body uses the owned project's saved prompt; an explicit initial prompt follows the Slice 2 contract above.

Successful response: HTTP 201 with a ready generation, immutable `revisionId`, summary, validated files, provider/model metadata, latency, and token usage. Repeating a completed request with the same idempotency key returns the saved result instead of calling the model again.

The internal call from Project Service to AI Orchestrator is `POST /internal/generations`. It requires `X-Internal-Service-Token` and is not a browser-facing API.

Planned V1 asynchronous request:

~~~json
{
  "prompt": "Build a portfolio for a product designer",
  "mode": "auto",
  "baseRevisionId": "optional revision id"
}
~~~

The V1 queue-backed response will use HTTP 202 with generationId, status queued, and a status URL.

## Execution service

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /runs | Queue validated revision run |
| GET | /runs/{runId} | Read terminal/progress state |
| GET | /runs/{runId}/logs | Read sanitized logs |
| POST | /runs/{runId}/cancel | Cancel caller-owned run |

Create run request:

~~~json
{ "projectId": "id", "revisionId": "id" }
~~~

## Error contract (V1 target)

~~~json
{
  "type": "https://agentforge.dev/errors/validation",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_ERROR",
  "requestId": "uuid"
}
~~~

Common codes: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, TOKEN_BUDGET_EXCEEDED, PROVIDER_UNAVAILABLE, SANDBOX_REJECTED.
