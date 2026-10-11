# AgentForge V1 — Public API Contract

The V1 target contract uses `/api/v1` and request IDs. These are future conventions, not guarantees of the current application. The implemented Project Service routes below use `/api/projects` and the existing `{ message }` error wrapper.

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

**Intentional gate:** a new key on a project that already has a revision requires a change prompt and base (`400 BASE_REVISION_REQUIRED` if absent). An explicit base must belong to the owned project; a missing/foreign base returns 404. A valid owned base currently returns `409 FOLLOW_UP_NOT_AVAILABLE`. Follow-up context/merge is not implemented, so no prompt is silently treated as an original-prompt regeneration. Replay is resolved before this new-request gate.

This is an initial-generation identity slice, not the complete revision loop. New `expectedVersion` is 1 because only initial attempts are admitted; it is preparatory metadata, **not yet publication authority**. The existing revision-counter allocation/publication path, different-key concurrency, crash recovery before publication, and saved-result publication retries still require the later publication slice. No queue, status GET, frontend, provider integration change, or schema backfill was added.

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
