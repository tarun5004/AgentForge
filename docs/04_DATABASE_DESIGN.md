# AgentForge V1 — Database Design

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
