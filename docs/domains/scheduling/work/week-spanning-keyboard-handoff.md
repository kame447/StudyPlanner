# Week spanning-event keyboard access

Status: local implementation verified; unpublished; native browser acceptance blocked.
Owner: Issue [#780](https://github.com/kame447/StudyPlanner/issues/780), keyboard scope only.
Branch: `fix/week-spanning-keyboard-main-20261020`.
Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`.
Original verified candidate: `a3c8a9316602d68c89e54e585ee4678bfa1b0b61`
on base `8474777c4d6d616fd5ddeacadce808a02b3e8e3f`.

The current non-plan spanning card is a non-focusable span with no tap callback.
A tab stop alone would not provide a control role or keyboard activation. A new
detail route would introduce another responsibility. A native button opening the
existing radial actions provides a named, focusable control and native Enter/Space
activation; ContextMenu/Shift+F10 remain owned by the Week section. Study-plan tap
editing and read-only timetable presentation stay unchanged.

## Original-candidate verification (2026-10-20)

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

## Current-main integration verification (2026-10-20)

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
