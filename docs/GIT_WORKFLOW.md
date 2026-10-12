# AgentForge — Service-scoped feature branches

Create a branch **before editing** the service. Keep one service's code plus its directly related tests/docs in each focused branch; do not create unused branches for services you are not changing.

| Scope | Example branch |
| --- | --- |
| Project Service | `feature/project-service-revision-publication` |
| AI Orchestrator | `feature/ai-orchestrator-<feature>` |
| Frontend | `feature/frontend-project-history` |
| Auth Service | `feature/auth-service-<feature>` |
| Execution Service | `feature/execution-service-<feature>` |

Git branches are snapshots of the **whole repository**, not permanently isolated service folders. Service separation comes from keeping each branch's changes and pull request focused.

## Small workflow

1. Check `git status --short` and finish/preserve existing work. Start from clean, up-to-date `main` after the dependency branch has been reviewed and merged.
2. Create the branch, for example `git switch -c feature/frontend-project-history`.
3. Implement only that service's feature; add purpose/why comments for non-obvious decisions and verify its tests/build. Stage explicit paths, not secrets or unrelated work.
4. Make meaningful local commits only when explicitly requested. Report their hashes and any checks not run; ordinary implementation may remain uncommitted for review.
5. **When explicitly requested later:** push with `git push -u origin <branch>`, open a GitHub pull request (the equivalent of a merge request), include behavior/tests/risks, review checks, then merge into `main`.

Do not auto-commit, push, open PRs, merge or delete branches as part of ordinary implementation. Keep the service branch until the user asks for those steps.

If two services must change a contract together, propose compatible, ordered PRs first. A dependent stacked branch must declare its base and be rebased/retargeted after its dependency merges; otherwise wait and branch from merged `main`. Do not accidentally include another service's unfinished commits in a supposedly independent PR.

Slice 4 backend publication was merged into `main` through PR #1. Its branch remains available; no branch deletion is implied by a merge.

Slice 5 started as the user-approved stacked `feature/frontend-project-history` branch. Since its backend dependency is now merged, frontend PR #2 targets `main` directly and includes no new backend application edits. The old instruction to initially target the backend branch is historical, not the current PR target. Commit/push/merge delivery was explicitly requested; unrelated `.github/` user work remains excluded. Future independent frontend slices should branch from updated `main` after PR #2 merges.
