# AgentForge Engineering Memory Design

**Status:** Target design only — no implementation is claimed

**Earliest roadmap position:** M6, after durable projects/revisions and generation quality gates

## Goal

Engineering memory should help AgentForge reuse verified project knowledge—architecture decisions, constraints, prior fixes, coding conventions, and relevant local notes—without blindly copying stale text into a model prompt. Every retrieved item must carry provenance, freshness, access scope, and verification state.

## Current state

The repository currently has no memory record model, ingestion pipeline, retriever, embeddings, vector database, Obsidian scanner, MCP client/server, or retrieval evaluation harness. Existing Markdown documents are human-readable repository files only; they are not runtime memory.

## Design principles

1. **Start with deterministic storage and lexical retrieval.** Do not add a vector database before a measured baseline shows that keyword/metadata retrieval is insufficient.
2. **Project ownership is mandatory.** Memory retrieval must use the authenticated owner and project scope before ranking content.
3. **Provenance travels with content.** The model and user must be able to see where a fact came from.
4. **Verified beats merely similar.** Ranking must prefer current, verified records over semantically close but stale notes.
5. **Local notes remain local-first.** A remote service must never assume direct access to a user's Obsidian filesystem.
6. **MCP is a protocol boundary, not the memory database.** MCP may expose approved search/read tools later; it does not replace storage, policy, or evaluation.

## Proposed ownership

Begin as an **Engineering Memory module inside Project Service**, because memory access is project/owner-scoped and M6 does not yet justify another deployable service. Keep repository/service interfaces explicit so the module can be extracted later if independent scaling, retention, or security requirements appear.

AI Orchestrator receives a bounded, already-authorized context packet. It must not query the database or a local vault directly.

## Core record model

```ts
type EngineeringMemoryRecord = {
  id: string;
  ownerId: string;
  projectId?: string;
  sourceType: "project_revision" | "decision" | "incident" | "manual_note" | "obsidian_note";
  sourceUri: string;
  sourceHash: string;
  title: string;
  content: string;
  tags: string[];
  language?: string;
  validFrom: string;
  validUntil?: string;
  verification: {
    status: "unverified" | "verified" | "superseded";
    verifiedAt?: string;
    verifiedBy?: string;
  };
  sensitivity: "normal" | "restricted";
  createdAt: string;
  updatedAt: string;
};
```

Chunks used for retrieval should reference the record rather than duplicate authority fields. Store `chunkIndex`, byte/token range, chunk text, chunk hash, and optional embedding metadata (`provider`, `model`, `dimensions`, `createdAt`).

## Ingestion pipeline

```text
Approved source
  -> scope and path policy
  -> normalize text
  -> secret/sensitive-content scan
  -> content hash and deduplication
  -> metadata extraction
  -> bounded semantic chunks
  -> lexical index
  -> optional embedding worker (only after evaluation justifies it)
  -> searchable version with provenance
```

### Initial source order

1. Explicit manual memory records created inside an owned project.
2. Verified project revisions and architecture decisions already stored by AgentForge.
3. Repository Markdown files selected through an explicit allowlist.
4. Obsidian vault content through the local connector described below.

Generated chat text should not automatically become verified memory. It may be saved as `unverified` only through an explicit action or well-defined project event.

## Retrieval flow

1. Project Service authenticates the user and resolves the owned project.
2. It derives a retrieval query from the user request plus current project metadata; raw secrets and full unrelated chat history are excluded.
3. Hard filters apply first: owner, project/global scope, sensitivity permission, non-superseded state, and validity dates.
4. Lexical/metadata retrieval produces candidates.
5. Optional semantic retrieval can add candidates after M6 evaluation proves value.
6. A deterministic reranker weighs verification, source type, freshness, exact identifiers, and relevance.
7. A strict token/byte budget selects diverse records and produces a context packet.
8. AI Orchestrator receives the packet and records which memory IDs influenced the generation.

### Context packet

```ts
type MemoryContextItem = {
  memoryId: string;
  sourceUri: string;
  title: string;
  excerpt: string;
  verificationStatus: "unverified" | "verified";
  updatedAt: string;
  relevanceScore: number;
};

type MemoryContextPacket = {
  queryId: string;
  policyVersion: string;
  items: MemoryContextItem[];
  totalEstimatedTokens: number;
};
```

The generation record should store `queryId`, selected memory IDs, retrieval policy version, and model/prompt policy versions. This makes later quality claims reproducible.

## Obsidian local-first access

