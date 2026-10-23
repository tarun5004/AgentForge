# AgentForge V1 — Database Design

## Implemented A2 brief storage (2026-10-23)

Project Service adds `projectbriefs`, separate from code Revision history. Each record stores immutable project/version/request key/fingerprint/source prompt/cumulative answers, plus attempt status, validated nullable assessment, confirmation/error fields and timestamps. Owner is resolved through the parent Project's JWT ownership; caller-supplied owner IDs are not stored/trusted.

Unique `(projectId, version)` and `(projectId, idempotencyKey)` indexes admit only one winner for a next-version/key reservation. Startup awaits model/index initialization before accepting HTTP. Latest is the indexed highest version, not a mutable pointer. One insert reserves pending work before the external request; conditional `pending → completed/failed` prevents abandoned work from reviving. Confirmation is a conditional completed/ready timestamp update, separate from model output.

No transaction or lock is held around AI. Lost acknowledgements are reread; unknown outcomes keep identity and do not automatically repeat AI. Crash-before-completion can remain pending until explicit owner abandonment. Older confirmations remain historical, but new-generation admission checks the actual latest version. Edits after admission do not cancel in-flight generation. Existing Project/Generation/Revision schemas and legacy data remain unchanged; the direct-generation API is still supported. These are application guarantees, not protection against direct DB operators.

