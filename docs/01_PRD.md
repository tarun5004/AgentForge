# AgentForge V1 — Product Requirements Document

## 1. Product vision

AgentForge is a portfolio-grade, microservice-based AI application builder. A user describes a web experience in plain language, receives a constrained and validated Next.js project, can inspect every generated file, run it in an isolated environment, and iterate through focused change requests.

V1 is deliberately narrow: it generates frontend-only Next.js applications. It does not claim to generate production-ready databases, payments, secret management, or unrestricted backend code.

## 2. Problem

Code-generation demos often return a large code block that cannot be run, inspected, or safely changed. AgentForge demonstrates an engineering workflow instead: planning, structured generation, validation, execution, revision history, and observable model usage.

## 3. Target users

1. Student developer: creates a portfolio, landing page, dashboard UI, or frontend prototype.
2. Recruiter/interviewer: inspects the architecture, reliability controls, and generated result.
3. Builder: iterates on an existing generated project through small, reviewable changes.

## 4. V1 user journey

1. Sign up or sign in.
2. Create a project with a template and a natural-language prompt.
3. Select Auto, Economy, or Quality generation mode.
4. Receive a project plan and a generated file manifest.
5. Review files and diagnostics, then run a preview.
6. Ask for a focused revision; AgentForge changes only affected files.
7. View generation history, execution logs, token usage, and export the project.

## 5. In scope

- Email/password authentication with refresh-token rotation.
- Project CRUD and ownership enforcement.
- Three logical provider adapters: Google Gemini, OpenAI, and Mistral/DeepSeek-compatible routing through the configured AI gateway.
- Deterministic provider/model policy, fallback, token budgets, and generation audit records.
- Structured output: project plan, file manifest, and diagnostics; never an unbounded repository dump.
- Next.js frontend generation from approved templates and components.
- Sandboxed execution lifecycle, logs, timeout, and cleanup.
- Revision history, source export, and a polished dashboard.

## 6. Out of scope for V1

- Arbitrary language/runtime execution.
- User-supplied Docker images, shell access, or public inbound ports to run containers.
- Collaboration, billing, GitHub write access, mobile app, and production deployment of user-generated apps.
- Claims that a small model universally outperforms a frontier model.

## 7. Product principles

- Constrain the problem before increasing model size.
- Every generation must be inspectable and reproducible.
- Unsafe code executes only in an isolated, disposable workload.
- A generation failure returns actionable diagnostics, never a false success.
- User secrets and provider keys are never included in prompts, generated files, or logs.

## 8. Success metrics

| Metric | V1 target |
| --- | --- |
| First successful preview | at least 70% of supported prompts |
| Median initial generation latency | under 30 seconds |
| Generation requests with recorded provider usage | 100% |
| Unauthorized cross-project reads/writes | 0 |
| Sandbox jobs cleaned up after terminal state | 100% |
| Per-request hard token limit enforced | 100% |

## 9. Supported generation catalogue

- Marketing landing pages and portfolios.
- Multi-page dashboards using mock data.
- Forms, tables, filters, charts, and empty/loading/error states.
- Product UI redesigns from a written brief.
- Reusable React components and design-token themes.
- Small client-side utilities and browser games.

The generated application may use static or mock data only. A request for real authentication, databases, payments, or secret-bearing integrations is rejected or converted into an explicit UI-only mock.

## 10. Acceptance criteria

V1 is complete when a new user can create a project, generate a valid approved-template Next.js application, see lint/type/build diagnostics, start a restricted preview, request a small revision, view immutable revision history, and export the latest files.
