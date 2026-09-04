# AgentForge V1 — Technical Design Document

## 1. Repository target

~~~text
apps/
  web/                    Next.js App Router frontend
services/
  auth-service/
  project-service/
  ai-orchestrator-service/
  execution-service/
packages/
  contracts/              versioned DTOs and JSON schemas
  config/                 shared non-secret configuration helpers
  logger/                 structured logging and redaction
infra/
  k8s/
  compose/
docs/
~~~

The present repository is a scaffold. V1 migration preserves the existing auth and project foundations but replaces raw Pod creation with an execution-job contract.

## 2. Backend conventions

- TypeScript, Node.js, Express or Fastify per service; do not share service business logic.
- Controller -> service -> repository layering.
- Zod schemas at every network boundary.
- RFC 7807-style error response with a stable error code and request ID.
- Pino structured logs with secret redaction.
- OpenAPI generated from the public contract or maintained in lockstep.

## 3. Frontend conventions

- Next.js App Router with Server Components by default.
- Client Components only for editor, interactive generation state, and preview controls.
- Route Handlers are allowed only as web-specific BFF helpers; they must not replace service ownership.
- Every remote screen has loading, empty, and error states.
- Provider and service URLs are public configuration only; no secret starts with NEXT_PUBLIC_.

## 4. Generated-project contract

The AI returns a JSON object containing a short summary, file array, approved dependencies, and optional user-facing notes. Each file has path, content, and action fields.

Validation rejects path traversal, binary content, files outside the approved allowlist, unsupported dependencies, environment variable reads, server actions, route handlers, and package scripts other than the approved build/run commands.

## 5. Model adapter interface

~~~text
generate(request: GenerationRequest): Promise<GenerationResult>
health(): Promise<ProviderHealth>
~~~

Adapter implementations are provider-specific. The routing policy is configuration, not UI input. The client receives a product mode (Auto, Economy, Quality), never an arbitrary model ID.

## 6. Execution technical controls

- Create Kubernetes Jobs, never raw Pods.
- Trusted immutable runner image and non-root user.
- Read-only root filesystem; writable temporary volume only.
- No host networking, host paths, privileged mode, or Docker socket.
- Namespace-scoped Role; NetworkPolicy denies egress by default.
- Active deadline, CPU/memory limits, TTL-after-finished, and a per-user concurrency cap.

## 7. Dependency decisions

Use the Vercel AI SDK plus a gateway/provider abstraction because the product requires consistent structured output, routing, and usage accounting. A handwritten provider layer would save a dependency initially but would duplicate streaming, provider error mapping, and schema integration.
