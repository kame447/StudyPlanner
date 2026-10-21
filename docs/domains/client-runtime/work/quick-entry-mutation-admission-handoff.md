# Quick Entry mutation admission

Status: active local candidate; full local verification passed, native/integration acceptance pending
Branch: `refactor/quick-entry-mutation-admission`
Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`; remote main confirmed unchanged before this checkpoint.
Related history: [Issue #437](https://github.com/kame447/StudyPlanner/issues/437), original lifetime fix `7e076254` and shared editor gate `fb852aef`.

## Boundary and preserved contracts

Quick Entry duplicated mounted/pending booleans in its linked-Actual and form-submit paths. It now uses the existing `useEditorMutation` gate already used by four other editors. The shared hook is unchanged. The user-keyed editor, payload transforms, date/material validation, close ordering, error propagation and submitting-state presentation remain unchanged. This consolidates existing protections; it is not a claim of a newly found production failure.

The admission token is created before the first await. Both save routes share the same token. Only the original mounted session may close or release its write; stale completion cannot unlock a newer editor. Drafts survive current-save rejection and can be retried.

Options considered: retain local booleans (lowest edit risk but duplicated lifecycle infrastructure), migrate to existing tested gate (smallest consolidation with direct contract proof), or create a new general submit abstraction (unnecessary payload/error coupling and wider risk). Existing behavior tests plus new baseline-first cases support the second. A mismatch in owner remount, same-render admission, retry or close/finally ordering would disprove equivalence.

## Verification checkpoint

- Before production changes: existing Quick Entry focus/lifetime/yearly tests, 20 passed.
- Added five regression cases against original production code: all 11 lifetime tests passed. New cases cover duplicate same-render submit with rejection/retry, linked/form races in both orders, retained submit after close/reopen, and old rejection while the next editor has a pending write.
- After facade reuse: 45 tests in Quick Entry focus/lifetime/yearly and MaterialQuickCreate passed.
- Broader source-reference selection: all 65 tests across 9 files passed, including HomeAddFlow, App bookshelf handoff, Firebase admission integration, preload and weekly-planning orchestration architecture.
- `npm run typecheck:app:full`: exit 0, fresh non-incremental app check.
- `git diff --check`: exit 0.
- Independent regression review: no blocker in lifecycle, token release, owner replacement or test semantics.

Test commands used `DEV_LAN_HOST=127.0.0.1 TZ=UTC npm run test:run -- <listed files>`. Dependencies are the same canonical calendar-worktree current-lock npm-ci seed used by this batch: Node24.19.0, Vitest3.2.7, Vite6.4.3, TypeScript5.9.3, React18.3.1. No dependencies/configuration/shared test fixtures changed. These are focused feedback results, not a full integration proof.

## Pre-verification checkpoint / exit criteria

The parent integration owner schedules exact-content `npm run verify` (fresh app/Worker checks, full suite and build), then any applicable native/CI acceptance. The UI measurement candidate on `refactor/ui-state-boundaries` is independent and remains frozen; do not combine its proof with this snapshot. No publication, main modification, merge or CI dispatch has occurred. Keep the task open until the required verification and authorized integration criteria are met.


## Full local verification — 2026-10-20 23:55 UTC

Verified implementation `58c436ad49324d7689be1ff0a7d04252bce4711d`, tree `0923f3e1363da985dcb2bd6a6f674c1ba62362ff`. `npm run verify` exited 0: fresh non-incremental app/Worker checks, regenerated Worker runtime types, 10,533 tests passed / 67 skipped / 1 todo (1,054 files passed / 12 skipped), production build 13.02s. Skips/todo remain unexecuted.

Environment used `TZ=UTC`, `DEV_LAN_HOST=127.0.0.1`, `DO_NOT_TRACK=1`, `WRANGLER_SEND_METRICS=false`, `WRANGLER_SEND_ERROR_REPORTS=false`, `WRANGLER_HIDE_BANNER=true`, `WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true`, `CLOUDFLARE_CF_FETCH_ENABLED=false`, and a temporary Wrangler log path. All tracked inputs remained unchanged; only test-generated `.cache/` appeared. All 19,392 installed dependency files were inventoried before/after excluding disposable `.cache`, `.vite`, `.vite-temp`: no differences, sorted inventory SHA-256 `f3337a266db7d5caef79631673be639556310492a97b7bb8bae0e751547edbd1`.

Independent review found no blocker. This proof/status update is documentation-only. Remaining gates: applicable integration, native/CI acceptance and publication authorization. Full verify did not execute native browser or Firestore Rules checks. No publication, main edit or merge performed.
