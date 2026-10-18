# Non-spatial data motion: skip unused geometry

Status: approved release integration; native acceptance pending
Base: d5de705e07faa7213f02f741895a8d6204acc93f (2026-10-18)

## Scope and preflight

Only useDataChangeMotion and its focused tests change runtime/test behavior. Current open work on #777 owns day/week radial-menu controls; no consumer or menu file is changed. #382, AI/Jev, capacity, #741 filter/seed, and the four completed releases remain separate. Current AGENTS is unchanged from the previously read instructions. The latest user requests related checks rather than repeating all suites.

## Finding and alternatives

The hook read old and new item rectangles for data changes even when effective motion was off or reduced. The later playShift policy suppressed spatial animation, leaving the geometry unused.

1. Skip just geometry when spatial motion is disallowed (chosen). Keep every committed signature baseline and existing entry/change feedback.
2. Return from the whole hook when motion is disabled (rejected): loses baseline and can replay historical changes on re-enable; also drops reduced opacity feedback.
3. Cache geometry globally or change consumer rendering (rejected): larger lifecycle surface without evidence of need.

This is a synchronous DOM-call reduction, not a measured browser speedup. On the real hook with simulated DOM geometry, deleting one of 100 items and changing another made 300 getBoundingClientRect calls at off/reduced/system-reduced. The regression failed in all three modes on the original implementation, with the nine prior tests passing. The candidate makes zero such calls. DOM queries/signature iteration still occur; this does not claim all O(n) work or all forced layout is eliminated.

## Preservation and tests

Standard motion and mid-flight glide continuity remain covered. Added tests exercise reduced opacity-only feedback by exact target/keyframe, no replay on re-enable, new insertions/removals and correct 20 px glide after re-enable, system reduced-motion caps, and cancellation of an in-flight glide before fresh standard movement. Small-column cases avoid the existing 24-shift suppression threshold.

Related tests: 48 passing in three files (hook 16, motion effects 18, policy 14). Fresh app typecheck also passed on the final runtime/test bytes. The render guard checks for a relevant data change before reading motion policy, so unchanged-data commits do not incur a new policy lookup.

## Environment and remaining checks

The first unmodified test command failed before tests because the development-URL helper attempted os.networkInterfaces in the restricted environment. Existing DEV_LAN_HOST=127.0.0.1 skips that optional address enumeration; it does not start a server or change network permissions. Related unit checks then ran through the normal repository config.

The reused local install matches the lock versions of React, react-test-renderer, Vitest, Vite, and TypeScript. It is not claimed to match the entire current dependency graph: Terser is absent, so current production build is unverified. No browser launch, native UI acceptance, production timing, or external write was performed. Do not infer #741 timeout improvement from these operation counts.

Next: independent source/test binding; retain candidate locally and report exact validation limits before requesting publication.

## Approved latest-main integration (2026-10-18)

The user approved publication, related verification and normal merge of this motion optimization. The existing `fix/nonspatial-motion-layout-reads` branch continues from 98c001b5; it is merged normally with current main 2f7c8cdc94896d2e53b1b43921f3a2cf1ff878ff. No conflict was reported. The 36 intervening main paths, including #779 radial schedule actions, #778 CSS cleanup and #575 container CI, are preserved. #779 changes DayTimeline/WeekView consumers but not useDataChangeMotion, motion policy or effects. The candidate hook and regression tests remain byte-identical to 98c001b5.

The old missing-Terser limitation is addressed by verifying and reusing the existing independent a064 npm-ci baseline install: all 19,406 recorded package files match, lockfile matches current main, and Terser 5.51.2 is present. This uses Lucide 1.14.0, not the withheld dependency upgrade. No new install is performed. Fresh related tests, app typecheck and one production build are the next local checks. Ordinary CI must verify the final published source; browser results and speed improvement remain unverified.

Fresh integration checks passed on the combined runtime/test/config bytes: 39 related files / 485 tests, `npm run typecheck:app:full` (non-incremental), and `npm run build`. All tracked inputs were hash-equal before and after these commands. The selection covers the hook/policy/effects, settings, all seven direct consumer components, and the latest radial-menu/navigation boundaries. The installed package inventory is fixed in the external verification receipt; no install changed during validation. These are focused local checks, not full-suite or browser acceptance.

The previous ordinary-native selection contains 39 cases (31 Chromium, 8 mobile WebKit), covering standard/reduced/off behavior, setting changes, Home/AI/Bookshelf/Todo/calendar updates and persistence. QA is reconciling the exact definitions against this latest source before ordinary CI extraction. No browser was launched locally; no measured latency improvement or #741 fix is claimed. Publisher owns GitHub writes and ordinary CI; final native/visual results remain the release gate.
