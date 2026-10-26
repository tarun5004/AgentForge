# Direct Google live loop — 2026-10-25

**Result: the core live generation-to-preview loop passed with `gemini-3.5-flash-lite`.** This is one synthetic portfolio and one follow-up, not exhaustive model evaluation, public-production readiness or completion of every roadmap feature. The earlier Gateway verification is preserved below as dated evidence.

## What failed, and what changed

1. An initially screenshot-transcribed key was rejected. A user-updated key passed model lookup and `countTokens`. No key values were logged or committed.
2. Gemini 3.8 inference timed out; a separate Interactions diagnostic explicitly returned 503 high demand. Tiny 3.6 Flash and 3.5 Flash-Lite requests both returned `OK`.
3. The first full generation found a real compatibility bug: Google rejected `Forced function calling (ANY mode) with a response mime type: 'application/json' is unsupported` (HTTP 400). Offline transport fixtures had previously accepted this invalid combination, so their green result was insufficient evidence.
4. Updated the compatible pair to `ai@7.0.153` and `@ai-sdk/google@4.0.105`. The provider handles forced-tool output separately, retaining JSON schema output for the final step. A regression fixture now rejects the invalid forced-tool/JSON combination. No safety guard or manifest validation was removed.
5. Retested 3.6: skill loading passed, but the final generation returned provider 503. Deliberately selected 3.5 Flash-Lite; there is no runtime paid-provider fallback or automatic SDK retry. Local config and direct-provider default now use the successfully tested model.

## Verified real browser flow

- Disposable registration succeeded against production Auth/Project modules, dedicated MongoDB and the actual AI app. Enter submitted a complete synthetic portfolio prompt; requirements returned ready without extra questions or logout.
- Confirmed the saved brief and generated code. The model made the real read-only `loadSkill` call, then returned `app/globals.css`, `app/layout.tsx` and `app/page.tsx`.
- Project returned 202 while Execution built the saved candidate. Only after a successful restricted Docker build did Project publish v1 with `build_passed` evidence.
- Preview separately built and served the saved revision. The browser rendered the actual generated page, navy CSS (`rgb(13, 27, 42)`), and the React counter changed 0 -> 1. Iframe sandbox remained exactly `allow-scripts`; both screenshots were visually inspected.
- Stopped preview and refreshed. Login, selected project/revision and saved files restored with no additional model call.
- Submitted a follow-up against selected v1: change only the hero heading to `Hello, Future AI Engineer`. The real tool/generation calls and candidate build succeeded; v2's parent is v1.
- Byte comparison found exactly one changed line (the h1) in `app/page.tsx`. CSS/layout stayed byte-identical, and v1's snapshot hash stayed unchanged.
- Built/opened v2 Preview: new heading appeared, navy CSS remained, counter again changed 0 -> 1, and sandbox remained unchanged. Stop/close/refresh restored v2 with no extra provider call.
- Browser console contained only the expected initial unauthenticated refresh 401 before disposable registration; no new error appeared during the successful generation/preview/reload flow.

## Successful-loop usage, not a billing receipt

| Operation | Input tokens | Output tokens | Total tokens |
| --- | ---: | ---: | ---: |
| Requirement assessment | 383 | 113 | 496 |
| Initial skill call | 666 | 18 | 684 |
| Initial code generation | 951 | 2,385 | 3,336 |
| Follow-up skill call | 626 | 18 | 644 |
| Follow-up code generation | 3,262 | 713 | 3,975 |
| **Successful loop** | **5,888** | **3,247** | **9,135** |

All five calls returned HTTP 200. This ledger excludes the earlier diagnostic/failed attempts; across this turn there were 13 inference attempts, including two tiny probes, two 400 rejections and one 503. Successful responses across those attempts reported 12,326 tokens. Failed-request usage/account-wide dollars were not measured; no zero-bill guarantee is made. Billing, credits and budgets were not changed.

## Validation and artifacts

