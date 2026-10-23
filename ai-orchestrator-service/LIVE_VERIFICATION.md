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
