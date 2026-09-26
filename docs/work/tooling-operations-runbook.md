# Repository tooling operations runbook

Status: current repository-wide operational guide
Updated: 2026-09-26

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

## Cloudflare remote dev: Jev smoke transport failures

Verified on 2026-09-26 with Wrangler 4.140.0 and Worker compatibility date 2026-04-10.

The temporary preview upload succeeded, but direct Python HTTP readiness requests returned 403. Using Wrangler's returned `worker.fetch()` interface reached the preview and confirmed the Secret binding without reading its value. The precise source of the earlier 403 was not established; do not attribute it to the OpenRouter key or weaken production origin/auth guards. Use `scripts/jev-cloud-smoke.mjs`, which owns server startup, requests and cleanup through the same Wrangler instance.

The next failure was an immediate redirect-related TypeError from the Worker's outbound fetch, normalized by the adapter as `unavailable/network`. The configured runtime rejected `redirect: 'error'`. Use `redirect: 'manual'` and reject non-2xx responses without following Location. This preserves credential isolation; switching to automatic redirects is not an acceptable fix. Redirect regression tests cover 301/302/303/307/308.

Prerequisites are an existing authenticated Wrangler session and `OPENROUTER_API_KEY` registered as a Secret on the selected Worker. The optional smoke uses a short-lived authenticated remote dev script and a fixed synthetic authorization input; it does not publish production code or change routing. Never export the Secret or print raw provider responses, exception messages or headers. The harness stops the development server and removes temporary files on completion. Verify an actual validated decision and usage, not just preview upload HTTP 200; record gate abstention separately from successful transport. See README for the invocation.

## Wrangler production dry-run completes but the process does not exit

Verified on 2026-09-26 with Wrangler 4.140.0 (`npx --yes wrangler@4.140.0 deploy --dry-run --config workers/ai-proxy/wrangler.jsonc`).

Symptom: the output reaches `Total Upload`, the binding table and `--dry-run: exiting now.`, but the Node process stays alive with an open HTTPS connection to a Cloudflare address. The same run exited 0 about 40 minutes earlier on the same machine, and an older commit reproduced the hang afterwards, so it is environmental/post-exit network behaviour, not a code regression. `WRANGLER_SEND_METRICS=false` alone did not prevent it in this occurrence.

Workaround: bound the run (for example `perl -e 'alarm 240; exec @ARGV' npx ...`) and treat the build evidence as the complete output (upload size and expected bindings such as `JEV_MODE=off` / `JEV_CANARY_PERCENT=0`). Record that the exit code was not obtained; do not report it as exit 0. An alarm kills only the `npx` parent, so terminate leftover `wrangler deploy --dry-run` child processes afterwards. Confirm a regression suspicion by running the same command on the previous known-good commit in a temporary worktree before changing code.

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
