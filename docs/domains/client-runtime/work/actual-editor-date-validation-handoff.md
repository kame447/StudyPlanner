# Actual editor date validation

Status: active
Updated: 2026-10-14 UTC

## Ownership and scope

- Branch: `fix/actual-editor-date-validation`. Base and initial HEAD: `90211bdcf39dd9bce66211df129949a5668a0de4`.
- Inspect and, only if reproduced, fix blank or invalid dates in normal and standalone study-record editors. No DayView, HomeTopbar, weekly-planning runtime, repository schema or historical-data repair.
- Current open PRs and actual/record branches have no active same-scope implementation. Closed #516/#517 covers material quick entry only; #426/#427 and #429/#432 cover save-failure recovery, not date validation. No new Issue or PR created.
- Owned production files: `src/components/ActualEditorCard.tsx`, `src/components/StandaloneActualEditorCard.tsx`. Dedicated regressions will be added; shared admission hooks are outside this scope.

## Reproduced defect and minimal fix

The real editor → `usePlannerDataState` → coordinated canonical local repository persisted `occurrenceDate: ""` in all three paths: a new linked record, an existing linked record, and an existing standalone record. Editing a linked record also detached it from its plan. This creates a record outside every normal daily date filter. The authoritative baseline is the sequential-input integration run, not the earlier batched synthetic-input attempt.

The two editors now use the existing `isValidQuickEntryDate` before save; standalone relinking applies the same guard. Blank dates, malformed dates and impossible calendar dates remain editable and cannot begin a pending mutation. No new date policy, implicit date correction, repository change, schema change, historical repair, time behavior or scope expansion is introduced. Production delta: 14 added lines in two files.

## Initial local verification checkpoint (before publication)

- Base: `90211bdcf39dd9bce66211df129949a5668a0de4`; only this branch's files are modified.
- Baseline component callback test: 16 failed, showing invalid date submission before the guards.
- Baseline real persistence test: 3 failed, with raw `studyplanner.actuals` showing empty dates in all three paths.
- Corrected focused run: **57 passed / 8 files**, including 16 component validation/recovery cases, 3 real-local-persistence cases, existing linked/standalone failure recovery, Firebase admission boundary, compact form and draft regressions.
- Real persistence tests read the same data through a fresh production repository instance after correcting the date, prove the memo and record identity survive, and assert no write or local optimistic change during invalid input. Storage is isolated in-memory `Storage`; no production account is used.
- Independent local final checks succeeded on the exact current source: fresh app TypeScript (`tsc --noEmit --incremental false`), fresh Worker TypeScript (`tsc --noEmit -p tsconfig.worker.json --incremental false`), full Vitest **887 files / 8,477 passed**, 11 skipped files / 54 skipped tests / 1 todo, and production Vite build (8.91s). Each returned exit 0. No lint script is configured.
- The aggregate `npm run verify` is **not claimed as passed**. Its monitoring call was blocked because Wrangler's optional external telemetry/update traffic was not established as authorized. The runtime declaration had been generated, but the aggregate terminal outcome is unverified and was not retried. Subsequent independent checks above do not invoke Wrangler. Future commands use `WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1`; this does not authorize retrying the denied command. Existing native CI is the final aggregate gate.
- Source fingerprint before/after: **2,208 non-documentation source/test/config files**, SHA-256 `244ce89b2af6f149a22eb7563d0b5a5d8cbecf8093817fe4f364569b19efccee`. Installed dependencies: **19,328 files**, SHA-256 `853d115f3fa57c7d701198ef36e5309559c6046213d6a86a03946ab49b4c6a4f`, unchanged. Excludes executable runner caches, `.package-lock.json`, compiler caches and documentation. The existing wire-compatibility test generated `.cache/j1-old-worker` from immutable commit `070d25cbe14796aebb8168ac5425c93e3506df1c`; this output is outside the source fingerprint and the patch.
- Generated Worker declarations: SHA-256 `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79`, runtime `workerd@1.20261001.1`, compatibility date `2026-04-10`. Node 24.19.0 / npm 11.9.0; TypeScript 5.9.3, Vitest 3.2.7, Vite 6.4.3, React 18.3.1, Wrangler 4.147.0. No dependencies, lockfile or production service configuration changed.
- Native browser tests: six normal Browser Regression cases (390px/1280px × new linked/existing linked/standalone) were added. **Their bodies have not run locally.** System Chromium cannot create its required local socket (`EPERM`), including one formal escalated attempt. The separate cloud browser cannot reach this execution workspace's localhost. No further launch retry or alternate browser infrastructure is planned; native acceptance remains an independent existing GitHub CI gate.
- No upstream push, PR, merge or deployment has occurred. No branches were deleted.

