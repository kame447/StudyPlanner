# Recurring general-event edit scope

Status: local implementation verified; publication/main integration authorized; native browser and integrated release verification pending.

## Scope and ownership

- Local branch: `fix/recurring-edit-scope`; base: `1b828e77254351c2c799ff6e0b605e9fc25daacf` (remote main rechecked on 2026-10-14).
- The user confirmed the affected surface is ordinary 「予定」, not learning Plans or timetable masters. Editing must ask whether to change this occurrence only or this and future occurrences. Earlier occurrences must remain unchanged.
- No remote branch or PR has been created. Completed Issue #266 owns historical Plan mutation work; #442/#444 fixed MonthEvent navigation. Open/closed Issues, current PRs and branches were checked; no existing implementation owns this new defect.
- The separate month-event save-range fix (PR #655) must be retained when integrating current main. This branch intentionally does not replace its ordinary single-event validation.

## Reproduction and resolution

The original scope introduction (`48ea05cd`) and current main had a distinction: learning Plans support edit scope, but ordinary MonthEvent edits directly overwrite the whole series; only deletion asked for scope. An actual editor/hook/local canonical repository reproduction changed October 4, 11 and 18 together when editing October 11. Plan single/future edits retained their existing correct behavior.

- The ordinary event editor now initializes dates from the selected occurrence, including the original start of a multi-day occurrence opened on a continuation day.
- Save asks 「この予定だけ変更」 or 「これ以降も全部変更」. No persistence occurs before selection or on cancellation; cancelling preserves typed input.
- A single edit excludes the original occurrence and creates a standalone event. A future edit terminates the old series and creates a new series. Editing the first future occurrence updates the original row in place.
- The domain owns the split and preserves original past events, expiry, exclusions, other fields and the busy/free flag. Month ends, leap-year annual events and overnight/multi-day events are covered.
- The editor does not expose an expiry control. Future edits retain the original expiry and exclusions rather than silently losing them through draft normalization. A future move before the selected occurrence or beyond its inherited expiry is rejected with a specific message; an explicit single-occurrence move remains available.
- Local canonical/legacy persistence performs one collection write; Firebase canonical/legacy persistence performs one bounded batch. Existing schema, Rules and migrations are unchanged.
- The hook checks current owner, read authority and the source snapshot, locks both original and replacement IDs against concurrent edits/deletes, and retains normal navigation/reload reconciliation. An uncertain failed acknowledgement triggers a scoped reload before retry, preventing a second replacement after a committed write whose response was lost.

## Verified evidence

Final application snapshot identity (repository inputs excluding generated `.cache/` and diagnostic logs): `004dcb6be20e85d80b3f9dc5168bb392089e0ab3f14a10a5b4ccc5fd23a74809`.

- `CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1 DEV_LAN_HOST=127.0.0.1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=2 npm run verify`: exit 0. Fresh non-incremental application and Worker types, 917 test files / 8,717 tests passed; 54 tests skipped and 1 todo; production build 5.46 seconds.
- Source/config/test inputs were unchanged through that run. The only generated-file differences were the test-created `.cache/j1-old-worker` fixture and removal of an emulator diagnostic log. The generated fixture was moved aside after verification; neither is a release input.
- Node `v24.19.0`; installed package manifests (362 actual manifests) retained identity `8e678bb3de679bce9991a9144eaa0edde69b3451456f31e7be30cfc10d98e7c3`. Generated Worker declarations retained SHA-256 `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79`.
- Focused evidence includes domain 17 cases; actual scoped edit UI/hook/local persistence 15 cases; existing MonthView navigation 10 cases; existing dialog recovery 7 cases. Independent repository checks passed 141 tests across 13 files.
- Real local Auth/Firestore Emulator gate passed using cached Firebase CLI 15.33.0 and Java 21.0.12.1. `node scripts/ci/firestore-profile-registration-rules.mjs` now verifies canonical/legacy single/future two-record batches, rejection of a foreign-owned replacement ID without partial source changes, and legacy rejection after migration lease. Runner SHA-256: `e1b63557ee2c72ff94731294831527b2f5524982930a7a836a0f389b612d36dc`.
- Native month-event regression now includes both edit scopes, cancellation and no-write-before-confirmation assertions, while retaining deletion and navigation coverage. Syntax check and Chromium discovery select 10 cases. The mobile WebKit matrix selection now includes these same 10 cases; only that testMatch entry was added after the full application verification, with syntax/discovery checked separately. No timeout or threshold changed. Discovery is not execution; local Chromium is blocked by the already-confirmed environment EPERM.
- `git diff --check`: passed. No configured lint script.

## Separately tracked capacity result

The unchanged budget gate fails seven categories on both base `1b828e77` and this change. This is a known, separately scoped capacity issue, not a new failed category. The earlier assumption of six baseline failures was stale.

Compared with the existing exact-base budget report: total JavaScript +5,111 raw bytes / +1,238 gzip bytes; largest JavaScript gzip 260,394 → 261,619 bytes (+1,225). CSS is unchanged. Thresholds and editor loading behavior are unchanged; no capacity-only refactor was introduced.

## Remaining release steps

1. Publish the authorized change through the existing release owner; no remote changes were made in this implementation worktree.
2. Integrate current main, retaining PR #655's independent validator fix and other approved changes.
3. Preserve the newly added mobile WebKit matrix selection for `month-event-range.spec.mjs`; validate its rendered scope prompt during native checks.
4. Run exact integrated verification and native desktop/mobile browser gates, inspect the rendered scope prompt, then follow authorized publication and post-main checks. Local component, adapter and Emulator evidence does not establish authenticated production UI behavior or cross-device concurrency guarantees.
