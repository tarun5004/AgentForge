# Local Docker Compose

This is a local learning/demo stack, not a production deployment or generated-code sandbox.
It runs Next.js, Auth, Project, AI Orchestrator, Execution and a separate MongoDB container.
Redis, BullMQ and Kubernetes are not needed for the implemented flow. Execution currently serves
status endpoints only; it does not run generated code.

## First setup

1. Start Docker Desktop with its Linux engine. Check `docker info --format '{{.OSType}}'` returns `linux`.
2. In each backend folder, create `.env` from `.env.example` **only if it is missing**. Keep existing files.
3. Replace example secrets locally. Auth and Project need the same `ACCESS_TOKEN_SECRET`;
   Project and AI need the same `INTERNAL_SERVICE_TOKEN`. Auth also needs its refresh secret/expiry values.
4. AI Orchestrator needs valid Gateway authentication and an accessible `AI_MODEL` for real generation.
   Never put a direct Groq/Gemini key into `AI_GATEWAY_API_KEY`. Health checks do not validate a provider key.

The backend `.env` files are read by Compose at runtime, not copied into images. The root `.dockerignore`
excludes all nested `.env*`, host dependencies and build output. Runtime env values are still visible to
someone with Docker access: do not publish expanded `docker compose config` or container environment dumps.
Use `docker compose config --quiet` for a non-printing validation. No secrets belong in `.env.example`.

Compose overrides local-only addresses, ports and development settings without editing your `.env` files:

| Consumer | Docker address | Reason |
| --- | --- | --- |
| Auth | `mongodb://mongodb:27017/auth-service` | Its own database in the isolated Docker Mongo volume. |
| Project | `mongodb://mongodb:27017/project-service` | Separate service-owned database, not the host MongoDB. |
| Project -> AI | `http://ai-orchestrator-service:6001` | Service-name DNS; Node Fetch blocks the old port 6000. |
| Next -> Auth | `http://auth-service:4000` | Server-only same-origin proxy; browser never needs this hostname. |
| Next -> Project | `http://project-service:3000` | Protected Project requests use the same proxy pattern. |
| Browser -> Next | `http://localhost:3001` | Only published port, bound to the host loopback interface. |

`nextjs-boilerplate/.env.local` remains for host development and is not imported into the frontend container.
Compose supplies its two server-only proxy URLs explicitly; backend keys never enter that container.
HTTP Auth uses `NODE_ENV=development` so refresh cookies work locally. This is not an authentication redesign.

The original host-development `.env.example`/defaults still refer to AI port 6000. Compose overrides both
the AI port and Project URL to 6001, because a real container probe showed Fetch failing with `bad port`
on 6000 while Node's plain HTTP client returned 200. If you switch back to host-only development,
manually set AI `PORT=6001` and Project `AI_ORCHESTRATOR_URL=http://localhost:6001` in your ignored `.env`
files too. Docker setup does not rewrite those local files.

## Start, inspect and stop

From the repository root:

```powershell
docker compose config --quiet
docker compose up --build -d --wait --wait-timeout 240
docker compose ps
```

Open **http://localhost:3001**. Register/login, then submit a prompt only if you intend to spend provider
credits. Merely starting the stack makes no model request. Backend/Mongo ports are not published.
The existing host MongoDB and its data are not used or migrated. Start with a new account in this stack.

```powershell
# Follow a specific service's logs; Ctrl+C exits log viewing, not the containers.
docker compose logs -f project-service

# Stop/remove this stack's containers and network, retaining the Mongo volume.
docker compose down
```

Do **not** add `-v` to `down` unless you intentionally want to delete the stack's saved database.
Mongo is unauthenticated inside this local network; no TLS/production hardening is claimed.
Health checks plus `depends_on: condition: service_healthy` order startup. They are not ongoing failure
recovery, durable jobs, or proof of provider availability. `init: true` helps forward signals/reap child processes.

If 3001 is already occupied, do not stop someone else's server. Choose another host port:

```powershell
$env:AGENTFORGE_WEB_PORT='3104'
docker compose up --build -d --wait --wait-timeout 240
# Open http://localhost:3104 instead. Remove the override after stopping if no longer needed:
# Remove-Item Env:AGENTFORGE_WEB_PORT
```

## Editing code/configuration

Images use the repository root as their build context so the shared npm lockfile/workspace metadata
remain consistent. Each app installs only its selected workspace. Source is copied after dependencies
to reuse the installation layer. Application processes run as the unprivileged `node` user.

This first setup deliberately has **no host source bind mounts**. A host file edit is not live-synced:

```powershell
docker compose up --build -d project-service
```

Auth/Project/AI/Next use their development commands. Execution retains its existing compiled, multi-stage
image; its Dockerfile now includes all workspace manifests. These images are not optimized production
artifacts. Do not mount the repository over `/app`: it can hide container dependencies and reintroduce secrets.
Compose Watch/live sync can be a separate small learning step later.

Next's workspace directory is explicitly owned by `node`, including the parent directory created by the
earlier manifest COPY. Otherwise development startup fails with `EACCES` when creating `.next/dev` even
though the source files themselves were copied with `--chown`. Do not fix that by running Next as root.

After changing a backend `.env`, recreate that service to load the new runtime values:

