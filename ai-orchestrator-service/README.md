# AI Orchestrator Service

This service receives authenticated internal generation requests from Project Service, calls the configured model through Vercel AI Gateway or directly through Google, and validates a constrained Next.js frontend manifest. Project Service owns saved revisions; this service does not write Project data or execute generated code.

Generation guidance explicitly covers interactive `'use client'` entry points, server root layouts,
strict TypeScript and typed inline styles (plain CSS is preferred). The SDK contract test verifies these
rules reach the actual model call. This improves guidance; it is not proof that every model output
compiles. Only Execution's real build can supply that evidence; no automatic paid repair is enabled.
Small requests stay small, while website requests should match the requested pages and interactions.
Reuse the trusted root layout. A captured live candidate imported
Next's `Metadata` type from React and failed strict compilation. Guidance names the correct module and
avoids generating optional root-layout boilerplate unless requested; it does not bypass the build gate.

## Simplification status — 2026-10-29

Project Service still uses `POST /internal/generations` and receives the same validated manifest.
The connected generator now reads fixed skill guidance locally, requests a short plan, then requests
one complete file at a time. It returns nothing successful until all planned files pass the manifest
policy. Repair reuses the same frontend rules but remains a separate explicit one-attempt operation.
Conversation SSE is a different workflow: it streams replies, not generated code files.

The unmerged `POST /internal/generations/stream` experiment and its four source/test files were
removed after a repository-wide caller search found no Project/frontend integration. An exact,
ignored local backup is under `output/cleanup-backups/20261029-ai-incremental/`; it is not part of
a clone or a supported API. Existing generation, repair, conversation and requirements routes remain.

**Live verification pending:** the previous real-model portfolio attempt exhausted the old
8,000-token whole-manifest cap, producing no accepted revision or build. The new plan/file workflow
removes that single-response dependency, but has only offline SDK/adapter verification so far.
It does not establish website quality, make truncation impossible, or prove lower cost. No live
provider call is authorized by the recovery test plan; agree a separate small budget first.

Limits: one plan (1,000 output tokens) plus at most six files (3,000 output tokens each), zero SDK
retries, one shared 80-second deadline within Project's unchanged 90-second HTTP timeout. Snapshot
limits remain 12 files / 120,000 source characters / 30,000 characters per file, with escaped context
checked before every call. Deletion-only follow-ups need only the plan. Plans must retain a homepage;
unsafe/duplicate/conflicting paths fail before file calls. A mismatched path, failed/truncated step
or invalid final snapshot returns no successful partial manifest. The maximum output allocation is
19,000 tokens versus the former 8,256; repeated input also costs tokens. This is not a hard dollar
cap, and seven calls may be slower or more expensive than two. The browser still receives accepted
files after the JSON request finishes; no live code-progress stream is claimed in this slice.

## Conversation streaming — AI backend slice (2026-10-26)

### Reproducible evaluation reports (2026-10-27)

The existing 18 reviewed routing cases now produce versioned reports with case/prompt SHA-256 hashes,
per-case grades, measured total latency, stream first-text latency, nearest-rank p50/p95, model IDs and
known token totals. Missing usage stays null and incomplete cases are counted. These are routing/
contract evaluations, not compilation, visual quality, a held-out benchmark or invoice verification.
Existing real Docker/browser checks remain separate evidence; no LLM judges itself as correct.

```powershell
# Zero calls and no credential/config import: list the reviewed cases.
npm --workspace ai-orchestrator-service run eval:conversation
# Explicit provider/quota usage: at most two reviewed cases here; no retries on failure.
npm --workspace ai-orchestrator-service run eval:conversation -- --live --stream --limit=2 --case=greeting,portfolio-plan --report=after.json
# Zero inference: compare existing reports on identical cases, prompt, mode and transport.
npm --workspace ai-orchestrator-service run eval:conversation -- --compare=before.json,after.json
```

