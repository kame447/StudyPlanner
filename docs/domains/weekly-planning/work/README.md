# Weekly Planning active work

Status: active-work index
Updated: 2026-09-05

This directory contains durable unfinished task/checkpoint records only when an Issue alone is insufficient for the technical acceptance detail.

Current durable records:

- `20260728-trace-production-recovery.md` — Issue #89
- `20260731-approval-operational-rollout.md` — Issue #51
- `20260731-personalization-rollout.md` — Issue #47
- `20260731-synced-conversation-session-store.md` — Issue #47 related cloud/session authority
- `20260731-trace-privacy-and-lifecycle.md` — Issue #45

Issue-only active scopes such as #128, #136 and #152 do not need duplicate task Markdown unless durable technical detail/checkpoints exceed what should live in the Issue.

Issue #52 was completed by PR #283 and is no longer an active scope. Its implementation history remains in the closed Issue/PR and repository history rather than in this active-work index.

Current execution ordering is owned by [`../roadmap/current.md`](../roadmap/current.md). Issue #136 / Draft PR #275 remains the active semantic-regression implementation path on `fix/issue136-semantic-regressions`; exact HEAD, verification state, and next action are owned by Issue #136 / PR #275 and must be re-fetched before resuming. Issue #152 / PR #174 remains a separate long-lived adversarial validation scope and must be reconciled with current main before its historical checks are reused.

Issue #246 is a special case where product/runtime requirements are canonicalized in [`../spec/learning-consultation-and-advice.md`](../spec/learning-consultation-and-advice.md). Phase 1A foundation was merged by PR #280; there is no active #246 branch at this checkpoint. Keep implementation status in Issue #246 rather than recreating the former branch or adding another duplicate work Markdown.

Cross-domain Issue #164 belongs to [`../../client-runtime/`](../../client-runtime/README.md).

When a record completes, move it to `docs/archive/work/closed/`. When replaced, move it to `docs/archive/work/superseded/`. Do not keep completed files here merely for history.