```powershell
docker compose up -d --force-recreate ai-orchestrator-service
```

A plain `restart` does not reload Compose's env_file configuration. Recreate Next too when intentionally
restarting its upstream services if old keep-alive proxy connections produce a transient reset.

## Repeatable checks without provider credits

```powershell
# Four config checks; needs Docker Compose CLI, but no running containers/provider calls.
node --test tests/compose.config.test.mjs

# Real six-container HTTP/Mongo smoke test; Docker Engine must be running.
node scripts/verify-compose.mjs
```

The smoke runner owns project `agentforge-compose-smoke`, host port 3103 and its own named volume.
It refuses existing containers for that project, an occupied port, or nonempty dedicated databases.
`tests/compose.smoke.yaml` forces `agentforge_test_compose_auth` / `agentforge_test_compose_projects`
and replaces Gateway auth with a dummy key; no valid model credential is supplied to this AI container.

The check covers login-page HTTP rendering, registration/login, refresh-cookie forwarding, protected
401s, owned draft creation/read/list, empty revision history and internal AI authorization rejection.
An authenticated Project-to-AI request with an empty invalid body must return 400 before model invocation.
No public generation attempt or valid model request is sent. It recreates the containers, reads the same persisted draft, and verifies
zero Generation/Revision records. This is real Next/Auth/Project/Mongo evidence, not provider quality evidence.
The test client closes its HTTP connections because it intentionally destroys/recreates the servers;
it never automatically retries a write. Network failures identify the path/error code, not tokens/bodies.

Finally it removes only its UUID-named test account and owned records, confirms zero counts, and runs
`down` **without deleting volumes**. Unknown records are preserved and cause a nonzero result. Hard OS
termination can bypass cleanup; inspect a refused test volume rather than dropping it to hide a failure.
Test/health success does not prove real AI output, build/preview execution or production readiness.

## Troubleshooting

- **Auth startup failure:** check required Auth keys/expiry values are present; never paste their values into chat.
- **Project API returns 401 after login:** check the Auth/Project access-secret pair matches.
- **AI internal request returns 401:** check the Project/AI internal-token pair matches.
- **Gateway errors during generation:** check actual Gateway authentication, credits, model access and rate limits.
- **Cannot open backend ports on localhost:** expected; use `docker compose exec` or the frontend proxy.
- **Fresh Docker login list is empty:** expected; this stack has a separate database volume, not host records.

## Verification evidence

Executed on 2026-10-22 on `chore/local-docker-compose`:

| Check | Actual result |
| --- | --- |
| All five application image builds | Passed; Auth/Project learner edits retained, Project EXPOSE corrected to 3000. |
| Compose config tests | 4/4 passed: service/build definitions, unpublished backend ports, health/DNS/volume wiring, scoped installs/non-root/ignore policy. |
| Isolated six-container smoke | Exit 0: actual Next proxy/Auth/session/draft/history flow, 401/400 AI boundary guards, zero generations, same draft after full container recreation. |
| Scoped test cleanup | All four dedicated collection counts zero; test containers/network removed, named volume retained. |
| Image inspection | All five application images ran with UID 1000; inspected app/root directories contained no `.env*` files. Fixed frontend workspace is writable as node. |
| Backend checks | Auth/Project builds; AI and Execution typechecks/builds passed. |
| Frontend checks | Unit 10/10, lint and production build passed. |
| Normal local stack | Six services healthy; only `127.0.0.1:3001` published. Its separate database had zero users/projects/generations/revisions after verification. |
| Browser | Login screenshot inspected; unauthenticated workspace redirected to login. Observed refresh 401 is expected without a session, not a provider error. No normal-stack test account was created. |

Ignored artifacts under `output/playwright/`: `compose-build.log`, `compose-smoke-transport.log`,
`compose-frontend-build.log`, `compose-local-start.log`, `compose-local-login.png` and login/protected snapshots.
The smoke account/refresh-token and returned JWTs are never printed. No paid/live model request was made.
The production Next build above is a validation check; the running Docker frontend is still development mode.

Failures were not hidden: initial startup exposed Fetch's blocked port 6000 (raw HTTP returned 200),
then Next cache `EACCES` from the existing root-owned workspace parent. Both received Docker config/image
fixes. After the first successful draft flow, the initial post-recreation HTTP read failed; the smoke
client now closes its connections around intentional server replacement, without retrying writes or
weakening persistence assertions. The complete final smoke run passed with those fixes.

**Release limitation:** the existing lockfile/dependency graph was not upgraded. A read-only
`npm audit --workspace nextjs-boilerplate --omit=dev --json` reported 2 high and 1 critical vulnerabilities
(packages reported: next, sharp, source-map-js). Installation logs also contain broader dependency warnings.
These are unresolved release risks, not a claim that Docker introduced or fixed them. Review/remediate them
before any public deployment; this task did not run a breaking `npm audit fix --force`.

Real provider authentication/output quality, generated-project builds/execution, queue durability and
production security remain unverified. Health/image/test success is not proof of those capabilities.

References: [Compose networking](https://docs.docker.com/compose/how-tos/networking/),
[startup readiness](https://docs.docker.com/compose/how-tos/startup-order/),
[runtime environment](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/).