Reports are created only under ignored root `output/evaluations/`, with a simple `.json` filename;
existing files are never overwritten. Comparison validates rows and recomputes summaries rather than
trusting saved pass rates. A changed case/prompt/transport or incomplete batch cannot silently become
a like-for-like model comparison. Reports contain grades/metrics, not conversation text or credentials.
Default and offline comparison modes do not import provider configuration. Live calls still require
available account quota and an explicit `--live`; this helper does not impose an account dollar cap.
Verified with 103/103 AI tests, typecheck and build. Six reporting checks cover metrics, unknown values,
comparison compatibility, CLI admission and a real credential-free dry run. No live evaluation was run.

`POST /internal/conversations/stream` is additive: the existing JSON route remains unchanged.
It takes the same validated request and internal-service token. This slice does **not** yet change
Project's public transport, persist chat history or connect the browser to streaming.

The installed AI SDK's `streamText` + `Output.object` yields real partially parsed model output.
Only the `message` field is sent provisionally; `action` and `prompt` cannot trigger work until the
complete structured response passes the same cross-field validator as the JSON endpoint.

SSE frames use `event: <name>`, `data: <JSON>` and a blank line:

| Event | Data | Consumer rule |
| --- | --- | --- |
| `start` | `{requestId}` | Correlate this request. |
| `message` | `{message}` | Replace provisional display text; do not append this cumulative snapshot. |
| `complete` | `{response}` | Accept the final validated response, with decision and metadata. |
| `error` | `{code,message}` | Mark interrupted; never build from partial output. |

There are at most 64 provisional snapshots of at most 4,000 characters and one final response.
This bounds transport size; not every model token creates a browser event. Newlines in model text
are JSON-escaped so they cannot inject SSE events. Headers disable cache/transformation and request
proxy buffering. Writes respect backpressure. Disconnect and the shared 45-second deadline cancel
the upstream SDK signal; cancellation is best-effort, not a promise of zero provider billing.
There is still one bounded model attempt, 2,000 output tokens, zero SDK retries and no repair/fallback.
Invalid requests return JSON 400/413 and missing authentication returns 401 before streaming starts.
After headers, a failure is a sanitized SSE `error`, not an HTTP status change or a fake completion.

Validation: **97/97** AI tests passed, including nine new streaming cases; typecheck and build passed.
The SDK fixtures prove partial JSON parsing and safe final validation; real loopback HTTP checks prove
early delivery, authentication, framing, sanitized errors and disconnect cancellation. These tests block
external provider requests. No live-model, Project-relay or browser-streaming success is claimed here.