Evidence receipts are in this worktree's ignored `artifacts/` directory: `baseline-component.log`, `baseline-persistence-sequential.log`, `focused-final.log`, `verify.log` (nonterminal), `verify-before.json`, `local-checks-after.json`, `app-types-direct.log`, `app-types-direct-exit.txt`, `worker-types-direct.log`, `unit-full-direct.log`, `unit-full-direct-exit.txt`, `build-direct.log`, and `build-direct-exit.txt`. They describe local evidence only; none establishes production/browser success.

## Acceptance

1. Establish baseline observable failure, or report non-reproduction without an unnecessary change.
2. Block invalid date before any persistence call while retaining editable input. Correcting the date permits save/reload; preserve relinking, time semantics, existing recovery and pending-operation protection.
3. Focused regressions, relevant actual-browser desktop/mobile checks, fresh type checks, full unit/integration tests and production build on the exact final content.
4. Review exact diff. Upstream push, main changes and merge remain with the parent approval boundary.

## Initial remaining release gate

Parent review, authorized upstream publication and the existing GitHub CI/native browser gates remain open. The change is locally implemented and verified to the stated boundaries; it is not deployed or fully accepted in a browser. No old record is automatically repaired.


## Resume checkpoint — 2026-10-14 12:50 UTC

- The user explicitly approved resuming the cancelled actual PR publication on 2026-10-14 at 12:48 UTC. The sole publication owner handles the original PR creation retry and all upstream writes; this worker owns only the existing local branch and verification.
- Remote actual head `4542d408452b57efae0ce9c7d8b123ad54f1b58e` and local head `8cc72773eb9ab29a70ba573b5ba6dcf742a80c91` have the same tree `cc0f5101ad81b6537cc09083fb88267d301aa779`. No duplicate Issue, branch or PR is created by this worker.
- Merge current main `fe8aa40d9e3ceb594c01f29e6f9f6d2521c69bb2` normally into the original branch. The only conflict is the existing mobile-WebKit test list; retain every main entry, including Day and streak, and retain actual date validation. Day controls, announcements, streak and Day grid selection remain byte-identical to main outside this actual-only diff.
- The actual production delta remains the original 14 added lines across the two editors. Existing focused component/persistence regressions and six native cases remain unchanged. No assertion, timeout or threshold is relaxed.
- Next: focused regressions and discovery, one fresh exact-content aggregate verification on this merged snapshot, then pass the final tip and receipt to the sole publisher. Native acceptance requires actual Chromium and mobile-WebKit six-case results plus post-main confirmation. The original blocked verification outcome remains unverified historical evidence and is not reclassified as successful.


## Current verification and publication handoff — 2026-10-14 12:56 UTC

