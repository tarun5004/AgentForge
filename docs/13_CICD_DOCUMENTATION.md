# AgentForge V1 — CI/CD Documentation

## 1. Pull request pipeline

1. Install dependencies from lockfiles.
2. Format check, lint, and typecheck.
3. Run unit and service tests.
4. Validate OpenAPI and shared contracts.
5. Scan dependencies, source secrets, container images, and Kubernetes manifests.
6. Build each service image and the Next.js application.
7. Publish immutable images only from protected main branch.

## 2. Deployment pipeline

1. Deploy to staging with a release identifier.
2. Run health/readiness checks and a smoke generation using provider fixtures.
3. Run one budget-capped real-provider smoke test only when explicitly enabled.
4. Promote the same image digest to the demo environment.
5. Record deployment version, rollback target, and schema compatibility status.

## 3. Rollback

- Application rollback means redeploying the previous immutable image digest.
- Database changes must be additive and backward compatible for one release.
- Queue consumers must accept both current and previous event schemas during rollout.
- Immediately disable execution if runner policy checks fail; do not roll forward an unsafe sandbox.

## 4. Required repository controls

- Branch protection on main.
- Required checks cannot be bypassed for production/demo deployment.
- Secrets come from CI/deployment secret store, never repository variables.
- Generated artifacts, local env files, coverage, and logs remain ignored by Git.
