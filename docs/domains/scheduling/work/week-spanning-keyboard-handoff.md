# Week spanning-event keyboard access

Status: draft PR #808; integration with actual main passes local full verification. Native browser gates remain pending.
PR: https://github.com/kame447/StudyPlanner/pull/808
Owner: Issue [#780](https://github.com/kame447/StudyPlanner/issues/780), keyboard scope only.
Branch: `fix/week-spanning-keyboard-main-20261020`.
Remote head: `22caa220d19f33100b7a0211ee33649ee1885ef1`.
Integrated main: `2ea267f41ba62c154ac83c260e19ad1fff4578a1` (local, not published).
Actual main reconciled: `ae833f7ac4d7af1d09a66da586f96276cdf085f4`, whose tree exactly equals the prevalidated #845 head `b9629718d1dfcdab02d842bd98534cbc2a491c93`.
Original verified candidate: `a3c8a9316602d68c89e54e585ee4678bfa1b0b61`
on base `8474777c4d6d616fd5ddeacadce808a02b3e8e3f`.

The original non-plan spanning card was a non-focusable span with no tap callback.
A tab stop alone would not provide a control role or keyboard activation. A new
detail route would introduce another responsibility. A native button opening the
existing radial actions provides a named, focusable control and native Enter/Space
activation; ContextMenu/Shift+F10 remain owned by the Week section. Study-plan tap
editing and read-only timetable presentation stay unchanged.

## Current local integration checkpoint (2026-10-23)

- Reused the existing branch/PR and Issue #780 keyboard scope. Main integrates
  cleanly without conflict or implementation changes. The five keyboard source/test
  files are byte-identical to remote head `22caa220`; #815 remains dependent on #808.
- The implementation integration snapshot before this documentation-only update is
  Git tree `cf83f77fcdc71ef4150a8152ba78417480262cae`, with remote head and integrated
  main above as its parents. The merge is local and uncommitted; it is not remote CI evidence.
- Focused command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/WeekSpanningEventsLane.test.tsx src/components/ScheduleItemActions.test.tsx src/components/ScheduleItemRadialMenu.test.tsx src/hooks/useScheduleItemActionPress.test.tsx src/lib/scheduleRadialMenuLayout.test.ts src/lib/scheduleRadialGesture.test.ts`.
  Exit zero: six files, 185 tests passed. `git diff --check` passed.
- Environment: Node 22.23.4, React/react-test-renderer 18.3.1, Vitest 3.2.7,
  TypeScript 5.9.3, Vite 6.4.4. Shared clean installed dependencies were used only
  after both package manifest and lockfile matched byte-for-byte. Installed lockfile
  SHA-256: `e39a9cc4979b9c10b158be8d619db1c52645b8844b74016152d4514ff6241997`.
  These focused results do not establish full verification or browser acceptance.

### Latest remote evidence and distinct unresolved gates

The older results below are historical, not current integration proof. On remote
head `22caa220`, [Browser Regression 39850570666](https://github.com/kame447/StudyPlanner/actions/runs/39850570666)
passed, while [UI Regression Matrix 39850570545](https://github.com/kame447/StudyPlanner/actions/runs/39850570545)
failed. In addition to the three known bookshelf long-text timeouts:

- WebKit-mobile [job 120084592784](https://github.com/kame447/StudyPlanner/actions/runs/39850570545/job/120084592784)
  reports the Day 1280px visibility/cancellation/history case timing out at the
  cumulative 30-second deadline on both attempts (reported durations 31.4/31.6s).
  Instrumented phase-end messages include history reload and next-week checks,
  and no data-value mismatch is reported. This does not prove completion before
  the deadline: hooks and continuation after timeout may affect those timings.
  Root cause remains unresolved, not conclusively a harness-only defect.
- WebKit-mobile [job 120084592576](https://github.com/kame447/StudyPlanner/actions/runs/39850570545/job/120084592576)
  reports the overnight range 1280px case reaching the 30-second timeout at the
  post-edit storage poll (`month-event-range.spec.mjs:627`) before passing its
  retry. The flaky-test policy still fails the gate. A passing retry alone does
  not establish a cause or current-content acceptance.
- Main `2ea267f4` does not change either of those tests. Subsequent local integration
  of #845 includes its separately owned Month1 budget and Day reduced-motion runtime
  correction. It does not establish that the distinct Day cancellation timeout is
  resolved. No additional timeout or assertion change was made in #808.
- [UI Quality 39850570720](https://github.com/kame447/StudyPlanner/actions/runs/39850570720)
  failed its bundle gate on the old remote head. Main's newer policy must be
  verified on final integrated content rather than assumed to clear that result.

### Intermediate full verification and pending baseline reconciliation

`DEV_LAN_HOST=127.0.0.1 npm run verify` exited zero on tree
`6f249e3c01b222a4da1d2bd3efec50ecdcf46c1b`: fresh app/Worker types passed;
1,068 test files and 11,205 tests passed (12 files/67 tests skipped, one todo);
production build passed in 14.84 seconds. The Node/dependency identity above was
unchanged. This is intermediate proof for main `2ea267f4` plus #808 and the
checkpoint update, not proof for the later #845 integration.

PR #845 head `b9629718` then integrated cleanly, without changing #808 source/tests.
Its runtime/budget inputs changed, so full verification was repeated on the
changed content, not on identical inputs. `DEV_LAN_HOST=127.0.0.1 npm run verify`
exited zero on tree `b891cde2e96cd47749654b5f70100eaf5940a167`: fresh app/Worker
types passed; 1,070 files and 11,207 tests passed (12 files/67 tests skipped, one
todo); production build passed in 13.59 seconds. Node/dependency identity remained
the same as recorded above. This paragraph is the only subsequent content change.
The eventual main content must match this baseline before publication; old remote
results are not substituted for exact integrated native-browser verification.

Actual-main ancestry reconciliation preserved tree
`a83016c8f868fc6b93bda205750a45a8230f113a` exactly before this documentation-only
update. No source, test, configuration, dependency or installed-environment input
changed after full verification.

Next: publish the existing branch, inspect exact-head native keyboard/browser gates,
and diagnose remaining failures from evidence. No extra timeout waiver is permitted. Physical iPhone
acceptance remains separate and unverified; do not close #780 for keyboard scope.

## Historical original-candidate verification (2026-10-20)

- Independent red check on the original source: both new native-button checks fail
  (`span` instead of `button`); existing section context-key checks already pass.
- Related consumer/action/flick checks: 73 passed. Added timetable read-only and
  study-plan tap preservation checks: two passed. Independent action/menu/press
  checks: 128 passed.
- Final `DEV_LAN_HOST=127.0.0.1 npm run verify`: fresh app and Worker types pass;
  1,052 test files and 10,478 tests pass, with 67 skipped tests and one todo;
  production build passes in 13.82 seconds. Code and test hashes stayed unchanged.
- The initial full run lacked historical git fixture `070d25cbe14796aebb8168ac5425c93e3506df1c`
  in the shallow clone. Fetching that exact commit restored the fixture, whose
  31 tests then passed before the final full run. No assertion was weakened.
- Four browser cases collect successfully: 390/1280 px, single/multiday. They
  require native Tab, Enter, Space, ContextMenu, Shift+F10, Escape, focus return,
  six actions, no opened detail dialog and unchanged schedule/actual storage.
  Local Chromium cannot launch: its process singleton socket returns
  `Operation not permitted`, before any test body. Browser acceptance is therefore
  unverified, not a four-case application failure or a passing keyboard test.

## Historical integration verification (2026-10-20)

- Main advanced to `22e42203a4df82b5432d4290b7b5ea3a4246b8c9` with #804.
  Its weekly-planning changes do not overlap this patch, dependencies, or browser
  workflows. The candidate applies cleanly; all five source/test hashes match
  the original reviewed candidate.
- Fresh `DEV_LAN_HOST=127.0.0.1 npm run verify` exits zero: App and Worker types
  pass; 1,055 files and 10,534 tests pass, 67 tests skipped and one todo;
  production build passes in 15.12 seconds.
- The unchanged repository Playwright config collects all four new browser cases.
  CI selection for this candidate against current main is the full browser suite.
  The existing pull-request workflow installs Chromium on Ubuntu; no workflow
  change is needed. This is collection/routing evidence, not browser acceptance.

Next: run the four browser cases through the supported CI/browser environment,
review exact-commit results and obtain publication/merge authorization as needed.
Real iPhone acceptance remains separate and unverified. Do not close #780 on
keyboard-only verification.

## Historical published browser feedback (2026-10-20)

Published head `085349cef2ad150ebb30df2301e4a47c25fa6225` has the same Git tree
as the verified local candidate. Browser run 39396135586 executed the new cases,
but all four stopped at missing-card setup: the seed incorrectly used
`studyplanner.monthEvents.v1`, while the actual gateway reads
`studyplanner.monthEvents`. Screenshots show the correct week with no event.
The correction uses the actual gateway key and additionally requires the canonical
store to contain the seeded event before checking native keys. No production code
or keyboard assertion is changed. Fresh verification passed: 1,055 files / 10,534 tests, fresh App/Worker types,
production build 16.39 seconds. Corrected browser CI is pending.

CI and browser-quality passed. Bundle budget fails the same six categories as
exact base `22e4220` (base run 39366056474, candidate run 39396135566); this is not
waived or a passing quality gate. Physical iPhone acceptance remains unverified.
