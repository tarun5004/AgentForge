# Execution Service — local static preview

This service provides an **opt-in local-only execution backend**. The frontend's saved-revision Preview integration is separate; it requires an enabled local controller and the matching proxy configuration. Execution does not generate code or change Project revision ownership/publication. See [the frontend setup](../nextjs-boilerplate/README.md#local-saved-revision-preview).

## Flow and trust boundaries

```text
Bearer token + projectId/revisionId
  -> Execution API on loopback
  -> Project Service owner-scoped revision read
  -> independently validate generated frontend snapshot
  -> fixed trusted Next.js template in restricted Docker container
  -> next build --webpack (static export)
  -> bounded static artifact bytes, no host extraction
  -> remove build container BEFORE publishing success
  -> separate loopback preview origin + expiring capability URL
```

Project Service remains the identity/ownership authority. Execution forwards the supplied bearer token to its existing authenticated read APIs. A browser cannot submit source files, commands, a container image, environment variables, or an owner ID. Subsequent reads, cancellation and activity require owner authorization again. A preview link itself is a short-lived bearer capability: anyone holding it can view that run until stopped/expired. Do not share or log it.

### Why a static export?

The existing AI contract generates frontend-only App Router files using React, Next.js and plain CSS. A trusted scaffold provides the package/config files. Static export builds both server components and client bundles in the isolated build container, then serves only HTML/CSS/JS. React client interactions work, but SSR, API routes, server actions, external fetches, arbitrary package installation, Tailwind tooling, dynamic server features and interactive terminals are not supported. The template is not a general-purpose execution shell.

No Redis, queue, Kubernetes cluster or cloud sandbox is introduced. The existing `REDIS_URL` remains an unused foundation setting.

### Generated styles and the fallback layout

When the snapshot has no `app/layout.tsx`, the trusted template supplies a minimal root layout. If that snapshot also contains the exact `app/globals.css` path, the fallback imports it so Next includes the stylesheet in the static export. A page-only snapshot gets no missing-file import. If the snapshot supplies its own root layout, it is preserved unchanged and owns its CSS imports; the template does not inject imports into generated source or automatically import every CSS module.

Rebuild the trusted runner image after changing `preview/` helpers: a running controller pins the old image ID until restarted. A successful build alone does not prove styling loaded; the Docker regression verifies the HTML's CSS link and served asset, and its optional browser check verifies computed background color as well as the React counter. See [Next.js global CSS](https://nextjs.org/docs/app/getting-started/css#global-css).

## Setup (repository root, PowerShell)

Keep the normal frontend/Auth/Project/Mongo stack running. The default Project URL uses the frontend's existing same-origin proxy, which can reach Compose's internal Project Service. Alternatively use a separately running local Project API origin.

```powershell
docker build -f execution-service/preview/Dockerfile -t agentforge-preview-runner:local .
npm --workspace execution-service run build

$env:LOCAL_PREVIEW_ENABLED = 'true'
$env:PORT = '5002'  # normal Compose Execution status container already uses 5000
$env:PREVIEW_PORT = '5101'
$env:PROJECT_SERVICE_URL = 'http://127.0.0.1:3001'
$env:PREVIEW_RUNNER_IMAGE = 'agentforge-preview-runner:local'
npm --workspace execution-service start
```

These variables apply only to this terminal/process; no real `.env` file needs changing. Keep `NODE_ENV=development` for this local demo. Enabled mode binds both API and preview to `127.0.0.1`. Run it on the trusted host, **not by mounting the Docker socket into the frontend or app containers**. The normal unprivileged Execution container stays status-only until a later reviewed integration.

### Frontend origin and iframe policy

By default, Preview allows embedding only from `http://localhost:3001` and `http://127.0.0.1:3001`. If the browser frontend uses another local port, set its **exact origin** in the controller's terminal before starting it:

