# Repository tooling operations runbook

Status: current repository-wide operational guide
Updated: 2026-08-29

This document stores durable operational knowledge about repository tooling, GitHub/CI integration failures, recurring tool limitations, and verified workarounds.

It is not a feature roadmap, an incident log, or a dump of transient errors. Add an entry only when the behavior is likely to recur, is costly to rediscover, or has a non-obvious safe workaround.

## How to use this runbook

Before repeatedly retrying a failing repository/GitHub/CI tool path:

1. Read `AGENTS.md`, especially the repeat-action guard and GitHub workflow policy.
2. Search this runbook for the failing operation/error signature.
3. Re-fetch mutable repository/PR/workflow state before acting.
4. Prefer the smallest verified workaround that preserves normal GitHub audit/history semantics.
5. After resolving a new recurring failure, add or update one entry here instead of leaving the knowledge only in chat or an old Issue comment.

## Entry format

Each durable entry should record:

- Operation / symptom
- Known error signature
- Root cause or strongest current explanation
- Safe workaround
- Required permissions / preconditions
- What not to do
- Verification / cleanup
- Last verified date

Do not record credentials, secret values, access tokens, private user data, or raw sensitive logs here.

---

## GitHub PR Ready-for-review transition can fail through the connector

Operation / symptom:

- A draft PR is otherwise merge-ready, but the connected GitHub `mark pull request ready for review` operation fails before the PR becomes Ready.

Known error signature observed on 2026-08-29:

- GraphQL response/schema incompatibility involving `Repository.fullDatabaseId`.

Important distinction:

- This is not known to be a normal GitHub PR limitation and should not be assumed to happen on every PR.
- It is a connector/integration failure mode that can recur when the connector's GraphQL response shape drifts from GitHub's current schema.
- Always try the normal Ready operation first. Use the fallback only after the failure is confirmed and the PR remains `draft=true`.

Verified fallback:

1. Confirm the exact target PR number, exact PR head SHA, and current main SHA.
2. Confirm the normal Ready mutation failed and re-fetch the PR to prove it is still draft.
3. Prefer an existing authenticated GitHub path if one is already available.
4. If no such path exists, a temporary one-shot GitHub Actions workflow may be used as a repository-local fallback.
5. The workflow must target only the intended PR and use the minimum practical permissions.
6. For the observed Ready mutation, `pull-requests: write` alone was insufficient. The successful one-shot workflow required both:
   - `pull-requests: write`
   - `contents: write`
7. Run the Ready transition with GitHub CLI/GraphQL from that workflow.
8. Re-fetch the PR and require `draft=false` before any merge attempt.
9. Delete the one-shot workflow immediately after it succeeds.
10. Verify the cleanup commit contains no unintended product changes before continuing.

Observed failed fallback:

- `pull-requests: write` with `contents: read` was insufficient for `markPullRequestReadyForReview` and the job failed.

What not to do:

- Do not create a replacement PR solely to escape Draft state.
- Do not merge by directly rewriting/updating `main` in a way that loses the PR merged audit trail.
- Do not leave the temporary elevated-permission workflow in the repository after the one-shot operation.
- Do not repeatedly call the same broken Ready mutation with identical conditions after the repeat-action guard is triggered.

Verification / cleanup:

- PR reports `draft=false`.
- exact head SHA is unchanged.
- temporary workflow is removed.
- current main/diff is re-fetched because concurrent merges may have happened while the fallback was running.
- normal merge gates are re-evaluated before squash/merge.

Last verified: 2026-08-29, PR #234.

---

## Post-merge integration checks can reveal failures that individual PR checks missed

Operation / symptom:

- Two independently green PRs merge close together, then a main-branch quality gate fails only after their combined changes are present.

Observed example on 2026-08-29:

- PR #221 and PR #234 each passed UI Quality independently.
- After both were on main, aggregate raw CSS exceeded the repository budget by about 2.5 KiB, while gzip, largest CSS asset, and all JavaScript budgets remained within limits.

Safe response:

1. Treat the main-branch failure as real integration evidence; do not dismiss it because both PRs were individually green.
2. Read the exact failed job logs and classify whether the failure is a production defect, stale contract/budget, harness issue, or infrastructure failure.
3. If the guard itself is stale, recalibrate only the specific stale threshold and preserve the other independent guards.
4. Put the repair through a focused PR and verify the exact head before merge.
5. Re-check post-merge main state when the failing gate is part of the repository's definition of done.

What not to do:

- Do not delete valid UI rules solely to satisfy a stale aggregate threshold.
- Do not broadly raise all bundle budgets when one metric alone is stale.
- Do not convert a post-merge failure into a success report without diagnosis and correction.

Last verified: 2026-08-29, PR #240.

---

## Maintenance rule for new tooling knowledge

Add a new entry when at least one of these is true:

- the same class of failure has happened more than once;
- rediscovering the workaround required significant investigation;
- the safe workaround is non-obvious or permission-sensitive;
- a tool reports misleading/incomplete state that can cause unsafe repository writes;
- an external integration has a stable limitation that changes how agents should operate.

Prefer updating an existing entry when the new evidence is the same failure class. Keep historical one-off noise in Issues/PRs/Actions rather than growing this file without bound.