- Existing PR: [#650](https://github.com/kame447/StudyPlanner/pull/650), draft. The sole publisher retried the explicitly authorized cancelled creation successfully. The initial remote head is `4542d408`; the merged local snapshot below has not yet been published at this checkpoint.
- Verified integration commit: `0a30cbac16e132ae490744ab7860c38a38b3ea83`, tree `ffc14825af66392fec43439f3ae1e7cd08954731`, parents `8cc72773eb9ab29a70ba573b5ba6dcf742a80c91` and current main `fe8aa40d9e3ceb594c01f29e6f9f6d2521c69bb2`. The only resolved conflict was the mobile-WebKit test list. The final diff from main contains the eight original actual task files only; the previously accepted four features are unchanged.
- Fresh `npm run verify` on this integration snapshot returned **exit 0**, 2026-10-14 12:51:49–12:55:16 UTC: fresh non-incremental app/Worker TypeScript and regenerated Worker types; **907 passed files / 8,616 passed tests**, 11 skipped files / 54 skipped tests / 1 todo; production build **5.97s**. Unit duration: 170.30s. No assertion, timeout or threshold was changed.
- Command-local environment: `WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1 DEV_LAN_HOST=127.0.0.1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=2 WRANGLER_LOG_PATH=/tmp/actual-resume-wrangler`. The two-fork settings are already supported by installed Vitest 3.2.7; no runner configuration or dependency changed. This is a new authorized integration verification, not a retroactive success claim for the earlier blocked run.
- Input identity before/after was identical: **2,253 non-documentation source/test/config files**, SHA-256 `0d1ddd838957b80df8e21f5a518de45c85af8e993255384288c357033de9b8d7`; **19,328 installed dependency files**, SHA-256 `853d115f3fa57c7d701198ef36e5309559c6046213d6a86a03946ab49b4c6a4f`. Generated Worker declaration hash remains `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79`. Node 24.19.0 / TypeScript 5.9.3 / Vitest 3.2.7 / Vite 6.4.3 / React 18.3.1 / Wrangler 4.147.0.
- Focused actual regressions: **57 passed / 8 files**, exit 0. Existing local Playwright 1.62.1 discovery selected **6 actual cases in Chromium** and **6 actual + 4 Day + 4 streak cases in mobile WebKit**. Discovery is not browser execution. No local browser launch was retried.
- Evidence: ignored `artifacts/resume-main-fe8aa40d/` contains focused/discovery logs and exit sidecars, `verify.log`, `verify.exit`, start/end timestamps, before/after input fingerprints and `terminal-local-receipt.json`. This documentation-only checkpoint does not change verified runtime inputs.
- Still required: publish the final exact tree through the sole publisher; existing CI and native Chromium/mobile-WebKit six-case success; inspect screenshots and failures if any; authorized merge and exact-main post-merge checks. Known inherited bundle-budget failures remain separately disclosed. Physical iPhone/PWA installation and historical invalid-record repair are outside this verification.


## Native failure diagnosis — 2026-10-14 13:28 UTC

- Published head `bc85b6b0d24f1a86fb4ac7266e1a64773c490756` and PR merge checkout `aea1ff01031390fefbfaa7582cb171854a22a6cf` both have exact local tree `5a779269f74411e24735c86c6b6116bc74987bea`. CI passed fresh types, 907 files / 8,616 tests, Firestore rules and build 6.79s. Admin, visual, desktop matrix and browser-quality succeeded; six inherited bundle-budget categories still fail.
- Browser run `38568063333`, job `115865755153`: **699 passed / 2 failed**. Only linked-existing actual cases at 390px / 1280px failed, including the same retries. The timeout is at the first memo fill, before date validation. New-linked and standalone date cases passed at both widths.
- Mobile-WebKit run `38568063294`, job `115865755325`: the same two linked-existing cases failed; the other four actual cases passed. The job later hit the existing 25-minute job limit and was cancelled; its incomplete total is not a successful gate. No timeout increase or old-head rerun is used.
- Competing causes considered: a broken editor/admission transition; viewport-dependent missing controls; a fixture/locator contract mismatch. Both failed screenshots show the open editor and visible memo field at both widths, ruling out the first two explanations. The fixture deliberately has an Actual title different from its Plan and therefore the production editor correctly labels its memo `ズレの理由・メモ`. The native test incorrectly searched for the aligned-state label `メモ・気づき`.
- Minimal repair: change the existing linked-existing memo locator to its exact actual label. Keep the non-aligned fixture, all six cases, invalid-save no-write/input retention assertions, corrected-save/reload checks, retry policy and timeouts unchanged. No production change is needed.
- Logs and inspected screenshots: `/workspace/shared/laplans-actual-native-650/bc85b6b0/`; compact images artifact `11898461986`, SHA-256 `5ba8d70dc6e104edce9ce59c1e18b72bb26eb7018fe4e9ffc639642c28696459`.
- Next: discovery and fresh exact-content verify for the repaired native-test snapshot; publish through the same sole writer and require both engines' six actual cases plus complete gates before merge.
