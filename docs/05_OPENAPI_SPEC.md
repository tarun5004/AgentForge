# AgentForge V1 — Public API Contract

Base path: /api/v1. Every protected route requires an access token. Responses include X-Request-Id.

## Auth service

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /auth/register | Create user and session |
| POST | /auth/login | Start session |
| POST | /auth/refresh | Rotate refresh token |
| POST | /auth/logout | Revoke current session |
| GET | /auth/me | Current user |
| GET | /.well-known/jwks.json | JWT verification keys |

## Project service

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /projects | Create project |
| GET | /projects | List caller's projects |
| GET | /projects/{projectId} | Read owned project |
| PATCH | /projects/{projectId} | Rename/archive project |
| DELETE | /projects/{projectId} | Request project deletion |
| POST | /projects/{projectId}/generations | Start generation |
| GET | /projects/{projectId}/generations/{generationId} | Generation status |
| GET | /projects/{projectId}/revisions | List revisions |
| GET | /projects/{projectId}/revisions/{revisionId} | Read revision files |

Version Zero create-project request (currently exposed at `POST /api/projects`):

~~~json
{ "prompt": "Build a portfolio for a frontend developer" }
~~~

Successful response: HTTP 201 with a `project` containing `id`, derived `name`, `initialPrompt`, `template`, `status`, and `createdAt`. The authenticated user's id becomes the internal `ownerId` and is never accepted from the request body.

Version Zero create-generation request (currently exposed at `POST /api/projects/{projectId}/generations`):

- Requires the normal bearer access token.
- Requires an `Idempotency-Key` header (maximum 100 characters).
- Has no request body because the owned project's saved prompt is the source of truth.

Successful response: HTTP 201 with a ready generation, immutable `revisionId`, summary, validated files, provider/model metadata, latency, and token usage. Repeating a completed request with the same idempotency key returns the saved result instead of calling the model again.

The internal call from Project Service to AI Orchestrator is `POST /internal/generations`. It requires `X-Internal-Service-Token` and is not a browser-facing API.

Planned V1 asynchronous request:

~~~json
{
  "prompt": "Build a portfolio for a product designer",
  "mode": "auto",
  "baseRevisionId": "optional revision id"
}
~~~

The V1 queue-backed response will use HTTP 202 with generationId, status queued, and a status URL.

## Execution service

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /runs | Queue validated revision run |
| GET | /runs/{runId} | Read terminal/progress state |
| GET | /runs/{runId}/logs | Read sanitized logs |
| POST | /runs/{runId}/cancel | Cancel caller-owned run |

Create run request:

~~~json
{ "projectId": "id", "revisionId": "id" }
~~~

## Error contract

~~~json
{
  "type": "https://agentforge.dev/errors/validation",
  "title": "Validation failed",
  "status": 400,
  "code": "VALIDATION_ERROR",
  "requestId": "uuid"
}
~~~

Common codes: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, TOKEN_BUDGET_EXCEEDED, PROVIDER_UNAVAILABLE, SANDBOX_REJECTED.
