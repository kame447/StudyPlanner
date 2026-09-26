# Weekly Planning active work

Status: active-work index
Updated: 2026-09-26

This directory contains durable unfinished task/checkpoint records only when an Issue alone is insufficient for the technical acceptance detail.

Current durable records:

- `20260728-trace-production-recovery.md` — Issue #89
- `20260731-approval-operational-rollout.md` — Issue #51
- `20260731-personalization-rollout.md` — Issue #47
- `20260731-synced-conversation-session-store.md` — Issue #47 related cloud/session authority
- `20260731-trace-privacy-and-lifecycle.md` — Issue #45
- `20260926-issue333-japanese-semantic-evaluation.md` — Issue #333（#305 canary 前の日本語品質 gate、human review 手順）

Issue-only active scopes such as #128, #152, [#305](https://github.com/kame447/StudyPlanner/issues/305) and [#333](https://github.com/kame447/StudyPlanner/issues/333) do not need duplicate task Markdown unless durable technical detail/checkpoints exceed what should live in the Issue.

Issue #52 was completed by PR #283 and is no longer an active scope. Its implementation history remains in the closed Issue/PR and repository history rather than in this active-work index.

Current execution ordering is owned by [`../roadmap/current.md`](../roadmap/current.md). Issue #136 / PR #275 is complete; its former semantic-regression branch is not a current implementation queue. Issue #152 remains active, but PR #174 is closed and its integration branch is frozen evidence, not the merge path. The replacement PR chain and current verification gates are tracked in the roadmap and Issue #152. Re-fetch that checkpoint and the exact target HEAD before reusing any result; do not merge or remove the retained evidence branch as ordinary cleanup.

Issue #305 retains the Jev integration design and rollout decision. Its initial default-off implementation was merged through PR #332; that completed branch must not be reused for the next evaluation. Issue #333 owns Japanese semantic evaluation, including the same-case Jev/Luna comparison, Gemini first-pass review, human-reviewed gold and tuning/holdout separation. Its current implementation branch and child checkpoints belong in #333. Keep provider/privacy, security and shared telemetry with #187, #152 and #213. The runtime remains off by default, and neither merging PR #332 nor passing mock tests establishes Japanese quality or production activation.

Issue #246 is a special case where product/runtime requirements are canonicalized in [`../spec/learning-consultation-and-advice.md`](../spec/learning-consultation-and-advice.md). Phase 1A foundation was merged by PR #280; there is no active #246 branch at this checkpoint. Keep implementation status in Issue #246 rather than recreating the former branch or adding another duplicate work Markdown.

Cross-domain Issue #164 belongs to [`../../client-runtime/`](../../client-runtime/README.md).

When a record completes, move it to `docs/archive/work/closed/`. When replaced, move it to `docs/archive/work/superseded/`. Do not keep completed files here merely for history.
