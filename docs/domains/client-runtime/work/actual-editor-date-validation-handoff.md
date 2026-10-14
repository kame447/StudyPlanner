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

## Verification checkpoint

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

## Remaining release gate

Parent review, authorized upstream publication and the existing GitHub CI/native browser gates remain open. The change is locally implemented and verified to the stated boundaries; it is not deployed or fully accepted in a browser. No old record is automatically repaired.
