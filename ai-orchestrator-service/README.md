# AI Orchestrator Service

This service receives authenticated internal generation requests from Project Service, calls the configured model through Vercel AI Gateway, and validates a constrained Next.js frontend manifest. Project Service owns saved revisions; this service does not write Project data or execute generated code.

## Existing service setup

Use Node 22+ and the repository's root npm workspaces/lockfile. Copy this service's `.env.example` to a local ignored `.env` and configure:

| Variable | Purpose |
| --- | --- |
| `PORT` | Legacy server default is 6000, which Node Fetch blocks. Use 6001 for host HTTP clients; Compose already overrides it to 6001. |
| `INTERNAL_SERVICE_TOKEN` | Must match Project Service. Server-side only. |
| `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | Existing Gateway authentication; never a browser variable. |
| `AI_MODEL` | Server-owned model selection; default `google/gemini-2.5-flash`. Confirm the exact ID, free-credit eligibility and pricing before a live request. |

From the repository root:

```powershell
npm --workspace ai-orchestrator-service run dev
```

For a host-only server, set `PORT=6001` and the matching Project `AI_ORCHESTRATOR_URL` locally before testing; [the Docker guide](../docs/LOCAL_DOCKER.md) explains the existing blocked-port finding. Changing `AI_MODEL` does not change ports or credentials; the legacy port default remains unchanged. The smoke helper defaults to 6001 and explicitly rejects 6000.

### Free-credit model selection — 2026-10-23

The configured Gemini 3.7 Flash request returned Gateway 403 `no_providers_available`; a bounded diagnostic captured the actual reason: the free tier does not have access to that model. The example and fallback now use **`google/gemini-2.5-flash`**: the current [model directory](https://vercel.com/ai-gateway/models?freeTier=true&q=gemini-2.5-flash) lists Free AI Gateway Credit eligibility, and the live catalog lists structured-output support and no-training availability across its providers. Model access/capabilities/pricing can change; this is a dated selection, not a permanent guarantee.

Free-credit eligibility is **not zero-priced/unlimited inference**: calls deduct token usage from available Gateway credits. No direct Google key, new adapter or SDK rewrite is needed; both assessment and generation already read `AI_MODEL`. Explicitly configured values still override the fallback. Restart a host process after editing its local `.env`; Compose needs `docker compose up -d --no-deps --force-recreate ai-orchestrator-service` to reload `env_file` (a plain restart retains its old environment). No paid fallback, top-up, budget or account-policy change is part of model selection.

**Executed verification:** 39 service tests, typecheck/build and two fresh-process default/override checks passed. Four actual Gateway calls completed the isolated browser flow: essential questions → supplied answers → saved brief → explicit confirmation → generated v1 → Docker build/interactive iframe → selected-base follow-up v2 → build/Preview → refresh. Reported/account-observed cost **$0.0110388**, below the approved $2 total budget; no automatic retries or repair calls. Normal Compose's **AI service only** was recreated, and its configured model plus health 200 were confirmed; other services/data were not restarted/rebuilt. This does not certify the normal stack's older images as the newly tested source. [Detailed evidence, billing, cleanup and limits](LIVE_VERIFICATION.md).

Routes: free health `GET /_status/healthz`; authenticated `POST /internal/generations` using `x-internal-service-token`. Request fields are `requestId`, `projectId`, `prompt`, `template: nextjs`, `mode: economy`, plus optional server-loaded `baseRevision`. The response is `{ generation }`, including upserts/deletions, model/usage/latency and `manifest_validated` policy metadata. See [the implemented contract](../docs/05_OPENAPI_SPEC.md#implemented-slice-3--internal-context-and-file-change-boundary-2026-10-12).

## Requirement assessment — A1 (2026-10-23)

`POST /internal/requirements` uses the **same internal service token**, existing Gateway credentials and configured model. The normal service implementation calls the model; it does not use a canned questionnaire. No new package or environment variable is required. A2/A3 connect it to owned Project briefs and the browser's separate review/confirmation/generation controls.

```json
{
  "requestId": "brief-1",
  "projectId": "66d123456789abcdef123456",
  "prompt": "Build my portfolio website",
  "answers": []
}
```

Returns `{ assessment }` with `status: needs_clarification | ready | unsupported`, a short `message`, draft `brief`, at most **one** essential `question` in the existing `questions` array, `requestId`, `policyVersion`, model, token usage and latency. Unavailable usage fields are `null`, not a false zero-token claim. `ready` means ready for **human review**, never automatic permission to generate. Unsupported backend functionality is outside the existing frontend-only scope. The endpoint returns no files and executes no code.

### Default-first clarification fix — 2026-10-23

The reported “build a small Tarun Raj name component” task entered a repeated questionnaire: optional placement/click behavior was treated as required, and paraphrased questions bypassed exact-match checks until the browser's six-answer limit blocked submission.

- Prefer a useful draft from the initial prompt. Instructions tolerate common typos and treat font/color/spacing/placement/optional interactions as defaults, not blockers. Missing personal facts remain visibly labelled placeholders or are omitted; never invent identity/achievements. A requested logo without an asset can use an initials/text mark.
- Only an unknown **core purpose/behavior** justifies one short initial question, not a bundled survey. Already supplied answers are sent intact as bounded data.
- After any answers, the provider receives a schema permitting only `ready` or `unsupported`, with an empty question array. Local validation uses the same schema. There is no second clarification round, silent truncation, status coercion or extra model retry. Noncompliant output remains a sanitized upstream 502 rather than a fabricated ready result.
- The `frontend-requirements-v1` wire identifier/fields remain compatible with existing Project/browser readers; this is a dated tighter clarification policy, not a new payload or database migration. Historical saved assessments are not rewritten. An old draft already displaying more than six accumulated answer fields still needs a new conversation with its combined details; this AI-only fix does not repair that separate saved-state UI limit.
- Example expected guidance: `build a small tarun raj name componet` → ready name-component draft; `Build my portfolio website` → starter with explicit personal-data placeholders; `Build a website` → one purpose question, then draft. These are prompt expectations, not claims of live-model evaluation.

**Why:** prompting selects sensible defaults; the per-request output schema bounds the conversation without relying on semantic duplicate detection. Human review still authorizes generation. Fewer rounds limit avoidable calls, but no measured token/quality gain or equivalence to a stronger model is claimed. No new package, credential, endpoint or automatic paid repair.

**No-spend verification:** AI suite **46/46**, typecheck/build and existing Project requirement-contract tests **4/4** passed. Added checks cover the reported prompt guidance, single-question bound, intact supplied answers, rejection of paraphrased follow-ups, preservation of ready/unsupported output, and sanitized HTTP 502 with one mock-model call on policy violation. The first typecheck caught an overly narrow inferred schema return type; an explicit common Zod output type fixed it, and final checks passed. SDK mocks verify enforcement and transport, not real model comprehension. No live provider or browser generation was run for this change.

Applied locally with `docker compose up -d --no-deps --build --wait --wait-timeout 120 ai-orchestrator-service`.
AI health returned 200; running prompt/schema/service file hashes matched the working tree. Other containers,
environment files and saved briefs were not changed. Prior uncommitted A4/Compose docs remain in the named
`docs: preserve A4 live and Compose sync evidence before clarification fix` stash; this service branch does
not include them. Runtime verification made no additional model call; Git delivery is a separate explicitly requested step.

- Input is strict: prompt 10–1000 characters; valid project ID; at most six question/answer pairs, question 240 and answer 1000 characters; serialized UTF-8 context at most 20,000 bytes. Unknown identity/model/file/chat fields and duplicate normalized answered questions are rejected.
- New SDK call: at most 1500 output tokens, 45-second total timeout and **zero SDK retries**; no tools, automatic repair or application fallback. Existing generation keeps its original behavior. One HTTP call does not guarantee a hard dollar limit or a single internal Gateway provider attempt. Another POST can spend again; A1 has no idempotency store. A timeout does not prove provider-side cancellation.
- Input/JSON errors: 400; internal authentication: 401; excessive context/body: 413; provider/output errors: sanitized 502. Model-output validation errors never masquerade as invalid user input. Logging does not print answers, briefs, raw provider errors or credentials.
- The internal caller must verify JWT/project ownership and load trusted saved answers. A `projectId` in this body is correlation data, not authorization. Prompt instructions and exact duplicate checks cannot guarantee zero hallucination, prevent all injection or detect paraphrased repeated questions.
- Project-owned persisted briefs and frontend review/confirmation already exist in A2/A3. The six-answer input cap remains for legacy context; new clarification output stops after one answered round. No existing draft, consent state or pending request is silently changed. A real provider check of the revised prompt needs explicit spending approval; the clarification fix makes no live call.

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
- **This is not a hard token or dollar budget for the entire operation.** The existing server caps output at 8,000 tokens; installed AI SDK 7.0.105 documents a default of two retries, and this server does not override it. One HTTP POST does not guarantee one provider attempt. The harness does not inspect/change account budgets, credits, routing or automatic top-ups.
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