Validation uses an explicit empty dedicated `agentforge_test_*` DB and scoped fixture cleanup, never application records. See [A2 routes/evidence](../project-service/README.md#saved-requirements-and-confirmation-a2).

## Implemented Slice 4 publication model (2026-10-12)

This section supersedes the older allocator/optional-lineage descriptions in the dated slice notes below. Current production code uses existing unique indexes, not multi-document transactions or a mutable latest-revision pointer.

- A new Generation captures normalized source prompt/base/fingerprint/policy and `expectedVersion = actual highest Revision version + 1` before AI. The owned parent may be historical; parentage is independent of version order.
- Save the independently validated full result, deterministic A/M/D and local `manifest_validated` policy before publishing. Ambiguous writes preserve the attempt/key and return 503 rather than claiming model failure.
- A single Revision insert is the authoritative commit. Existing unique `generationId` and `(projectId, version)` indexes arbitrate same-attempt recovery and competing publications. An intervening head change conflicts; losers are not reassigned the next version. Failed attempts reserve no version.
- New snapshots record nullable `parentRevisionId`, `sourcePrompt`, `fileChanges`, provider/model, usage/latency, validation and `schemaVersion: 2`. These fields are optional for legacy records; no inferred parent/prompt, destructive backfill, collection rewrite or new index. Published payload fields are Mongoose-immutable and there is no revision update API; direct database operators are outside this application guarantee.
- Generation ready/failed metadata includes optional completion/failure timestamps. Ready status, its revision pointer and Project status/counter are secondary bookkeeping. Repair uses `$max` for the Project counter so it never moves backwards; latest reads continue to derive from Revision records.
- POST replay first checks for a committed Revision, then can publish already-saved validated output using its captured version without another AI call. A legacy saved result without captured intent/version is uncertain, never guessed. GET generation status is read-only and does not publish or repair anything.

There is no background recovery worker: a crash before result saving may leave pending work requiring reconciliation/user action. Tests use only the isolated local `agentforge_test_slice4_20261012` database; normal application records/indexes were not modified by verification.

## Implemented Slice 1 read model (2026-10-10)

The sections below retain long-term V1 targets. Current Project Service uses `projects`, `generations`, and `revisions`; this slice adds read paths only and makes no model/index changes or record migrations.

| Read | Actual query and authority |
| --- | --- |
| Project page | Verified JWT `ownerId` filter, ordered by `createdAt` and `_id` descending, limit + 1 to identify another page. |
| Project detail | Match `_id` **and** verified owner; explicitly project public fields. |
| Latest revision | Highest saved `version` for an already-owned project; a single aggregation batches a project page's latest metadata. No mutable latest pointer/counter is authoritative. |
| Revision history | Ownership check first, then `projectId` and optional `version < beforeVersion`; descending version and limit + 1; exclude files with an inclusion projection. |
| Revision detail | Ownership check first, then match `projectId` **and** `_id`; include saved files but serialize only their path/content. |

Existing indexes include Project `ownerId` and `(ownerId, createdAt descending)`, and Revision's unique `(projectId, version)` and unique `generationId`. The latest batch orders both project ID and version descending, compatible with reversing the existing compound revision index. No new index was installed on the normal database.

The local isolated-test database's project-page query plan showed `IXSCAN`, `FETCH`, and `SORT`. The existing Project index lacks the `_id` tie-breaker, so index-only sort coverage at production scale is not claimed. A future measured performance decision may add `(ownerId, createdAt descending, _id descending)`; it is not silently included here.

Read DTOs turn ObjectIds into strings and timestamps into ISO strings. `parentRevisionId` and `sourcePrompt` are read when stored, otherwise `null` (unknown). The current Revision schema does not yet write those fields; no preceding-version lineage or Project initial prompt is substituted. All read responses reject serialized content above 1 MiB instead of altering saved records.

Normal application records were not used as test data. Integration tests initialized existing model indexes and cleaned only fixture records in a positively identified local `agentforge_test_*` database; final counts for its projects, revisions, and generations were all zero.

## 1. Ownership

### Implemented Generation intent fields (Slice 2, 2026-10-11)

New initial attempts save immutable `sourcePrompt`, nullable `baseRevisionId`, `requestFingerprint`, `expectedVersion: 1`, and `requestPolicyVersion: "generation-request-v1"` in the pending Generation insert. These fields are optional with no fabricated defaults on old records. There is no collection rewrite, new index, or destructive migration. The existing unique `(projectId, idempotencyKey)` index controls same-key insertion races.

Replay queries the actual Revision by both project and Generation IDs and serializes its saved files/version. Stored Generation status and its revision pointer may be stale. `expectedVersion` is currently identity-phase metadata only: the old Project-counter allocation remains until the separate publication redesign. Different-key races and multi-write recovery are not solved by adding these fields.

One managed MongoDB cluster may be used for cost reasons, but each service owns a separate logical database and credentials:

| Database | Owner | Collections |
| --- | --- | --- |
| auth | Auth service | users, refresh_sessions, key_metadata |
| projects | Project service | projects, revisions, generation_requests |
| ai_usage | AI Orchestrator | provider_calls, policy_versions |
| execution | Execution service | runs, run_events |

No service reads another service's database directly.

## 2. Core documents

### projects.projects

Fields: id, ownerId, name, templateId, status, latestRevisionId, createdAt, updatedAt, archivedAt.

Indexes: ownerId plus updatedAt descending; id plus ownerId.

### projects.revisions

Fields: id, projectId, parentRevisionId, number, sourcePrompt, normalizedSpec, files, dependencies, status, generationRequestId, validationSummary, createdAt.

Indexes: unique projectId plus number; projectId plus createdAt descending.

### ai_usage.provider_calls

Fields: id, requestId, projectId, userIdHash, policyVersion, provider, model, stage, inputTokens, outputTokens, latencyMs, resultStatus, createdAt.

The document contains metadata, not provider secrets and not raw prompt/completion content by default.

### execution.runs

Fields: id, projectId, revisionId, requestedBy, status, jobName, startedAt, finishedAt, exitCode, diagnostics, logObjectKey, createdAt.

Indexes: projectId plus createdAt descending; status plus createdAt; TTL index for transient event/log metadata.

## 3. Retention

- Revisions are durable until project deletion.
- Raw execution logs expire after 7 days in V1.
- Provider usage metadata is retained for 90 days.
- Refresh sessions are deleted at expiry or logout.

## 4. Data constraints

- A user may own at most 20 active projects in V1.
- A revision has at most 100 text files and 1 MB total source content.
- Prompt max is 8,000 characters.
- Project deletion is soft-delete first, then asynchronously purges owned data.
