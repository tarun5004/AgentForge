# AgentForge — applied AI portfolio delivery contract

## Stabilization priority — 2026-10-25

This user-requested revision takes priority over adding portfolio features below. The goal is a small,
working local conversational coding workspace, not another framework or a full VS Code/Codex clone.
Existing dated implementation notes remain historical evidence, not current live verification.

### Target behavior

- One persistent composer and transcript. Typing never disappears after creating a draft or receiving an error.
- The same configured model handles conversation, planning, essential clarification and frontend generation.
  A greeting or planning question must not create a Project, call the generation endpoint, or start Preview.
- Keep short recent conversation context plus the explicitly selected saved revision when relevant. Explain
  context bounds; never silently claim unlimited memory or send service credentials to the model.
- Match the supplied VS Code sidebar reference: compact header, plain assistant prose, expandable observed
  activity, bottom changes summary and rounded composer. Keep code/Preview accessible without fake controls.
- Explicit build/edit requests may use the existing generation API. The old Brief/confirmation APIs and saved
  records remain compatible; replacing their visible questionnaire does not authorize deleting historical data.
- Conversational responses do not authorize arbitrary commands, package installs, provider changes or execution.
  Preview remains the existing restricted frontend build, not a host shell.

### Small delivery slices

| Slice | Scope and smallest change | Evidence required before calling it done |
| --- | --- | --- |
| S1: reconnect | AI/Project defaults and examples use port 6001; reject Fetch-blocked 6000 at startup; update local overrides. | Config regression tests, Node health, authenticated invalid input rejected before any model call. |
| S2: simplify UI | Remove unconnected sample terminal and unused demo data; then persistent composer, one error surface, compact history/activity. Keep real editor, revisions and Preview. | Frontend tests/lint/build plus desktop/mobile screenshots and failure/input-preservation browser checks. |
| S3: conversation contract | One bounded authenticated conversation API through Project to AI, reusing the existing owner JWT/internal token and model selector. Return reply/clarify/build intent plus user-visible text. No extra classifier model, service, queue or vector database. | Mock-provider and HTTP tests: greetings, planning-only, explicit build, follow-up context, invalid input, unauthorized/foreign IDs, timeout; no silent retry/fallback. |
| S4: connect chat to generation | Feed natural-language answers into the same transcript. Create a Project only when code generation is requested. Use the existing immutable publication, saved-base editing and retry key. Retire the form from the new chat path only after equivalent behavior works. | Real API/Mongo tests and browser tests showing no writes for a greeting/plan; v1, failure preservation, selected-base v2, refresh, Preview. |
| S5: prove and trim | Inspect remaining imports/callers; delete only confirmed unused code. One explicitly budget-approved live run after deterministic checks pass. | Clearly separate mock UI, real database, real Docker and real provider evidence; record every unrun/failed check. |

S1-S4 are now implemented and delivered in service-scoped PRs #28-#33. The persistent composer,
conversation endpoint and natural-language routing replace the visible questionnaire for new chat.
S5 is verified for this conversational-core scope: the real provider generated v1 and a targeted v2,
both passed actual candidate/Preview builds and browser counter/refresh checks. Full evidence, failed
attempts, cost assumptions and remaining advanced backlog are in [the delivery report](LOCAL_WORKSPACE_DELIVERY.md).
PR #34 and focused follow-ups add opt-in bounded live verification, not an automatic spending loop.
The user explicitly authorized focused commits, pushes and merges for this delivery. No data migration
or new application dependency was needed for conversation, retrieval or evaluation.

### Current advanced-concept boundary

- Implemented: typed model output, direct Google/Gateway model boundary, bounded selected-file context,
  a real read-only frontend skill tool, reviewed local retrieval, optional semantic embeddings, an 18-case
  routing evaluation set, observable usage/latency/source reports, immutable history and restricted Preview.
- Default retrieval is TF-IDF/cosine, not neural embeddings. The optional semantic mode uses Google
  embeddings and an in-memory index of six reviewed public guidance snippets, not a persistent vector DB.
- Still a separate learning backlog: streaming, Python/SQLite reports, private-project ingestion,
  read-only MCP, held-out multi-model comparisons, durable queue/restart recovery and optional AI repair.
  They are not required to claim the local conversational core works, and are not marked complete.
- No full Cursor clone, arbitrary terminal, public multi-tenant sandbox or Kubernetes deployment claim.

The dated A-F roadmap below is retained as the broader learning plan. Its old mandatory brief-confirmation
UI is superseded by this explicit-intent conversation flow; preserved legacy APIs/data are not deleted.

