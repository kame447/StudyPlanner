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

## Resumed integration — 2026-10-24

Existing PR [#820](https://github.com/kame447/StudyPlanner/pull/820) and branch remain the only implementation owner. The previous unpublished local integration was unavailable after the execution environment changed, so the branch was restored from remote `62799c1c09ce139e3d4232823b10e30abfe072a1` and integrated with actual main `aaac18833d2565d23bd7d5e68ffe0c962887c91b` (including #816, #818 and #819). The README conflict was two independent index additions; both were retained. Integration commit: `45ce347d`.

The original implementation and regression-test diff is unchanged. Inspection reconfirmed synchronous shared admission for both save routes, owner-keyed editor replacement, rejection propagation and current-session-only close/release. Earlier full verification is historical evidence, not proof for this new environment/integration. Next: fresh focused and full verification using the restored shared dependency installation, ordinary publication to this existing branch, exact-head CI/native gates, and coordinated merge. No additional feature, duplicate PR, force push or direct main update is required.

### Fresh final proof — 2026-10-24 01:08 UTC

Verified HEAD `11952233cf9f31e7cf69bfed9fe1feaf91d4f8c7`, tree `e37e27a4c6de1daf5100e6a042f43143b258d35a`, based on main `aaac18833d2565d23bd7d5e68ffe0c962887c91b`. Focused tests: 10 files / 85 passed. `npm run verify` exited 0: fresh app/Worker types and runtime generation, 1,077 files / 11,314 tests passed, 12 files / 67 tests skipped, one todo, production build 13.20s. The unchanged blocking bundle checker exited 0. Skips/todo remain unexecuted; native browser/security/Firestore acceptance remains separate.

Environment: supplied Node24.22.1/npm11.9.0, accepted by the repository's runtime guard; CI separately uses pinned22.23.4. Fresh current-lock `npm ci` and `npm ls --all` both exited0. Package SHA-256 `263ceee1209973904638c558e426537de4d4cecc285b449b748e9be55a1f7640`; lock SHA-256 `01cc6c380a2797653d6e9a9dca8e5afe835a2278cb990d21dc6b220ca8aa466f`. Private copied dependency installation matched all19,392 seed file/link records after verification; manifest SHA-256 `a5f7820a16c0e68825ca9dfc1f329baea1f8acb359572efec32f3aad0a3edda0`. Tracked inputs were unchanged; only disposable `.cache/` appeared. This evidence append is documentation-only.