```powershell
$env:PREVIEW_FRONTEND_ORIGIN = 'http://localhost:3102'
```

A configured origin replaces the two default aliases; use that exact hostname/port in the browser. Only HTTP `localhost` or `127.0.0.1` origins are supported. Wildcards, remote hosts, credentials, paths, queries, fragments and whitespace are rejected before listeners open. Leave the setting unset for the original port-3001 behavior. `PROJECT_SERVICE_URL` chooses where ownership reads go; `PREVIEW_FRONTEND_ORIGIN` chooses which browser page may embed the result. They are not interchangeable.

This changes only CSP `frame-ancestors`. It does not enable CORS, public hosting, iframe same-origin privileges, outbound connections or Docker network access. If a build is ready but the frame is blank, check the browser console for a `frame-ancestors` error before retrying the build or model call.

The runner image uses explicit `COPY` statements and its own restrictive Dockerfile ignore file. Only package manifests, the shared lockfile and trusted helper scripts enter the build context. Dependencies are installed once from the existing workspace lockfile; generated projects cannot trigger `npm install`. Startup resolves the configured image to an immutable local image ID. Missing images fail rather than being pulled during a run.

## HTTP contracts

API origin in the example: `http://127.0.0.1:5002`. Every run endpoint requires `Authorization: Bearer <access token>`. Obtain the token through the existing login/session flow; never commit it or paste it into support reports. The frontend forwards these calls through its separately configured Execution proxy.

| Endpoint | Request | Result |
| --- | --- | --- |
| `POST /api/runs` | `{ "projectId": "24hex", "revisionId": "24hex" }` | `202 {run}` building, or `200 {run}` when reusing a ready run. |
| `GET /api/runs/:runId` | none | `200 {run}`; polling does not extend lifetime. |
| `POST /api/runs/:runId/activity` | none | `200 {run}`; owner-confirmed user activity extends idle time, never maximum lifetime. |
| `DELETE /api/runs/:runId` | none | `200 {run}` cancelled; build cancellation triggers awaited background cleanup. |

`run` contains `id`, `projectId`, `revisionId`, `state`, `message`, nullable `errorCode`, ISO `createdAt`, and nullable `previewUrl`. States: `building`, `cancelling`, `ready`, `failed`, `cancelled`, `expired`. Only a ready run has a preview URL. `cancelling` remains visible until worker cleanup settles; `CLEANUP_UNCONFIRMED` is a failed/operator-review result, never a confirmed cancellation. Responses are not cached. Error wrapper: `{code, message, requestId}`.

- `400`: malformed body/IDs; `401`: missing/expired token; `404`: unknown/foreign project, revision or run.
- `413`: oversized HTTP body; `422`: stored snapshot unsupported by the template.
- `429`: another build is active; `503`: feature disabled, stopping, or Project Service unavailable.
- Build failures are recorded as `failed`, never `ready`. No compiler/daemon raw output is exposed as logs. The terminal UI remains unconnected.

Run metadata/artifacts are in memory, not a durable job queue. Restart loses previews, not saved Project revisions. One build is admitted at a time, including cancellation cleanup. Repeated requests for the same building/ready revision reuse its run; a failed/expired/cancelled run can be deliberately retried. At most eight runs are retained (oldest evicted at capacity). Artifacts expire after **30 minutes idle**, with a **one-hour absolute lifetime**. Background status/asset polling does not count as activity. Future UI activity heartbeats must reflect actual user activity, not an unconditional timer.

## Isolation and limitations

Build policy: Linux Docker, non-root UID, no network, read-only root filesystem, dropped capabilities, no privilege escalation, no published port, no host mount, no app secrets; 1 CPU, 1 GiB memory including swap, 128 PIDs, bounded temporary filesystems. Build command timeout is 120 seconds; CLI output and artifacts are bounded. The host invokes fixed Docker argument arrays with `shell:false`; generated JavaScript is never evaluated by the host process. Temporary directories live inside the disposable container.

