# AI Orchestrator Service

This service receives authenticated internal generation requests from Project Service, calls the configured model through Vercel AI Gateway, and validates a constrained Next.js frontend manifest. Project Service owns saved revisions; this service does not write Project data or execute generated code.

## Existing service setup

Use Node 22+ and the repository's root npm workspaces/lockfile. Copy this service's `.env.example` to a local ignored `.env` and configure:

| Variable | Purpose |
| --- | --- |
| `PORT` | Legacy server default is 6000, which Node Fetch blocks. Use 6001 for host HTTP clients; Compose already overrides it to 6001. |
| `INTERNAL_SERVICE_TOKEN` | Must match Project Service. Server-side only. |
| `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | Existing Gateway authentication; never a browser variable. |
| `AI_MODEL` | Existing server-owned model selection. Confirm the configured ID against the current Gateway catalog before a live request. |

From the repository root:

```powershell
npm --workspace ai-orchestrator-service run dev
```

For a host-only server, set `PORT=6001` and the matching Project `AI_ORCHESTRATOR_URL` locally before testing; [the Docker guide](../docs/LOCAL_DOCKER.md) explains the existing blocked-port finding. This slice does not rewrite your real `.env` files or change the legacy server default. The smoke helper defaults to 6001 and explicitly rejects 6000.

Routes: free health `GET /_status/healthz`; authenticated `POST /internal/generations` using `x-internal-service-token`. Request fields are `requestId`, `projectId`, `prompt`, `template: nextjs`, `mode: economy`, plus optional server-loaded `baseRevision`. The response is `{ generation }`, including upserts/deletions, model/usage/latency and `manifest_validated` policy metadata. See [the implemented contract](../docs/05_OPENAPI_SPEC.md#implemented-slice-3--internal-context-and-file-change-boundary-2026-10-12).

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

## Validation evidence for this slice

```powershell
npm --workspace ai-orchestrator-service test
npm --workspace ai-orchestrator-service run typecheck
npm --workspace ai-orchestrator-service run build
```

The final service suite passed **26/26 tests**, including 12 smoke-helper cases. Typecheck, production build, actual CLI dry-run/help and `git diff --check` passed. Smoke tests use injected HTTP responses and an isolated real loopback HTTP fixture, **never a model/provider**. They cover zero-network defaults, paired confirmation flags, URL/credential/blocked-port restrictions, service identity, response/manifest validation, bounded bodies, sanitized failures, no automatic retry, redirect rejection and the actual CLI's safe default/help. A live paid smoke and Gateway-log reconciliation have not been run.

Installed SDK version was checked locally; no dependency update, service API change, provider/model change or production retry-policy change is included.

References checked for this work: [Gateway setup](https://vercel.com/docs/ai-gateway/getting-started), [model catalog](https://ai-gateway.vercel.sh/v1/models), and version-matched `node_modules/ai/docs/07-reference/01-ai-sdk-core/01-generate-text.mdx` for retry defaults. Use current official Gateway spend documentation before changing account budgets; this helper is not a billing control.
