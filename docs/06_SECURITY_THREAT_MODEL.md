# AgentForge V1 — Security Threat Model

## 1. Assets to protect

- User credentials, sessions, and personal project content.
- Provider API keys and model quotas.
- Project ownership boundaries.
- Kubernetes cluster, node resources, and internal service credentials.
- Execution logs and generated source.

## 2. Trust boundaries

1. Browser to public ingress.
2. Ingress to each service.
3. Project service to queue and AI Orchestrator.
4. Execution service to Kubernetes API.
5. Runner Job to its restricted filesystem and network.
6. AI Orchestrator to external model providers.

## 3. Primary threats and controls

| Threat | Control |
| --- | --- |
| Credential stuffing | Password hashing, rate limits, generic login failure, short access-token TTL |
| Stolen refresh token | HTTP-only secure cookie, rotation, server-side session hash, logout revocation |
| IDOR between projects | Verify subject and project ownership in Project and Execution services; never trust a client projectId alone |
| Provider-key exfiltration | Keys only in server secrets; no NEXT_PUBLIC key; redacted logs |
| Prompt injection | System policy is server-owned; generated output validated as data, not executed instructions |
| Path traversal | Allowlist generated file paths; reject dot segments and absolute paths |
| Malicious dependency/script | Dependency allowlist and fixed package scripts |
| Sandbox escape | No privileged containers, host mounts, Docker socket, host network, or arbitrary image |
| Resource exhaustion | Per-user quotas, concurrency cap, Job deadline, CPU/memory limits, queue backpressure |
| Data leakage in logs | Redaction, log-size cap, short retention, no raw provider content by default |
| SSRF/network abuse from generated code | Egress-deny NetworkPolicy and no cloud metadata access |

## 4. Authentication and authorization

- Auth service signs access tokens with an asymmetric private key.
- Services verify via cached JWKS public key and require issuer, audience, expiry, and allowed algorithm.
- Roles in V1: user and admin. Admin endpoints are separate and absent from public UI.
- Internal service calls use workload identity or service credentials, not an end-user token alone.

## 5. Sandbox baseline

Every run is a Kubernetes Job in a dedicated namespace. The runner user is non-root; privilege escalation is disabled; root filesystem is read-only; capabilities are dropped; egress is denied by default; execution has timeout and TTL cleanup.

## 6. Security test gates

- Authz tests for every project and run endpoint.
- Static scan for secrets and unsafe Kubernetes settings.
- Contract tests for path/dependency rejection.
- Container policy test proving rejected privileged fields.
- Dependency and image vulnerability scan in CI.