Source limits follow the existing small manifest: 12 files, 30,000 characters per file, 120,000 total, 120-character canonical paths; `app/page.tsx` is required. Only `app/`, `components/`, `lib/` TS/TSX/CSS files are accepted. Artifact limits: 200 files, 6 MiB total, allowlisted static extensions, no symlinks, no archive extraction. The separate static server uses an unguessable path, strict Host check, no-referrer, no-store, sandbox CSP, no external connections/forms/frames/workers. A later iframe must use `sandbox="allow-scripts"`, **without `allow-same-origin`**.

**Not a production hostile multi-tenant security boundary.** Docker shares a kernel and its controller has powerful daemon access. Run only as a local trusted developer demo; do not expose it on a public interface or use production secrets/hosts. Public execution needs a dedicated hardened worker/microVM design, image/dependency vulnerability remediation, quotas, durable recovery and reviewed ingress/network isolation. The runner install on 2026-10-22 reported **9 dependency vulnerabilities (8 high, 1 critical)**; these existing workspace advisories are not remediated by this feature. Local container flags are defense in depth, not proof against every escape.

Cleanup is attempted in `finally` for success, failure, timeout and cancellation. If cleanup cannot be confirmed, the runner fails closed and refuses new builds. Startup refuses to run when any prior labeled preview containers exist. A hard host/process crash can leave an orphan: inspect exact containers, verify labels and that no other controller is active, then remove only those confirmed preview containers:

```powershell
docker ps -a --filter label=agentforge.local-preview=true
docker inspect --format '{{json .Config.Labels}}' <exact-container-id>
docker rm -f <confirmed-preview-container-id>
```

Never use a broad prune or remove application/Mongo containers/volumes to recover a preview.

## Verification

```powershell
npm --workspace execution-service test
npm --workspace execution-service run typecheck
npm --workspace execution-service run build

# Explicit opt-in; uses only the trusted runner image and deterministic fixture code.
$env:RUN_DOCKER_TESTS = '1'
npm --workspace execution-service run test:docker

# Optional real-browser check using the repo's existing Playwright CLI installation.
$env:VERIFY_PREVIEW_BROWSER = '1'
$env:AGENTFORGE_PLAYWRIGHT_CLI = '<absolute-path-to-installed-playwright-cli.js>'
npm --workspace execution-service run test:docker
```

The separate opt-in browser-policy test needs an installed Playwright CLI/browser, but no Docker build, database or provider:

```powershell
$env:RUN_PREVIEW_BROWSER_TESTS = '1'
$env:AGENTFORGE_PLAYWRIGHT_CLI = '<absolute-path-to-installed-playwright-cli.js>'
$env:AGENTFORGE_BROWSER_CHANNEL = 'msedge' # optional; default is chrome
npm --workspace execution-service run test:preview-browser
```

It serves fixed fixture HTML through the actual Preview server on owned random loopback ports. An interactive iframe succeeds under the configured parent; a different parent is browser-blocked. Storage/fetch restrictions remain enforced. This proves CSP embedding, not real model generation or the complete logged-in workspace-to-Docker flow.

Local tests use fixture transport, **not evidence of real MongoDB ownership persistence**. Docker integration now submits a real HTTP run request, forwards its bearer token to a fixture Project API, runs a real Next.js build, reads status and exported HTML through the production API/preview server, rejects invalid TSX, cancels an active build, and verifies exact container cleanup. The optional browser opens the actual API-returned capability URL, clicks a React counter, and checks sandbox storage/fetch restrictions. No artifact lookup bypass is used. No model/provider calls or application database writes are made. This is still not the logged-in workspace generation-to-preview flow: real Auth/Mongo and frontend wiring require separate verification.

References: [Docker execution limits](https://docs.docker.com/engine/containers/run/), [Docker security boundary](https://docs.docker.com/engine/security/), [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports).
