# Automatic rest-day calculation recovery

- Owning Issue: [#542](https://github.com/kame447/StudyPlanner/issues/542).
- Recovery base: `9abc46038e7fb6d8dd0c26dabf31b8e251311473`.
- Status: reconstructed local candidate with fresh focused verification; not published.
- Original local commit `072103b8da5e42818ba14ec6045b0ad22b537c85` and its evidence files are unavailable after the workspace rollback. The runtime and regression test were reconstructed from retained exact source output and matched their recorded byte hashes. This does not recover the original commit or reuse its old test status.

## Scope

Only the pure automatic rest selector changes. When no ticket has ever been earned it returns immediately. Otherwise it reuses normalized study dates and the current model while evaluating the unchanged chronological calendar projection. It must use total earned tickets, not the final available balance: filling an earlier gap can create a later replacement award while preserving an existing manual rest day.

Owner filtering, source classification, ended-date restriction, incomplete-history behavior, public per-day guard, final transaction validation, Firestore reads, persistence and UI remain unchanged. Historical protected dates must remain protected in every selected projection.

## Fresh verification on 2026-10-17

- Runtime SHA-256: `6fd82af09b543de30adda4705b6ce8808a43b4c3740a8adfea1060e5022deb98`.
- Restored test SHA-256: `839db41735ce3489e2b38adba701eec746777eb6b1cea81d0750f5d06a17acac`.
- Focused related suite: 14 files / 82 tests passed, exit 0. Includes the six restored tests, 2,048 study/rest patterns, 120 mixed-owner/source protection lifecycles and deterministic one-normalization checks.
- Fresh `npm run typecheck:app:full`: passed, exit 0.
- Fresh baseline-source versus candidate-source comparison: 432 scenarios / 905 next-date selections passed across UTC, Tokyo, New York, Berlin, Lord Howe and Apia. Covers DST, leap-day and date-line changes, legacy protection, foreign-owner records and input immutability.
- `git diff --check`: passed.
- Installed dependencies come from the publisher's fresh `npm ci` against the exact base lockfile; the recovery receipt records Node/tool versions and lock identity.

The integration owner owns combined full verification, production build and required release checks. No old CPU timings are reused as fresh performance measurements. No live Firebase data, billing, browser or physical-device latency was measured. The next action is to integrate this exact reconstructed diff and run the combined release gates. No external write, merge, deployment or branch deletion was performed.
