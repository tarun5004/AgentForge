# AgentForge V1 — Observability Documentation

## 1. Correlation

Ingress creates or forwards X-Request-Id. Every service log, queue message, generation record, and run event carries it. Generation and execution also have durable ids.

## 2. Structured log fields

Required fields: timestamp, level, service, environment, requestId, userIdHash when available, route or operation, latencyMs, statusCode, errorCode.

AI fields: generationId, provider, model, policyVersion, stage, inputTokens, outputTokens, fallbackUsed.

Execution fields: runId, revisionId, jobName, status, durationMs, exitCode, cleanupStatus.

Never log access tokens, refresh tokens, passwords, provider API keys, full prompt text, or unredacted generated source by default.

## 3. Metrics

| Metric | Alert condition |
| --- | --- |
| HTTP 5xx ratio | above 2% for 10 minutes |
| Auth login failure spike | above baseline plus rate-limit activity |
| Generation failure ratio | above 20% for 15 minutes |
| Token budget rejections | unexpected spike |
| Provider fallback rate | above 10% |
| Execution timeout/cleanup failure | any repeated failure |
| Queue age | above 2 minutes |

## 4. Dashboards

- Service health: traffic, latency, errors, dependencies.
- Product flow: projects created, generations ready/failed, runs successful/failed.
- AI cost: tokens and latency per provider, model, mode, user hash, and feature.
- Sandbox safety: active Jobs, timeout count, policy rejection count, cleanup lag.

## 5. Incident response

1. Identify requestId, generationId, or runId.
2. Check service logs and queue state without exposing raw secrets.
3. Disable provider route or execution endpoint through configuration if needed.
4. Preserve minimal evidence, remediate, and record the decision in ADR.
