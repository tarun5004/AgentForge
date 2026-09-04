# AgentForge V1 — Deployment Architecture

## 1. Environments

| Environment | Purpose | Compute |
| --- | --- | --- |
| local | learning and integration | Docker Compose plus local Kubernetes option |
| staging | public demo validation | managed containers, small database, isolated sandbox namespace |
| production | post-V1 | separate accounts/namespaces and hardened observability |

## 2. Runtime topology

~~~text
Vercel-hosted Next.js web
          |
   HTTPS ingress / API gateway
          |
 Auth | Project | AI Orchestrator | Execution
          |              |              |
     MongoDB        Provider gateway    Redis + Kubernetes Jobs
~~~

The web deployment has no provider secrets. Service secrets are stored in the deployment platform secret manager. The execution workload receives neither database credentials nor provider keys.

## 3. Free-first deployment approach

- Web: Vercel Hobby for a personal portfolio demo.
- APIs: Cloud Run or a comparable scale-to-zero container platform for the three non-execution services.
- Database: one MongoDB Atlas Free cluster, with logical service databases.
- Queue/cache: managed free-tier Redis during demo use, or local Redis for development.
- Execution: local Kubernetes for development. A public execution service is enabled only after namespace, network policy, quota, and Job security controls pass.

Free tiers change. Deployment documentation must be checked against the provider's current limits before a public launch; enforce provider budgets and maximum instance/job concurrency.

## 4. Secrets and configuration

- .env.example documents names only; real values are never committed.
- Separate keys for local, staging, and production.
- Rotate a provider key immediately if it reaches logs, Git history, browser network output, or screenshots.
- Every service fails fast when required variables are missing, without printing their values.

## 5. Student/testing credits

Use free tiers for initial evaluation, not as an availability guarantee:

- Gemini Developer API free tier for limited testing.
- Vercel AI Gateway monthly free credit for multi-provider experiments.
- GitHub Models and GitHub Student Developer Pack offers when available to the student's account.
- Azure for Students or cloud trial credit only after verifying account eligibility and service availability.

Never automate account creation or assume a student subscription grants access to a specific paid model.
