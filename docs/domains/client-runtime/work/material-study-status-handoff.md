# Material study status

- Owner: UI umbrella #483, material study status implementation.
- Branch: `feat/material-study-status`; base `70953efd`.
- Scope: two explicit study states, studying/completed; create/edit selector and bookshelf filter.
- Contract: optional `studyStatus` defaults to studying for old records. It is independent from active/archived lifecycle, progress quantity, and study history. Reaching 100% never changes the status implicitly. Both states remain usable for records/plans. No migration or archive reuse.
- UI: initial all-state view preserves the existing shelf; studying/completed filters combine with subject and search. Editing uses the existing save/baseline admission boundary.
- Verification: implementation in progress; focused component/model/persistence tests next. Full integration, native browser and publishing belong to integration owner.
- Exit: explicit state survives save/reload and roundtrip switching without losing progress/records, filters compose correctly, existing archive exclusion remains intact, focused checks green. No browser started by implementation worker.

## Verified implementation checkpoint

Implementation complete; awaiting combined release verification. Exact source/test content over base `70953efd` passed:

- `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/Bookshelf src/lib/bookshelf src/hooks/usePlannerDataState.materialAdmission.test.tsx src/repositories/firebasePlannerRepository.recurringMutation.test.ts src/App.bookshelfMaterialHandoff.test.tsx --maxWorkers=2`: 12 files / 176 tests, exit 0.
- `npm run typecheck:app`: exit 0.
- `git diff --check`: exit 0.

Only this documentation changed after those checks. Node 24.19.0, Vitest 3.2.7, existing installed dependencies linked from durable-ai-turns worktree; package-lock SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`. This is focused feedback, not clean-install/full-integration evidence.

The supported `DEV_LAN_HOST` override avoids unavailable LAN-interface discovery during Vite config startup. No source/config workaround or browser process was used. Earlier test-only failures were corrected to use an in-range progress fixture, real edit label and a specific duplicate menu instance.

Coverage: legacy/100%-progress independence; completed/studying roundtrip through the real planner hook and local repository with reload and unchanged Actual records; omitted-field preservation; new-record default; Firebase merge payload retention; filter/search/subject composition; owner/archive exclusion; edit-baseline wiring.

Remaining: integration owner runs full verification/build and native desktop/mobile visual/browser checks on combined content, then publishes through the sole writer. No production/live Firebase behavior claimed. Reuse #483; no new Issue/PR or GitHub write. Delete this implementation branch after release acceptance.
