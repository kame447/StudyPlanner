# Weekly Planning active work

Status: active-work index
Updated: 2026-09-01

This directory contains durable unfinished task/checkpoint records only when an Issue alone is insufficient for the technical acceptance detail.

Current durable records:

- `20260728-trace-production-recovery.md` — Issue #89
- `20260731-approval-operational-rollout.md` — Issue #51
- `20260731-personalization-rollout.md` — Issue #47
- `20260731-synced-conversation-session-store.md` — Issue #47 related cloud/session authority
- `20260731-trace-privacy-and-lifecycle.md` — Issue #45

Issue-only active scopes such as #52, #128, #136 and #152 do not need duplicate task Markdown unless durable technical detail/checkpoints exceed what should live in the Issue. Issues #269 and #270 are completed and are no longer active scopes; their merged contracts are part of the current main baseline.

Issue #246 is a special case where product/runtime requirements are intentionally canonicalized in [`../spec/learning-consultation-and-advice.md`](../spec/learning-consultation-and-advice.md). The pre-implementation documentation gate is closed; use Issue #246 for implementation tracking/checkpoints and keep the stable requirement in the canonical spec rather than creating another `work/` Markdown that copies it. Its implementation must consume the merged #269 planner-data availability and #270 atomic-turn boundaries rather than recreating them.

Cross-domain Issue #164 belongs to [`../../client-runtime/`](../../client-runtime/README.md).

When a record completes, move it to `docs/archive/work/closed/`. When replaced, move it to `docs/archive/work/superseded/`. Do not keep completed files here merely for history.