- AI: 57/57 tests plus typecheck/build. Project: 34/34 tests (including six generation-contract tests). Execution: 45/45 tests. Frontend: 40/40 tests, lint and production build. Auth/Project/Execution builds also passed, with Execution typecheck. Total: 176 passing tests; no integration-suite count is inferred from these unit/contract runners.
- Actual Docker candidate builds and Preview builds passed for both revisions. This is additional live evidence, not substituted unit-test coverage.
- v1 snapshot SHA-256: `e15dd93e4728e6f6b2679d087274c25b19db2fffbebb8d8b0f203785ef206fe4`.
- v2 snapshot SHA-256: `58644a183464029af45cb9d9debc4be63a7e8a168049dcb1158859a635dacfdc`.
- Both build proofs pinned runner image `sha256:d06c878454a5a36edd9a5a14300f951725490980f81a370509567a96ecb6727a` and policy `next-static-build-v1`.
- Ignored evidence: `output/playwright/gemini-live-before-sdk-fix.json`, `gemini-36-after-sdk-fix.json`, `gemini-live-flow-report.json`, `gemini-v1-live-preview.png`, `gemini-v2-live-preview.png`, `gemini-v1-restored.yml` and `gemini-v2.yml`. These contain test evidence, not reusable credentials or a production fake-provider mode.
- Cleanup removed only the disposable account and its test records. All five collection counts returned zero; only owned verification processes/container were stopped. Normal application records, volumes and source changes were preserved. The downloaded trusted image/cache remain reusable.

**Remaining:** rebuild/start the normal local stack from the intended merged source before recording; these temporary test services are not a silently updated normal Compose deployment. Existing dependency advisories and the unmerged clarification slice remain separate concerns. The generated example added extra skill labels and did not use the exact requested counter button wording; functional/build success is not proof of perfect instruction following or design quality. Terminal, backend generation, Kubernetes and advanced roadmap features are not claimed by this test.

---

# Free-credit model and live local loop — 2026-10-23

**Result: bounded live smoke passed.** Real `google/gemini-2.5-flash` responses drove requirements, initial generation and a targeted follow-up; both saved revisions passed real restricted Docker builds and rendered as interactive browser previews. This is one synthetic portfolio case, not a general quality/reliability benchmark or production security certification.

## Change and selection

- Scope: `feature/ai-orchestrator-free-tier-model`, branched from updated merged `main` at `c4d60b4`. Prior A4 frontend audit documents remain preserved in the explicitly named Git stash; no unrelated work was overwritten or included.
- Changed the server fallback and `.env.example` to `google/gemini-2.5-flash`; updated only `AI_MODEL` in the ignored local AI-service `.env`. Explicit configuration still overrides the fallback. Keys, ports, schemas, adapters and dependencies stayed unchanged.
- Current official directory displayed **Free AI Gateway Credit: Yes** for Gemini 2.5 Flash. Full live catalog confirmed structured output, SDK v4 support and no-training availability across its endpoints. Eligibility is dated, not a permanent entitlement or zero-cost claim.
- Rejected a zero-priced alternative for this selection because its current metadata allowed prompt/response retention for training. No real personal details/secrets were sent to any model; the smoke used synthetic “Demo Student” information.
- Existing Gemini 3.7 Flash investigation had two rejected requests with reported/account-observed cost $0. Its explicit upstream reason was free-tier exclusion. No credits were purchased and no routing/security/budget policy was weakened.

