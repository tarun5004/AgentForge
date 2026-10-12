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

Current Slice 4 is on `feature/project-service-revision-publication`; AI, Auth, Execution and frontend application files remain unchanged. Its pull request and merge are later explicit actions, not completed work.

Slice 5 frontend work uses the user-approved stacked `feature/frontend-project-history` branch, based on the Slice 4 branch. Its future PR must initially target `feature/project-service-revision-publication` to show only frontend/test/docs changes. After that dependency merges, retarget/rebase as appropriate before reviewing a PR into `main`. Inherited backend commits are the dependency, not new frontend edits. Commit/push delivery was explicitly requested afterward; PR/merge remain separate actions. Unrelated `.github/` user work is preserved.
