# 本棚の総量未設定時の進捗表示

Status: active, local implementation; publication is not authorized in this task.

- Branch: `fix/bookshelf-unconfigured-progress`
- Base: `f8f09a17894fcabc93050c5f065515b0e75d804c`
- Scope: `src/components/BookshelfView.tsx` and its focused progress-display regressions.
- Preflight: current main, open PRs, material-related Issues/PRs/branches checked. PR #665 is merged; no active matching implementation was found.
- Problem: progress-enabled materials with no usable total display 0% or 100% on shelf cards/rows. The existing material detail correctly suppresses progress when the total is missing or zero. A blank total can be saved through the current material editor.
- Decision: retain the existing detail contract on both shelf surfaces. Do not change stored values or the progress calculation used by other callers. The daylight-saving day-count candidate is excluded because its affected output is not currently displayed.
- Implementation: one shelf-local nullable progress selector uses the existing material-detail condition: progress enabled and normalized total greater than zero. Both featured cards and category rows use that result. Numeric 0 remains a valid displayed percentage when the total is configured.
- Next: parent review/integration and authorized release verification.
- Exit: local implementation plus red/green regression evidence and handoff. Parent owns combined verification, publication approval, and any later CI/browser checks.

No AI, photo reading, progress recording, UI layout, schema, or persistence changes are included.

## Verification

- Baseline after correcting a test-renderer text-node type assumption: 5 tests failed / 6 passed. Missing, zero, negative, NaN, and infinite totals incorrectly rendered progress on both shelf surfaces; the existing detail view already hid it. The first test attempt's 3 additional failures were test harness number/string expectations, not production defects.
- Fixed focused command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/BookshelfView.studyStatus.test.tsx src/components/BookshelfMaterialDetail.test.tsx src/components/BookshelfView.structureEditor.test.tsx src/lib/bookshelfViewModel.test.ts src/lib/materialPace.test.ts --maxWorkers=2 --minWorkers=1` — exit 0, 59 tests / 5 files passed.
- Coverage includes both shelf surfaces, unchanged detail navigation, disabled progress, configured 0% / 25% / 100% labels and bar widths, and no save side effects.
- `npm run typecheck:app` — exit 0. `git diff --check` — exit 0. No lint script is configured.
- Verified source SHA-256: `BookshelfView.tsx` = `9f88a0520db3ed01b91c8c98eeb2fd97e3f22cebaf0e4e9b671f8eef6c3f6dbe`; `BookshelfView.studyStatus.test.tsx` = `764fb413bf8658f58d12a3c2b8b3a7f02e09dd6fc16c2d7b8e71b397c04598bc`.
- Environment: Node v24.19.0, installed React 18.3.1 / Vitest 3.2.7 / TypeScript 5.9.3. Shared dependency directory reused; dependency inputs were not changed. Lockfile SHA-256: `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`.
- Full verify, Worker typecheck, production build, real-browser rendering, CI, and deployed behavior were not run by this implementation worker. Focused component evidence does not establish those gates; the integration owner must run applicable release checks.
- GitHub remained read-only. No Issue/PR, remote push, merge, or branch deletion was performed. Keep the local branch until integration is accepted; it can then be removed through the normal branch lifecycle.