Why keep the existing services? The demonstrated failure was a blocked HTTP port plus UI state/routing,
not evidence that a rewrite is necessary. Ownership checks, bounded input, immutable revisions, safe file
validation and duplicate-request protection solve actual failure cases and are not cleanup targets.

---

**Reviewed:** 2026-10-23. **Baseline:** clean `main` at `ab783d1` before this slice.

**Delivery update (2026-10-23):** A1 merged through [PR #24](https://github.com/tarun5004/AgentForge/pull/24); A2 commit `daff40b` merged through [PR #25](https://github.com/tarun5004/AgentForge/pull/25), main `bc02ecc`. A3 is on separate `feature/frontend-requirement-dialogue`; verification/delivery status is below. A4 paid-provider smoke is not complete. A2 evidence: 34 unit, 18 new brief HTTP/Mongo, 40 legacy integration and 5 deterministic gate tests passed; real Docker gate case skipped, Project typecheck/build and Execution build passed. No paid calls or application-database writes. [Contracts/setup/limits](../project-service/README.md#saved-requirements-and-confirmation-a2).

This is the authoritative feature-priority plan for the clarified **live local AI workspace** goal. It supersedes the fixture-first completion target and sequencing in older roadmap sections, not their historical test evidence. The user asked for a retrospective, fresher-market check and implementation. This turn starts only the compatible AI Service requirement-assessment slice; later rows are not claims of completion or permission for spending/new infrastructure.

## 1. Product and decision rules

One coherent workflow: **request → clarify missing requirements → review/confirm brief → live generation → safe local build/preview → targeted follow-up**. The application runs on the laptop; the configured remote model need not. Real model credentials/authentication, output quality and complete provider-to-preview behavior must eventually be demonstrated, with an explicitly approved test budget. Fixtures remain automated tests, never a substitute for that product outcome.

- Target transferable applied-AI/agent/full-stack skills, not every AI job or a full Cursor clone. No promise of job eligibility, stronger-model equivalence or production readiness.
- Keep four current service boundaries and readable TypeScript. Use Python for meaningful evaluation/data work, not a language-only rewrite or fifth service by default.
- Every addition needs: **problem → smallest working feature → why/alternative → measurable evidence → known limitation**. A package installation is not a skill demonstration.
- Lock outcomes/order below. Revisit scope only for a demonstrated failed acceptance test, security/cost constraint, API incompatibility or explicit user change. Current model/package versions still need verification at implementation time; that is maintenance, not another product redesign.
- No automatic paid fallback/repair, public execution, paid hosting or account changes. Existing account caps are not authorization for test calls. Local execution restrictions and owner separation remain required.

## 2. Market sample — not a universal hiring checklist

Four primary employer/ATS pages were read on 2026-10-23. This small convenience sample spans internships and 0–2-year roles; it is not a survey or proof of market-wide frequency. A page existing does not guarantee its vacancy is still open. Senior roles from earlier discussions are not used as the fresher baseline.

| Source and level | Relevant signals, paraphrased | Scope implication |
| --- | --- | --- |
| [Noise — Fullstack & AI Innovation Intern](https://gonoise.freshteam.com/jobs/Je49MCLbHI26/intern-fullstack-ai-innovation-iit-nit-bits-etc), 6 months | Hands-on projects, programming, APIs, full-stack work, GenAI/RAG, Git/Docker and curiosity; listed technologies are preferred exposure, not a requirement to master everything. | Demonstrate a finished integration and explain its design. Noise is one sample, not our product specification. |
| [ShyftLabs — AI Engineer Intern](https://jobs.lever.co/shyftlabs/4f389ea7-9b98-4ed0-99c2-b25ea8cc2dcd), Toronto | Python, ML/NLP/LLM basics, an actual agentic application, structured output, retrieval, tools, memory, guardrails, evaluation and traceability. | Strong match for a measured coding-assistant workflow; distinguish required familiarity from the broad contribution list. |
| [Influcraft — Agentic AI Engineer](https://influcraft.com/careers), remote internship, 0–1 years | Reliable agentic systems, RAG, Python and backend/agent frameworks appear in the role. | Show useful tools and retrieval, not merely an API wrapper. Framework names do not justify replacing our existing SDK. |
| [Tek Leaders — AI Engineer / AI Executive](https://tekleaders.com/jobs/ai-engineer-ai-executive-entry-level/), 0–2 years, **expired notice** | Python/SQL/algorithms, data, AI/ML familiarity, LLM/RAG exposure, APIs and communication. | Add meaningful Python/data/evaluation practice. This is dated requirement evidence, not an active application recommendation. |

**Conclusion/inference:** a useful LLM application plus demonstrable programming, retrieval, testing and failure analysis is a defensible portfolio direction. This sample does not establish that every fresher needs MCP, fine-tuning, multiple agents, GraphQL or every cloud. Traditional ML/research roles additionally require training/statistics/data expertise that this app alone cannot establish.

## 3. Retrospective: reuse, close gaps, avoid adding machinery

| Keep/reuse | Verified gap or limitation | Decision |
| --- | --- | --- |
| Auth, owner-scoped Project/revision reads, immutable publication, same-key recovery | Requirement conversation/confirmed brief are absent; UI currently submits straight to generation. | Add a pre-generation dialogue. Do not rewrite ownership or revision history. |
| Existing Gateway `generateText` + structured file output | Real provider quality/end-to-end success is not proven by fixture tests; generation currently inherits SDK retry defaults. | Reuse the SDK/model configuration. Add explicit limits to the new endpoint; audit existing generation limits separately rather than changing them silently. |
| Actual Execution candidate checks, local restricted builds, static iframe Preview | Build gate is opt-in; worker state/artifacts are in memory; no arbitrary full-stack app runtime or live terminal. | Preserve the local frontend scope. Surface truthful capabilities; don't describe Docker export as Kubernetes or general-purpose isolation. |
| Deterministic tests and labelled demo composition | Fixture mode has fixed AI output and bypasses AI Orchestrator runtime. | Keep for repeatable testing. Make the actual product's normal mode live AI; do not present fixed responses as final functionality. |
| Existing Express/Next/SDK stack | No runtime RAG/vector store, model-controlled tools, MCP, Python evaluation pipeline or CI workflow found in reviewed paths. | Deliver features in order below; don't add LangChain/LangGraph/eve just to list frameworks. |
| Local restriction and input validation | Fresh npm audit reports 11 findings: 2 critical, 8 high, 1 moderate, including direct Next and transitive proxy-addr findings. | Separate scoped dependency triage/patch branches; no broad `npm audit fix`. Advisory counts include dependency chains and do not prove application exploitability. No public exposure. |

The 2026-10-10 M0 audit is historical; its claims that execution/history/tests are missing are not current. See the dated addendum in [CURRENT_IMPLEMENTATION_AUDIT.md](CURRENT_IMPLEMENTATION_AUDIT.md).

## 4. Stable feature/skill acceptance map

All rows below are **targets unless a status explicitly says partial/implemented**. Each needs a small working example and an honest interview explanation.

| Capability | Small useful implementation | Evidence required |
| --- | --- | --- |
| LLM + prompt engineering + structured output | Ask essential missing questions, return a bounded reviewable brief; skip questions for a complete request. | Sparse vs complete vs unsupported cases; contract rejects malformed model output. Actual model behavior tested separately from mock output. |
| Conversation/context engineering | Persist owned answers/brief, include only current task and relevant selected files; require explicit generation confirmation. | Refresh restores answers; already supplied facts reach the model; answer changes invalidate prior confirmation; no cross-owner access. |
| Streaming and state | Stream real assistant content/events with cancellation and clear preparing/building states. | Interrupted stream has a recoverable state; never stream raw secrets, fabricated logs or hidden chain-of-thought. |
| RAG + embeddings + vector database | Ingest selected non-secret project notes/approved examples; compare lexical retrieval with semantic search in one local vector store. | Source/chunk IDs, owner filter before ranking, stale-content invalidation, no-match behavior, citation accuracy and Recall@3 on a labelled set. A vector result alone is not grounded generation. |
| Tool calling / harness | Model can request a small allowlist: read owned file, search docs, request bounded build. Changes still use validated proposals/confirmation. | Typed arguments, tool result trace, denied foreign IDs/actions, step/time/call limits. Existing server-triggered builds are not retrospectively called model tool calls. |
| Python + data handling + SQL | Offline evaluation/ingestion tooling reads versioned JSONL fixtures, computes metrics and stores comparable run reports in local SQLite. | Real Python tests, reproducible SQL queries comparing runs, dataset/version provenance; do not claim this alone proves Python backend/model-training expertise. |
| Evals + ML/NLP fundamentals | Small labelled task/retrieval datasets with separate development and held-out cases; deterministic validators plus human review. | Requirement coverage, valid-output rate, build-pass rate, retrieval metrics, false positives, latency and sample size; no fabricated scores or accuracy guarantees. |
| Provider abstraction + cost engineering | Explicitly compare two server-configured models through the existing Gateway boundary; bounded tokens/retries, same task set. | Application-owned selection/contract tests, real selected-model metadata when authorized, measured trade-offs. Do not claim we wrote Gateway's provider adapters. |
| Observability + safety | Safe attempt/step IDs, latency/usage and failure classification; dependency/source/secret diagnostics and prompt-injection tests. | Trace a failure without prompts/secrets in logs; policy rejection preserves good revisions. Scanners have limitations; regex cannot certify security. |
| Bounded repair | Optional one repair using redacted compile diagnostics, then independent revalidation. | Opt-in + call/token caps + no loop; failed repair keeps last successful revision. No automatic paid calls without approval. |
| Durable workflow concepts | Saved job state, stable idempotency, cancellation and restart reconciliation; choose transport only when accepted. | Actual worker kill/restart and duplicate-delivery tests. No JWTs stored in durable jobs; authorization design requires explicit review. |
| MCP | Expose one scoped read-only project-doc search tool through the same permissions. | A compatible client invokes it; denied scope and audit tests. MCP is not the RAG database or a reason for arbitrary filesystem access. |
| Software engineering + DevOps | Focused branches, local Compose/setup, service contracts, unit/HTTP/Mongo/browser tests and CI. | Fresh-machine walkthrough; dependency/security reports; ordinary PR checks pass. Document cloud architecture without buying/running it. |

**RAG infrastructure boundary:** one local vector store only, opt-in when that phase starts; CPU embeddings where practical. Measure the laptop footprint and validate licensing/model availability before pinning packages. Do not add a paid embedding account, a second database platform or a new Python HTTP service silently. A single text-model API key does not inherently provide embeddings.

**Separate learning backlog, not blockers:** a small classical-ML project-type classifier with held-out evaluation, LoRA/fine-tuning with suitable licensed data/hardware, hybrid retrieval/reranking, a constrained reviewer agent, screenshot understanding, Obsidian connector. Training huge models, multiple clouds, mobile apps, multi-agent swarms and public Kubernetes are not required for this release. Optional work needs a useful experiment, baseline and resource budget—not a checkbox implementation.

## 5. Delivery order and service-scoped slices

| Phase | Ordered deliverables | Exit criterion |
| --- | --- | --- |
| A. Real conversational core | **A1 AI Service:** internal assessment endpoint/schema/prompt/no-spend tests. **A2 Project:** owned persisted brief/answers, concurrency/request identity and confirm transition. **A3 frontend:** dialogue, brief review/Generate control, real error/loading/reload states. **A4:** explicitly budgeted live model → saved revision → local Preview smoke. | Vague request asks relevant questions; complete request does not force questions; confirmed brief drives actual generation. Live behavior is not marked complete until A4 succeeds. |
| B. Evidence and diagnostics | Scoped critical-dependency triage before broader use; Python/SQLite evaluation CLI, a small versioned dataset, safe traces, token/retry policy and real streaming. | Reproduce baseline results; explain an actual failure and one measured improvement. Evals grow with every later phase. |
| C. Grounded project knowledge | Safe ingestion/lexical baseline → local embeddings/vector index → scoped retrieval/citations → generation comparison. | Held-out retrieval report, no-cross-owner/deletion tests and measured comparison against no RAG/lexical baseline. |
| D. Controlled actions and recovery | Model tool allowlist/step limits → optional bounded repair → durable job/cancel contract and crash tests. | Clear permissions and budgets, no silent revision overwrite, cancellation and restart evidence. Security/auth/paid-repair policy reviewed before implementation. |
| E. Interoperability | Explicit second-model comparison through Gateway → one read-only MCP tool. | Same contract/task set across models; actual MCP integration and denial tests; no automatic expensive fallback. |
| F. Portfolio release | Fresh-machine local setup, CI, useful docs/architecture/Q&A, honest recording and optional static showcase. | Recruiter can reproduce the real workflow with documented prerequisites and an API connection, and see what is/is not verified. No cloud deployment required. |

Critical dependency findings are a **parallel priority for separate service branches**, not deferred until public release. No new user-facing execution capability should weaken the current restricted local boundary while they are unresolved.

Default Git delivery is one service's compatible slice at a time. No commits/push/PR/merge are inferred from this turn's implementation request. Finish or preserve A1 before branching for A2; dependency merges or a declared stacked strategy are needed, never silently mixed PRs.

## 6. A1 implementation contract (merged AI slice)

- `POST /internal/requirements` uses the existing `x-internal-service-token`; browsers never receive that token or call this internal route directly. Project Service remains responsible for JWT ownership and loading saved answers.
- Request: `{ requestId, projectId, prompt, answers?: [{ question, answer }] }`. Strict unknown-field rejection; prompt 10–1000 characters; up to six answer pairs (question 240, answer 1000 characters); 20,000 serialized UTF-8 bytes. IDs are correlation context, not ownership proof.
- Response: `{ assessment: { requestId, status, message, brief, questions, policyVersion, model, usage, latencyMs } }`. Status is `needs_clarification`, `ready` or `unsupported`; at most three distinct new questions; brief 10–1000 characters. `ready` means ready for **user review**, never authorization to generate.
- One SDK call per HTTP attempt, output cap 1500 tokens, total timeout 45 seconds, SDK retries zero, no tools, no output repair or application fallback. This is not a hard dollar cap or a guarantee about Gateway's internal provider attempts. Repeating HTTP requests may spend again; A1 provides no persistence/idempotency.
- Errors retain existing conventions: missing internal token 401; invalid input/JSON 400; excessive context/parser body 413; provider/invalid model output 502. Invalid model output is not classified as the user's Zod 400. Errors/logs never expose answer contents, raw provider errors or credentials.
- The endpoint does not save data, generate files, change the current generation API or prove real-model quality. Schema/HTTP tests use the SDK mock provider and reject non-loopback fetches. No fake provider mode is added to production.
- Limitations: exact normalized repeat-question checks do not detect all paraphrases; prompt instructions cannot guarantee facts are not hallucinated. Timeout does not guarantee a submitted provider call stops billing. Human brief review and later evals are necessary.

**A2 implemented checkpoint:** Project stores owned cumulative answers/assessments in versioned records, reserves unique version/key before AI, fingerprints requests, and separates ready from confirmation. Latest-version checks and conditional writes handle races/abandonment; uncertain outcomes never trigger automatic paid retry. The additive initial-generation route forwards only stored approved brief text (10–1000 characters). Legacy direct/follow-up generation remains unchanged and is not globally gated. No transcript engine, base auto-selection, background recovery or new dependency is included. See ADR-009 and the public API contract.

**A3 scope:** frontend-only dialogue branched from merged A2 main. Restore saved brief after auth, preserve one submission key, render questions/answers/uncertainty, review/Confirm/Generate controls, and use the new confirmed-brief endpoint for initial generation. Keep existing explicit-base follow-ups and generation polling/replay. Prove loading/empty/error/refresh and no-extra-call behavior with fixtures before separately approved A4 live testing.

**A3 implementation:** frontend now implements that initial dialogue/consent flow; no SDK/provider/secret enters the browser. Saved drafts restore via owner-scoped reads, assessment intent retains its original key/body, and approved-brief generation preserves the brief ID on replay. Existing selected-base follow-ups stay unchanged. Browser-driven verification found and fixed an initial-route transition resetting answer fields while leaving a stale snapshot marker. Existing test compositions were adapted to the new initial route and scoped Brief cleanup; this is test infrastructure, not a fake production provider. See [frontend setup/evidence](../nextjs-boilerplate/README.md#a3-requirements-before-initial-generation--2026-10-23). The user explicitly approved A3 commit/push/PR/merge delivery after verification.

**A3 evidence:** 40 frontend unit tests, lint/build, 8 launcher/12 native-command/4 cleanup checks; requirements/session/pending/access browser suites; real Auth/Project/Mongo loop 5/5, recovery 7/7 and state 9/9 with scoped cleanup. Recovery proved failed-follow-up preservation and same-key reconciliation after lost success; state proved responsive request identity, GET-only status recovery and stale-response isolation. Ignored reports: `output/playwright/verification-1792769299142.json` (recovery), `output/playwright/verification-1792769452247.json` (state). Both dedicated databases independently had zero fixture records, and the owned temporary Mongo container was removed. AI was deterministic transport; no real model or generated-code Docker execution in this verification. Preview/build-gate browser adapters were updated but not rerun. After A3 Git delivery, the next boundary is separately budget-approved A4 provider-to-preview smoke; B–F are not automatically authorized by A3 completion.

## 7. Learning and completion policy

For each slice, keep a short Q&A: what problem occurred, input/output path, chosen technique, simpler alternative, one failure, actual test evidence and remaining gap. AI assistance is disclosed honestly. Do not rewrite the whole roadmap each turn; update row status/evidence. Changes to acceptance/scope need a short reason in the decision log.

Current evidence is recorded in the dated audit addendum and service READMEs. A1: **39/39** service tests (13 new), typecheck/build passed and PR #24 merged. A2 merged in PR #25. A3 implements/tests the conversational UI with fixtures; its focused Git delivery is explicitly approved. This is **not** live-provider quality evidence or the full AI-engineering portfolio. A4 and B–F remain open.
