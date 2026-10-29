# Repository Instructions

## Project Structure

- `auth-service/`: Express and TypeScript authentication API.
- `project-service/`: Express and TypeScript project orchestration API.
- `ai-orchestrator-service/`: Express and TypeScript AI generation and output-validation API.
- `execution-service/`: Express and TypeScript execution-service foundation.
- `nextjs-boilerplate/`: Next.js frontend.
- `k8s/`: Kubernetes deployment, service, ingress, RBAC, and secret templates.

## General Rules

- Use TypeScript and preserve the existing module style in each service.
- Write beginner-friendly code with clear names, simple control flow, and small functions.
- Prefer the simplest correct solution and avoid unnecessary abstractions, dependencies, and repeated code.
- Keep changes focused and do not modify unrelated files.
- Preserve public APIs unless the task requires a contract change.
- Never commit real credentials, tokens, private keys, or local `.env` files.
- Document required environment variables in the relevant `.env.example` file.
- Keep controllers thin and place reusable business logic in services or existing domain modules.
- Do not add dependencies when the existing toolchain is sufficient.
- Add or update tests when changing behavior.

## Code Comments

- Add a short comment above each function explaining its purpose and the reason the logic is needed.
- For obvious functions, keep the purpose/why comment to one short line; do not repeat the function name or narrate its syntax.
- Keep comments focused on intent and tradeoffs, not on obvious syntax.
- Update comments whenever the behavior or reasoning changes.
- Do not use comments to replace clear naming or documentation.

## Documentation

- Keep the relevant `README.md` and API documentation ready for a new developer.
- Document setup, environment variables, commands, endpoints, important assumptions, and known limitations.
- Update documentation in the same change when behavior, configuration, or public APIs change.

## Engineering Behavior

- Behave like a careful, intelligent senior engineer: inspect the relevant code, identify the root cause, make the smallest safe change, and validate it.
- State important assumptions and mention risks or test gaps briefly.
- Prefer real behavior tests and focused validation over superficial checks.

### Root-cause fixes and minimal code

- Reproduce a bug and trace its cause before changing code. Fix the responsible existing module; do not add a wrapper, fallback, or parallel workflow merely to hide the symptom.
- Reuse existing files by default. Create a file only for a distinct, necessary responsibility that cannot stay readable in an existing module; explain that reason before adding it.
- Before removing code, check imports, routes, scripts, tests, and compatibility callers. Preserve recoverable copies of uncommitted work before deleting it.
- Prefer fewer moving parts and clear control flow, not compressed one-liners or giant files. Keep useful tests and security checks even when they add lines.
- Tell the user the finding, proposed change, and reason before each focused slice. Ask when missing requirements would materially change behavior; do not guess business rules.
- Explain meaningful changes briefly enough for the student to describe their purpose, data flow, and tradeoffs in an interview.
- Report evidence precisely: unit tests, real-service integration, real-model generation, build success, and working Preview are separate claims. Never substitute one for another.

## Response Style

- Use the fewest tokens needed to be useful and avoid repeating context.
- Respond with short, clear bullet points when explaining work.
- Put the result first, followed by changed files, validation, and any remaining issue.
- Do not provide long explanations unless the user asks for detail.
- Include a compact explanation of why the approach works for non-trivial changes; brevity must not remove the learning value.

## Validation

Run the narrowest relevant command before completing a change:

- Auth service: `npm --workspace auth-service run build`
- Project service: `npm --workspace project-service run build`
- AI Orchestrator: `npm --workspace ai-orchestrator-service run typecheck` and `npm --workspace ai-orchestrator-service run build`
- Execution service: `npm --workspace execution-service run typecheck` and `npm --workspace execution-service run build`
- Frontend lint: `npm --workspace nextjs-boilerplate run lint`
- Frontend build: `npm --workspace nextjs-boilerplate run build`

When behavior changes, also run the relevant available tests; a successful build alone does not prove business logic is correct. Project integration tests require an explicitly selected, dedicated test database, never the normal application database. If a relevant test suite is missing or cannot run, report that gap rather than claiming verification.

## Security

- Do not log passwords, JWTs, cookies, database credentials, or Kubernetes secrets.
- Validate all external input at the API boundary.
- Keep authentication and authorization checks on protected routes.
- Use Kubernetes secret references instead of hardcoding secret values in manifests.

## Git

- Do not create commits unless explicitly requested.
- Before editing a service or the frontend, create a focused feature branch for that scope; include only its relevant code, tests, and documentation.
- Prefer branching from clean, up-to-date `main` after dependencies have merged. If a dependency is still unmerged, explain the stacked-branch option and confirm the branch strategy before coding; do not silently include another service's changes in an independent PR.
- Do not push, open pull/merge requests, merge, or delete branches unless explicitly requested. See `docs/GIT_WORKFLOW.md` for the service-scoped workflow.
- Use focused conventional commit messages, for example:
  - `feat: add project creation endpoint`
  - `fix: validate refresh token`
  - `chore: update kubernetes manifests`