Sources checked: [model directory with free-credit filter](https://vercel.com/ai-gateway/models?freeTier=true&q=gemini-2.5-flash), [live model catalog](https://ai-gateway.vercel.sh/v1/models), [free/paid tier semantics](https://vercel.com/docs/ai-gateway/pricing).

## Actual flow evidence

1. Disposable browser registration succeeded against real Auth, Project and dedicated Mongo services. Enter submitted “Build a portfolio website for me.”
2. Actual assessment asked three questions: name, role and sections. No fixed questionnaire or AI-response fixture was used.
3. Supplied synthetic name/role plus frontend-only design/counter requirements. Actual reassessment produced a ready brief with those facts. Refresh restored the saved brief and answers without another model request.
4. Confirm did not call the model. Separate Generate used the saved confirmed brief. Project returned **202 pending**, with no premature revision/files, while Execution checked the candidate.
5. Real Docker build passed and Project published **v1**, six files. A separate Preview build rendered the page, applied navy CSS (`rgb(10, 25, 47)`), and the real React button changed **Count 0 → Count 1**. Iframe sandbox was exactly `allow-scripts`.
6. Stop was acknowledged. Refresh restored v1/session with the same saved revision and no additional model request.
7. A fourth/final call requested only the hero-role change to “AI Engineering Student” against selected v1. Real build passed; **v2** had v1 as parent, only `app/page.tsx` marked M, five other files byte-identical, and unchanged v1 hash.
8. v2 Preview showed **“An AI Engineering Student.”** and retained the working Count button/sandbox. Stop, close and refresh restored saved v2 and its build-verification status without another AI call.

The initial six files were `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `components/CounterButton.tsx`, `components/Header.tsx`, and `components/Section.tsx`.

v1 snapshot hash: `52fedbd4e2c0ec84ccaa529ea48a061ed06bcedbb48e778c35272a1c9699ef03`.
v2 snapshot hash: `23c919c839001256ba284d3d22e4f82f670a51324dcebab345273646e90fe468`.
Both persisted build proofs referenced trusted image `sha256:9ec02674ae57cad0c510a93fa90f9823062991d99103c52a84346c009c06121e` and policy `next-static-build-v1`.

## Four-call ledger

| Operation | Input tokens | Output tokens (includes reasoning) | Gateway-reported USD | Generation ID |
| --- | ---: | ---: | ---: | --- |
| Initial assessment | 410 | 218 | 0.0006680 | `gen_01M5MR9VQ8XQE23BC099TR4SWY` |
| Answer reassessment | 572 | 459 | 0.0013191 | `gen_01M5MRARJ7PTY2R645TTT7T098` |
| Initial generation | 502 | 2823 | 0.0072081 | `gen_01M5MRDQK30QBD2S8AR30PPH67` |
| Selected-base follow-up | 2412 | 448 | 0.0018436 | `gen_01M5MRNJSDEN18BTD7QEG80MJ3` |
| **Total** | **3896** | **3948** | **0.0110388** | Four HTTP 200 results |

Credits endpoint independently changed from balance **5 / total used 0** to **4.9889612 / total used 0.0110388**, matching the per-call sum. This consumed free Gateway credits; it did not demonstrate zero-priced inference. No top-up, extra paid model, automatic repair, tool or browser-triggered provider request was used.

The temporary composition's outbound guard bounded model/host/call count/input bytes/output tokens, rejected duplicate retries, and conservatively reserved spend below the existing **$2 total** approval. It halted at four calls. This is test instrumentation, not a new application dollar-budget feature. Production generation still inherits the SDK retry default; changing that policy is a separate focused follow-up, not silently included here.

## Checks, artifacts and cleanup

- AI service **39/39 tests**, typecheck and build passed. Two fresh-process checks verified the new omitted-model fallback and preserved explicit override. No new package.
- Browser CLI used real Next/Auth/Project/AI/Execution/Mongo with a dedicated `agentforge_test_a4_live_flash` database. Existing local composition helpers wired production modules but **did not substitute model output**. Normal application records were never used as test fixtures.
- One v2 read-only browser assertion mistakenly expected “A AI Engineering Student.”; actual generated grammar was “An AI Engineering Student.” The corrected exact-heading/counter assertion passed. The superseded waiter later ended on browser close and is **not counted as a passing check**. One mongosh projection expression also failed before the corrected immutable-snapshot query passed; neither failure was an application/model failure or triggered another AI call.
- Ignored artifacts: `output/playwright/a4-live-flash-report.json`, `a4-flash-real-questions.png`, `a4-flash-live-preview.png`, `a4-flash-v2-preview.png`, and matching CLI snapshots. Both Preview screenshots were visually inspected.
- Scoped cleanup independently confirmed **zero users/projects/revisions/generations/projectbriefs**. No Preview-labelled containers remained. Only the owned browser, temporary services/Next process and labelled temporary Mongo container were stopped/removed. No application database/volume was deleted.
- To apply the requested model to the normal local stack, only `ai-orchestrator-service` was recreated through Compose. Its environment reports `google/gemini-2.5-flash` and health returns **200**; all six Compose services are healthy. Other service images were not rebuilt, so the source-based isolated smoke is **not** a claim that those older normal-stack images contain every recent UI/API feature.

## Why this approach / remaining limits

- **Why config rather than a new adapter?** Both model calls already use Gateway and `AI_MODEL`; access failure was entitlement/configuration, not a missing provider integration.
- **Why verify build and UI separately?** A schema-valid model response does not prove imports compile or browser hydration/CSS works. Candidate checks precede publication; Preview separately builds and serves the selected saved snapshot.
- **Why full snapshots plus changed output?** The follow-up sent only one file update, preserved five files and left v1 immutable, while each revision remains independently reloadable.
- Remaining: repeatable live evaluation across cases, production retry/cost policy, broader safety testing, fresh-machine setup, and public deployment are not proven by this bounded smoke. No claim of a complete Cursor clone, interactive terminal or arbitrary full-stack runtime.
