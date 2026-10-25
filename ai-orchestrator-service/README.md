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

## Frontend skill tool — 2026-10-25

**Scope:** one reviewed frontend-design skill and one read-only `loadSkill` tool, inside the existing AI Service. No new package, service, endpoint, database field, provider adapter or approval screen. Project still owns requests/revisions and Execution still owns builds. Existing user confirmation/Generate controls are unchanged; there is no per-tool approval interaction.

### Actual flow

1. Before any model call, load and verify the bounded local skill file. Missing/changed text fails closed. Windows CRLF is normalized to LF before SHA-256 verification.
2. The SDK `ToolLoopAgent` forces `loadSkill({ skillId: "frontend-design" })` as its first model step. The tool returns the reviewed instructions plus version/hash/source metadata; it executes no shell/code and changes no files.
3. The second model step receives that tool result and generates the existing structured file manifest. Tools are disabled. Selected base files are added only here, not sent again just to load the skill.
4. Existing manifest/path/deletion checks still apply. The public response shape is unchanged, and usage sums **both** model steps rather than hiding the first call's usage.

Limits: two SDK model steps maximum, first-step output 256 tokens, final-step output 8,000 tokens, total SDK timeout 80 seconds (inside Project's existing 90-second HTTP boundary), zero SDK retries and one successful skill read per generation. Unknown skill IDs, paths, URLs, duplicate calls, skipped skill reads and extra tool rounds fail rather than expand permissions. There is no fallback/repair loop. Gateway may have its own routing behavior; this is not a hard dollar budget or a guarantee of one underlying provider attempt per step. The legacy numeric response still falls back to zero for unavailable usage; do not interpret that fallback as measured zero spend.

**Cost tradeoff:** genuine model tool calling adds a small model step compared with direct generation. Keeping the skill under 4 KiB and omitting base files from the first step bounds avoidable context, but lower total cost or better real-model quality has not been demonstrated. Model configuration must support tools plus structured output. This is a bounded coding workflow, not a reproduction of another coding agent's hidden reasoning.

### Source and trust boundary

- Reviewed upstream: [Anthropic frontend-design](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design/SKILL.md), pinned revision `dbd4588f9e1033efb41dad4bef2f7947c8993d44`.
- Local [SKILL.md](skills/frontend-design/SKILL.md) is a **modified compact adaptation**, not the complete upstream skill. It preserves task-specific design, typography, restraint, accessibility and useful copy guidance, while keeping small components/follow-ups small. External assets/fonts/packages, extra confirmation conversations and speculative execution claims are excluded.
- [NOTICE.md](skills/frontend-design/NOTICE.md) records provenance/modifications/original hash; [LICENSE.txt](skills/frontend-design/LICENSE.txt) includes the Apache-2.0 terms. Runtime fetches nothing from GitHub and never auto-installs scripts or tools from skill text.
- One allowlisted skill covers the current frontend-only task scope. This is **not** arbitrary GitHub search/import or a multi-skill marketplace. Add another skill only through a reviewed local code/content change. Skill instructions cannot override frontend safety, ownership or execution rules.
- Actual tool execution emits a structured `skill_loaded` event containing only skill ID/version/hash. It does not log the user prompt, base files, credentials or internal reasoning. This is server-side activity evidence, not yet a new frontend tool-activity panel.

### Verification and branch delivery

**Passed:** 50 AI tests (39 baseline + 11 new), typecheck/build; six existing Project generation-contract tests; and the compiled loader resolving the 2,137-byte local adaptation from `dist`. SDK mocks demonstrate the actual tool-call/result loop, usage aggregation, selected-base placement, unknown-resource denial, tamper rejection, duplicate/extra-step denial, no retries on either step and manifest safety. They do not demonstrate live model design quality or a browser-to-Preview E2E.

One initial assertion expected the application's skipped-skill error; the SDK correctly rejected the missing required tool even earlier with `AI_ToolChoiceViolationError`. The assertion was corrected to that specific SDK failure; final tests passed. No production guard was removed to make the test pass.

Docker image verification was attempted with a separate `agentforge-ai:skill-tool-test` tag, but failed **before building** because the Docker Desktop Linux-engine pipe was unavailable. No container was started/replaced, no normal image tag/volume was changed, and no paid model call or application database write was made. Container packaging and revised live-model behavior remain unverified. When Docker is running, the free suite can be exercised in an isolated image:

```powershell
docker build -f ai-orchestrator-service/Dockerfile -t agentforge-ai:skill-tool-test .
docker run --rm --network none agentforge-ai:skill-tool-test npm test
```

The image's existing `COPY ai-orchestrator-service` includes `skills/`; the root ignore file excludes credentials/build outputs. Do not copy only `dist` for another deployment without also including these reviewed assets.

Branch `feature/ai-orchestrator-frontend-skill-tool` starts from merged main `5845c55`. It is independent of the clarification fix `75d75af`; this branch intentionally does not silently include that commit or alter requirement assessment. Review/include both compatible slices before updating the normal AI container, otherwise rebuilding from this older base would omit that fix. Prior stashed audit documents are untouched. Local commit delivery was approved on 2026-10-25; push, PR and merge are separate actions, not included in that approval.

**Interview explanation:** a skill is reviewed guidance; the tool is the controlled reader; the harness is the SDK loop enforcing order, limits and validation. These help a model follow a task-specific process, but do not guarantee stronger-model equivalence or replace evaluation.

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

Returns `{ assessment }` with `status: needs_clarification | ready | unsupported`, a short `message`, draft `brief`, up to three `questions`, `requestId`, `policyVersion`, model, token usage and latency. Unavailable usage fields are `null`, not a false zero-token claim. Questions should cover essential missing facts rather than repeat supplied answers. `ready` means ready for **human review**, never automatic permission to generate. Unsupported backend functionality is outside the existing frontend-only scope. The endpoint returns no files and executes no code.

- Input is strict: prompt 10–1000 characters; valid project ID; at most six question/answer pairs, question 240 and answer 1000 characters; serialized UTF-8 context at most 20,000 bytes. Unknown identity/model/file/chat fields and duplicate normalized answered questions are rejected.
- Requirement SDK call: at most 1500 output tokens, 45-second total timeout and **zero SDK retries**; no requirement tools, automatic repair or application fallback. Generation separately uses the bounded two-step skill workflow above. One HTTP call does not guarantee a hard dollar limit or a single internal Gateway provider attempt. Another POST can spend again; A1 has no idempotency store. A timeout does not prove provider-side cancellation.
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