See [the four-feature design and delivery order](../docs/AI_ENGINEERING_ROADMAP.md#conversation-reliability-extension--2026-10-26).

## Conversation, local retrieval and evaluations — 2026-10-25

`POST /internal/conversations` uses the existing `x-internal-service-token`. Project Service, not the browser, calls it. Existing generation/requirements routes remain compatible.

```json
{
  "requestId": "turn-1",
  "messages": [{ "role": "user", "content": "Hi! How should we plan my portfolio?" }]
}
```

- Strict request: 1–16 user/assistant messages, final message from user, each 1–4,000 characters, serialized message context at most 16,000 UTF-8 bytes. Optional `baseRevision: {id, files}` comes from Project's owned persisted snapshot; it shares generation's safe-path/file/120,000-character limits and the whole request has a 240,000-byte cap. No arbitrary system roles, provider settings, secrets or shell tools are accepted.
- One configured model returns `{response: {requestId, action, message, prompt, sources, retrieval, model, usage, latencyMs}}`. `action` is `reply`, `clarify` or `build`; `prompt` is null except for a build (10–1,000 characters). Greetings and planning should reply without generation. An explicit build/edit request creates a compact self-contained change prompt. At most one combined essential question is requested; delegated placeholders must be labelled, not invented personal facts. These are model instructions, not a guarantee of perfect intent classification.
- There is one conversation model call, output at most 2,000 tokens, no retry/fallback and a 45-second overall abort budget including retrieval. This call does not write files or execute code. Project owns publication; Execution owns build/Preview. Missing usage is null, not a fabricated zero. Error responses do not expose provider payloads or credentials.
- `frontend-knowledge.ts` holds six reviewed, repository-owned guidance passages: portfolio honesty, accessibility, responsive layout, React interaction, minimal edits and runtime limits. Retrieval injects at most two ranked passages into the model context. `sources: [{id,title}]` lists the exact passages supplied, not a claim that every passage was cited or followed. The file-generation workflow also receives relevant **lexical** guidance without changing its existing response contract or adding embedding calls.
- Default `RAG_RETRIEVAL_MODE=lexical` builds sparse TF-IDF vectors and ranks cosine similarity entirely locally: no embedding API bill and no neural-semantic claim. It cannot match every paraphrase or search the web. This small local corpus is not a general project-code search engine.
- Optional `RAG_RETRIEVAL_MODE=semantic` requires `RAG_EMBEDDING_MODEL` (a current Google embedding ID you verify for your account) and `GOOGLE_GENERATIVE_AI_API_KEY`, even if the chat model uses Gateway. The existing official Google SDK and `embedMany`/`embed` create a small in-memory vector index. Six reviewed documents are embedded once per process/model/key; each conversation query is embedded once, with retries disabled and the shared timeout. Only the recent user query, not base file contents, is sent to the embedding provider. Restart rebuilds the index. This is a local vector index, **not** a separately deployed vector database. Semantic failures stop the request, never silently fall back or switch paid providers. This mode can incur embedding costs and is OFF by default.
- `retrieval: {method, embeddingModel, inputTokens}` exposes actual retrieval mode and separately reported embedding tokens. Chat `usage` excludes embeddings; no dollar estimate is invented. Concurrent initial requests share the same corpus-index promise; the request that starts it accounts for its reported corpus tokens.

Small file map: `conversation.schema.ts` validates; `conversation.service.ts` makes the one bounded decision call; `conversation.controller.ts` handles HTTP; `frontend-knowledge.ts` is the reviewed corpus/lexical search; `retrieval.ts` is opt-in embeddings/cosine search; `conversation.evaluation.ts` contains 18 reviewed behavior cases and simple graders. No new dependency or agent framework was added.

```powershell
# Free SDK/HTTP fixtures: tests include 18 mocked evaluation-pipeline cases, not model-quality proof.
npm --workspace ai-orchestrator-service test
# List reviewed cases; no credentials, model calls or running server required.
npm --workspace ai-orchestrator-service run eval:conversation
# Explicit live opt-in: default limit 3, maximum 18; may consume provider quota/credits.
npm --workspace ai-orchestrator-service run eval:conversation -- --live --limit=2 --case=greeting,portfolio-plan
```

The live evaluation command reports actual/expected action, model, tokens, retrieval and latency. It stops on the first provider/output failure without retry and returns nonzero for failed graders. Passing these intent/contract checks does not prove visual design, build success, jailbreak immunity or actual Preview behavior; verify those separately. No live request is made by the normal test suite.

## Existing service setup

Use Node 22+ and the repository's root npm workspaces/lockfile. Copy this service's `.env.example` to a local ignored `.env` and configure:

| Variable | Purpose |
| --- | --- |
| `PORT` | Defaults to 6001 for both host development and Compose. Port 6000 is rejected at startup because Node Fetch blocks it. |
| `INTERNAL_SERVICE_TOKEN` | Must match Project Service. Server-side only. |
| `AI_PROVIDER` | `gateway` (backward-compatible default) or `google` (direct Google AI Studio connection). |
| `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | Required only for Gateway mode; never a browser variable. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Required only for direct Google mode. Store in ignored service `.env`, never in the frontend. |
| `AI_MODEL` | Gateway uses `provider/model` IDs, default `google/gemini-2.5-flash`; direct Google uses `gemini-*` IDs, default `gemini-3.5-flash-lite`. Confirm access and pricing before a live request. |

From the repository root:

```powershell
npm --workspace ai-orchestrator-service run dev
```

For a host-only server, use `PORT=6001` and Project `AI_ORCHESTRATOR_URL=http://localhost:6001` in existing local `.env` files, then restart both services. The examples now use those values too. Changing `AI_MODEL` does not change ports or credentials. Health checks do not call a model; the smoke helper requires explicit execution approval.

### Free-credit model selection — 2026-10-23

The configured Gemini 3.7 Flash request returned Gateway 403 `no_providers_available`; a bounded diagnostic captured the actual reason: the free tier does not have access to that model. The example and fallback now use **`google/gemini-2.5-flash`**: the current [model directory](https://vercel.com/ai-gateway/models?freeTier=true&q=gemini-2.5-flash) lists Free AI Gateway Credit eligibility, and the live catalog lists structured-output support and no-training availability across its providers. Model access/capabilities/pricing can change; this is a dated selection, not a permanent guarantee.

Free-credit eligibility is **not zero-priced/unlimited inference**: calls deduct token usage from available Gateway credits. No direct Google key, new adapter or SDK rewrite is needed; both assessment and generation already read `AI_MODEL`. Explicitly configured values still override the fallback. Restart a host process after editing its local `.env`; Compose needs `docker compose up -d --no-deps --force-recreate ai-orchestrator-service` to reload `env_file` (a plain restart retains its old environment). No paid fallback, top-up, budget or account-policy change is part of model selection.

**Executed verification:** 39 service tests, typecheck/build and two fresh-process default/override checks passed. Four actual Gateway calls completed the isolated browser flow: essential questions → supplied answers → saved brief → explicit confirmation → generated v1 → Docker build/interactive iframe → selected-base follow-up v2 → build/Preview → refresh. Reported/account-observed cost **$0.0110388**, below the approved $2 total budget; no automatic retries or repair calls. Normal Compose's **AI service only** was recreated, and its configured model plus health 200 were confirmed; other services/data were not restarted/rebuilt. This does not certify the normal stack's older images as the newly tested source. [Detailed evidence, billing, cleanup and limits](LIVE_VERIFICATION.md).

Routes: free health `GET /_status/healthz`; authenticated `POST /internal/generations` using `x-internal-service-token`. Request fields are `requestId`, `projectId`, `prompt`, `template: nextjs`, `mode: economy`, plus optional server-loaded `baseRevision`. The response is `{ generation }`, including upserts/deletions, model/usage/latency and `manifest_validated` policy metadata. See [the implemented contract](../docs/05_OPENAPI_SPEC.md#implemented-slice-3--internal-context-and-file-change-boundary-2026-10-12).

### One-call repair boundary

`POST /internal/repairs` uses the same internal token. It accepts only `requestId`, `projectId`,
the original `prompt`, exact `failedFiles` (1–12 frontend files), and `diagnostics` (1–8 rows).
Each row contains a known candidate `path` or null, nullable positive `line`/`column` up to 999999,
`category` (`typescript`, `module`, `syntax`, `compile`) and nullable `TS` error `code`.
No raw message, shell command, provider setting or browser transcript is accepted.
Serialized context is capped at 240000 UTF-8 bytes; files use the existing frontend policy.

The service reads the hash-pinned skill locally and makes **one** `generateText` call with no tools,
zero SDK retries, an 8000-output-token cap and an 80-second timeout. Its manifest is independently
validated relative to `failedFiles`; unchanged files are preserved. Response shape matches
`{ generation }` above. Validation is not build proof. There is no fallback, recursive repair,
publication, or attempt store here: Project Service must authorize/reserve one explicit attempt,
retain paid output and run a fresh Execution check before publication. This endpoint alone does
not enable repair in the UI. Tests use SDK mocks/loopback HTTP, not a live provider.

## Direct Google setup — 2026-10-25

For a Google AI Studio key, set these in **this service's ignored `.env`** (preserve the existing internal token):

```dotenv
AI_PROVIDER=google
AI_MODEL=gemini-3.5-flash-lite
GOOGLE_GENERATIVE_AI_API_KEY=replace_with_your_private_key
```

- `createAIModel` is shared by requirement assessment and file generation. `@ai-sdk/google` supplies the official API translation, while the existing SDK tool loop, output schemas, file validation and HTTP contracts stay intact. There is no custom provider framework or extra service.
- Versions **`ai@7.0.153` and `@ai-sdk/google@4.0.105` are pinned together** so both use the same provider interface. A live Google request exposed HTTP 400 when the older adapter combined forced function calling with JSON response mode. The newer adapter handles the tool phase separately and restores structured JSON for the final response; a regression fixture rejects the invalid combination. Updating the compatible pair avoids a custom HTTP/schema workaround or unsafe type casts.
- Google calls go directly to `generativelanguage.googleapis.com`. Gateway keys, balances, budgets and Logs do **not** cover this connection. Response `provider` becomes `google`; `model` uses the native ID. Gateway mode retains its existing response values and OIDC/key authentication.
- No provider fallback or automatic SDK retry is enabled. Quota/auth failures remain failures, never silent paid Gateway calls. Changing `AI_PROVIDER` does not enforce free billing: keep the Google project on **Free** tier and check account/model quotas yourself. Do not add billing just to test.
- [Google's model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) lists function calling and structured output; [current pricing](https://ai.google.dev/gemini-api/docs/pricing) lists a free tier. Account availability and limits can differ. Free-tier data may improve Google products: use synthetic test content, not private files or secrets. Flash-Lite is the direct default because the bounded live test completed generation/build with it; newer Flash models hit provider capacity errors. This is not automatic fallback or a guarantee of future availability.
- Replace/rotate any key exposed in chat/screenshots. Keys are backend-only and must never be printed, committed or put in a `NEXT_PUBLIC_*` variable.

Restart a host process after changing `.env`. For Compose, the new dependency requires an image rebuild, not just an environment reload:

```powershell
docker compose build ai-orchestrator-service
docker compose up -d --no-deps --force-recreate ai-orchestrator-service
```

Review the unmerged clarification fix mentioned below before rebuilding the normal container. This branch does not silently include it. To return to Gateway, set `AI_PROVIDER=gateway`, `AI_MODEL=google/gemini-2.5-flash`, and keep a valid Gateway credential, then recreate/restart again.

Verification: 57 AI tests, service typecheck/build and six Project generation-contract tests pass. Intercepted HTTP tests exercise the **actual Google adapter** for JSON requirements, forced skill selection, thought-signature forwarding, validated file output, summed usage and quota failure without retry/fallback. A later authorized **live Google browser test passed** with `gemini-3.5-flash-lite`: requirements, real skill calls, generated v1, restricted Docker builds, interactive iframe, refresh, targeted v2 and another interactive preview. The successful loop used five provider calls and 9,135 reported tokens. It did not use model-response fixtures. See [live evidence and earlier failures](LIVE_VERIFICATION.md#direct-google-live-loop--2026-10-25). Normal Compose images were not rebuilt or replaced; verification used source-based isolated services and a dedicated test DB. Existing dependency security advisories remain; no unrelated bulk upgrade or audit fix was applied.

Git delivery: `feature/ai-orchestrator-direct-gemini` is stacked on local skills commit `c2a0add`. Skills are committed separately; direct-Google edits remain for review. No push, PR or merge is part of this setup task.

## Frontend design guidance — current workflow

The server loads one reviewed local `frontend-design` skill and checks its SHA-256 pin before
inference. The model does not select it or supply its path. This avoids a paid selection step when
there is only one available skill. It is guidance, not an executable tool or permission expansion.

- Reviewed upstream: [Anthropic frontend-design](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design/SKILL.md).
- Local [SKILL.md](skills/frontend-design/SKILL.md) is a compact modified adaptation; [NOTICE.md](skills/frontend-design/NOTICE.md) records provenance and [LICENSE.txt](skills/frontend-design/LICENSE.txt) preserves Apache-2.0 terms.
- Fixed server-side paths, size limits, line-ending normalization and hash validation prevent arbitrary
  URL/path selection or silently trusting modified instructions. Runtime downloads/installs nothing.
- All plan/file requests receive the reviewed guidance and frontend rules. A single working snapshot
  replaces growing transcripts, preserving the selected base and already received source once.
- The existing Dockerfile copies `skills/` alongside `dist`. Any alternative packaging must do the
  same; missing skill files fail before inference. Typecheck/build alone does not test a new image.

**Interview explanation:** the model proposes paths and writes code; application code enforces the
order, limits and allowed files. Project owns immutable revisions and Execution owns build evidence.
Loading a skill is not proof of good design, compilation, or Preview success.

## Requirement assessment — A1 (2026-10-23)

`POST /internal/requirements` uses the **same internal service token** and the selected provider/model described above. The normal service implementation calls the model; it does not use a canned questionnaire. A2/A3 connect it to owned Project briefs and the browser's separate review/confirmation/generation controls.

```json
{
  "requestId": "brief-1",
  "projectId": "66d123456789abcdef123456",
  "prompt": "Build my portfolio website",
  "answers": []
}
```

Returns `{ assessment }` with `status: needs_clarification | ready | unsupported`, a short `message`, draft `brief`, up to three `questions`, `requestId`, `policyVersion`, model, token usage and latency. Unavailable usage fields are `null`, not a false zero-token claim. Questions should cover essential missing facts rather than repeat supplied answers. `ready` means ready for **human review**, never automatic permission to generate. Unsupported backend functionality is outside the existing frontend-only scope. The endpoint returns no files and executes no code.

- Input is strict: prompt 10–1000 characters; valid project ID; at most six question/answer pairs, question 240 and answer 1000 characters; serialized UTF-8 context at most 20,000 bytes. Unknown identity/model/file/chat fields and duplicate normalized answered questions are rejected.
- Requirement SDK call: at most 1500 output tokens, 45-second total timeout and **zero SDK retries**; no requirement tools, automatic repair or application fallback. Generation separately uses the bounded plan/file workflow above. One HTTP call does not guarantee a hard dollar limit or a single internal Gateway provider attempt. Another POST can spend again; A1 has no idempotency store. A timeout does not prove provider-side cancellation.
- Input/JSON errors: 400; internal authentication: 401; excessive context/body: 413; provider/output errors: sanitized 502. Model-output validation errors never masquerade as invalid user input. Logging does not print answers, briefs, raw provider errors or credentials.
- The internal caller must verify JWT/project ownership and load trusted saved answers. A `projectId` in this body is correlation data, not authorization. Prompt instructions and exact duplicate checks cannot guarantee zero hallucination, prevent all injection or detect paraphrased repeated questions.
- Next slices: Project-owned persisted brief/answer/confirmation state, then conversational UI. Handle the bounded-answer limit visibly (edit/restart the brief rather than force a false ready result). A real provider behavior/quality smoke needs explicit spending approval; no paid request was made for A1.

Run `npm --workspace ai-orchestrator-service run test`, `run typecheck`, and `run build`. The new tests exercise the actual SDK with `MockLanguageModelV4` and real loopback HTTP, while refusing external fetches. They prove contracts, authentication, bounds, usage forwarding, SDK no-retry and error classification—not that a real model reliably asks the right questions. The [delivery contract](../docs/AI_PORTFOLIO_DELIVERY_PLAN.md) and [retrospective](../docs/CURRENT_IMPLEMENTATION_AUDIT.md#current-retrospective-addendum--2026-10-23) track remaining work.

**Executed A1 evidence:** service suite **39/39** (26 existing + 13 requirement tests), typecheck and build passed. New HTTP cases prove 401 before assessment, strict 400/413 without a model invocation, a structured 200 and sanitized model-output 502. SDK tests confirm one call on a retryable error and explicit unknown-usage metadata. No provider call, database write, browser UI test or Compose rebuild was performed; normal UI behavior has not changed yet.

## Safe generation smoke command

The next verification step after the deterministic workspace-to-preview test is checking the actual model boundary. This helper reuses the **running service HTTP API**, not a second provider adapter or a production fake-model mode.

### 1. Default: local validation only

```powershell
npm --workspace ai-orchestrator-service run smoke:generation
npm --workspace ai-orchestrator-service run smoke:generation -- --help
```

Dry-run validates a fixed small frontend request and prints safe request metadata. It makes **zero network requests**, loads no `.env` file, requires no credentials and cannot spend provider credits. It is not a service-health or provider-availability check.

### 2. Actual generation: separate explicit approval

Only after reviewing the configured model, credit/budget settings and retry behavior:

```powershell
# Potentially billable: do not run merely to inspect setup.
npm --workspace ai-orchestrator-service run smoke:generation -- --url http://127.0.0.1:6001 --execute --allow-paid
```

Both flags are mandatory. The CLI loads this service's local `.env` only in execution mode; `INTERNAL_SERVICE_TOKEN` can instead already exist in the process environment. Never pass a literal token as a command-line argument or paste it into chat. Use the actual listener port explicitly. A local server must already be running; the CLI does not start or reconfigure it.

For Compose, the AI port is internal. After deliberately rebuilding that service image to include the new helper, run the dry-run inside its existing container:

```powershell
docker compose exec ai-orchestrator-service npm run smoke:generation -- --url http://127.0.0.1:6001
```

This container command is also a dry-run. Appending `--execute --allow-paid` would be a separate potentially billable action, not performed by setup or tests. No public AI port or new browser proxy is needed.

### Checks, reporting and limits

- Execution checks the local health endpoint's identity, then sends **one generation POST** with a fresh correlation ID. Only exact loopback HTTP origins are accepted; redirects are refused. The CLI never retries.
- Returned JSON is byte-bounded, schema-checked, correlated to this request and independently manifest-validated. Output contains file count, model, usage and latency; not credentials, raw provider errors, prompt text or generated source.
- The 100-second HTTP deadline covers reads as well as connection setup. A submitted request may still run or incur cost after disconnect/timeout. `SUBMITTED_OUTCOME_UNKNOWN` means inspect service/Gateway logs before considering a retry.
- **This is not a hard token or dollar budget for the entire operation.** Generation uses one plan call capped at 1,000 output tokens, then up to six file calls capped at 3,000 each. All use `maxRetries: 0` and share an 80-second deadline. One HTTP POST can contain seven model calls; Gateway routing may add provider attempts. The harness does not inspect/change account budgets, credits, routing or automatic top-ups.
- A successful smoke proves a validated manifest was returned by that service call, not that a revision was saved, built or previewed. It does not certify model quality or application security. Finish provider-to-persistence-to-preview verification separately after explicitly approving a paid run.
- Service errors remain sanitized: `HTTP_401` points to internal authentication; `HTTP_502` is the current generic upstream/output failure, not a diagnosis of insufficient credits or a specific provider outage. Find the request in service/Gateway logs rather than guessing from that status.

## Historical generation-smoke validation evidence (before A1)

```powershell
npm --workspace ai-orchestrator-service test
npm --workspace ai-orchestrator-service run typecheck
npm --workspace ai-orchestrator-service run build
```

The final service suite passed **26/26 tests**, including 12 smoke-helper cases. Typecheck, production build, actual CLI dry-run/help and `git diff --check` passed. Smoke tests use injected HTTP responses and an isolated real loopback HTTP fixture, **never a model/provider**. They cover zero-network defaults, paired confirmation flags, URL/credential/blocked-port restrictions, service identity, response/manifest validation, bounded bodies, sanitized failures, no automatic retry, redirect rejection and the actual CLI's safe default/help. A live paid smoke and Gateway-log reconciliation have not been run.

Installed SDK version was checked locally; no dependency update, service API change, provider/model change or production retry-policy change is included.

References checked for this work: [Gateway setup](https://vercel.com/docs/ai-gateway/getting-started), [model catalog](https://ai-gateway.vercel.sh/v1/models), and version-matched `node_modules/ai/docs/07-reference/01-ai-sdk-core/01-generate-text.mdx` for retry defaults. Use current official Gateway spend documentation before changing account budgets; this helper is not a billing control.