Obsidian vaults normally live on a user's machine, while deployed services do not. The safe architecture is an opt-in **local companion CLI/process**:

```text
Local vault
  -> local scanner
  -> allowlisted paths and extensions
  -> frontmatter/privacy filters
  -> local secret scan
  -> hash-based incremental changes
  -> authenticated HTTPS sync of approved text + provenance
  -> Project Service memory module
```

Required controls:

- User selects the vault root and included folders; default is deny.
- Resolve canonical paths and reject symlinks/path traversal outside the selected root.
- Support `.md` first; ignore attachments and hidden/config folders by default.
- Allow frontmatter such as `agentforge: exclude` and restricted tags.
- Never upload `.env`, credentials, key files, or content matching secret rules.
- Use content hashes for incremental updates and propagate deletions/tombstones.
- Preview the exact files and bytes before first sync.
- Provide disconnect and delete-indexed-data operations.
- Store source as a vault-relative logical URI, not an absolute local path.

Direct remote filesystem access and a server-side hardcoded vault path are explicitly rejected.

## MCP boundary

MCP can be added after the memory API and policy are stable.

### Possible future server tools

- `search_engineering_memory(projectId, query, filters)`
- `read_engineering_memory(memoryId)`
- `list_project_decisions(projectId)`

### Policy requirements

- Tool calls inherit the authenticated user and allowed project set; model-supplied owner IDs are never trusted.
- Search returns bounded excerpts; full reads require a second authorized tool call.
- Writes are excluded from the first MCP release.
- Every tool call records actor, project, tool, arguments hash, returned record IDs, duration, and outcome.
- External MCP servers are untrusted integrations: use an allowlist, isolated credentials, timeouts, response-size limits, and explicit confirmation for mutations.

MCP transport choices should be made from the then-current SDK documentation during M8, not frozen in this pre-implementation design.

## Privacy and security model

| Threat | Required control |
|---|---|
| Cross-tenant retrieval | Owner/project filters in repository queries plus authorization tests. |
| Prompt injection inside notes | Label memory as untrusted context, separate it from system instructions, and never allow note text to grant tools/permissions. |
| Secret ingestion | File denylist, secret scanning, restricted classification, and redaction before persistence/logging. |
| Stale guidance | Validity dates, verification state, supersession links, freshness ranking, and visible provenance. |
| Excess context / cost | Per-query item, byte, and token budgets with deterministic truncation. |
| Deletion not honored | Tombstones plus deletion from lexical and vector indexes, verified by tests. |
| Embedding data leakage | Explicit provider policy, tenant isolation, no secret-bearing chunks, and recorded embedding model/version. |

## Evaluation design

Memory must earn its complexity through a repeatable offline evaluation.

### Fixture set

Create a versioned set of project questions and coding tasks with:

- approved relevant record IDs;
- distractor, stale, superseded, and cross-project records;
- expected citations/provenance;
- a deterministic repository state and validation command;
- privacy cases where a record must never be retrieved.

### Retrieval metrics

- Recall@k for approved evidence.
- Mean Reciprocal Rank for the first useful record.
- Precision@k to control distracting context.
- Stale/superseded retrieval rate.
- Cross-tenant and restricted-record leakage rate; required value is zero.
- Retrieval latency and context-token count.

### End-task comparison

Run the same tasks with the same model, prompt policy, temperature, repository state, and token budget in three modes:

1. No memory.
2. Lexical/metadata memory.
3. Hybrid/vector memory, only after it exists.

Measure build/test success, task-specific assertions, unsupported-claim rate, user correction count, total tokens, latency, and estimated provider cost. Adopt embeddings/vector search only if they produce a meaningful quality gain without violating privacy or the budget target.

## Rollout gates

### M6a — Deterministic memory

- Manual/verified sources only.
- MongoDB records plus indexed metadata/text search.
- Owner/project authorization, provenance, freshness, and evaluation harness.

### M6b — Semantic retrieval experiment

- Offline embedding index behind an interface and feature flag.
- No default production use until evaluation beats the lexical baseline.

### M7 — Obsidian connector

- Local companion, preview, allow/deny policy, incremental sync, and deletion controls.

### M8 — MCP exposure

- Read-only memory tools first, after auth and audit policy review.

## Non-goals for the current milestone

M0 does not add schemas, indexes, dependencies, embeddings, a vector store, Obsidian access, MCP packages, or runtime endpoints. This document defines the future boundary so those features are not added prematurely or to the wrong service.
