# AgentForge V1 — Database Design

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
