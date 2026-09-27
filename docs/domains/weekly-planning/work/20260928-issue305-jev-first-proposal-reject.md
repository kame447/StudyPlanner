# Issue #305 C9 — proposal-response reject no-go record

Status: no-go; C9 production/runtime wiring removed from the proposed main diff.
Updated: 2026-09-28
Branch: `feat/issue-305-jev-first-proposal-reject`
Production: unchanged; `JEV_MODE=off`, `JEV_CANARY_PERCENT=0`; no deployment.

## Decision

The once-only sealed holdout did not meet the pre-registered adoption gate. Direct Jev accepts were 1/16 (minimum 4), and pure-reject p50 was 3,227 ms for Jev-first versus 2,596 ms for Luna-only. C9 must not be adopted. Do not rerun this consumed holdout or retune against this corpus.

The final candidate diff removes the C9-only shared decision context, Worker policy/dispatch, client eligibility and normalizer route, and their implementation-specific tests. The merged #348 presentation-binding foundation is in `main` and is untouched. This branch retains only this outcome record and the typed tuning, holdout, gate-candidate, and fault-injection evidence below; it contains no C9 runtime or evaluation runner/corpus code.

## Typed evidence

- `workers/ai-proxy/src/decision/evaluation/evidence/proposal-response-tuning-20260928.json`
- `workers/ai-proxy/src/decision/evaluation/evidence/proposal-response-tuning-gate-candidate-20260928.json`
- `workers/ai-proxy/src/decision/evaluation/evidence/proposal-response-holdout-20260928.json` — the unique holdout run; consumed. Its `finalPureReject` aggregate is shape-only (it does not exclude `planningIntent` other than `discuss`); see the file's `metricDefinitions`. The no-go does not depend on it.
- `workers/ai-proxy/src/decision/evaluation/evidence/proposal-response-faults-20260928.json` — 10/10 injected faults fell back to Luna; containment errors 0.

Corpus label: `synthetic_unreviewed`, not human gold. Frozen fingerprints at evaluation time: catalog `18178fee99ce475b4e2a784001818d10ae44a90d7b77201376608fc4b99eba86`, gate `a5bd99046b9e08326e697f47d7ce78525f2209b48735e26aebc3c55d90e43077`, corpus `659ce70ab6a0dd8f3e885cf258ce8c8a1a20adaee0f90a11f6faa151966465a6`.

## Verification before wiring removal

- `npm run typecheck`: passed.
- `npm run build`: passed, with existing Vite dynamic-import and chunk-size warnings.
- Full weekly-planning suite: 410 files passed, 10 skipped; 1,958 tests passed, 45 skipped, 5 todo.
- Full Worker decision suite: 32 files and 450 tests passed, including the #335 security regression.

These checks verified the evaluated implementation before its removal. The no-go-only diff must be rechecked after removal before PR review.

## Runtime removal verification — 2026-09-28

- Removed all C9 implementation, Worker dispatch/policy, shared decision context, C9-specific tests, and evaluation runner/corpus/seal code. `origin/main` already contains the #348 binding base; its implementation was not changed.
- Remaining source matches for `proposal_response` are unrelated existing text-normalization behavior. No C9 dispatch/context/eligibility symbols remain in `shared/`, Stable V5 runtime, Worker, or scripts. The production build output contains no C9 route code.
- `npm run typecheck`: passed after removal.
- `npm run build`: passed after removal (existing Vite dynamic-import and chunk-size warnings only).
- Weekly-planning suite after removal: 408 files passed, 10 skipped; 1,933 tests passed, 45 skipped, 5 todo.
- Worker decision suite after removal: 29 files and 396 tests passed, including existing #335 security regressions.
- `git diff --check`: passed after removal.
- The retained evidence records contain typed case identifiers, labels, decisions, route outcomes, aggregate token/cost/latency metrics, and fingerprints; they do not contain prompts, user utterances, or raw provider responses. Runner and source corpus are removed, and no production code imports the evidence directory.
- Next: commit and push the no-go-only diff, open one PR against `main`, and verify its exact file list and checks.

## Pull request checkpoint — 2026-09-28

- PR #349: https://github.com/kame447/StudyPlanner/pull/349 (base `main`, existing Issue #305 and branch reused; no new Issue or branch).
- C9-removal commit: `1b7dd5e6aad7b267f62868d356bfe37ef06982fe`, pushed to `origin/feat/issue-305-jev-first-proposal-reject`.
- At PR opening (`1b7dd5e6`), the file list was exactly this record plus the four typed evidence artifacts.
- Current scope (after review follow-ups) is seven files, all docs or typed evidence, with no runtime code:
  - this record
  - the four typed evidence artifacts
  - `20260927-issue305-jev-phase2-luna-inventory.md` (phase 3 re-inventory appended)
  - `work/README.md` (index entries) GitHub checks are running on the PR; review/merge remains for the repository's normal review process.

- PR checks on code-identical commit `f8b74de2aec5432a8d2cc6dfffb571bfa913a847`, all success:
  - CI / verify — Actions run `36337981512`
  - Browser Regression / chromium — Actions run `36337981481`
  - Admin Overview Render / chromium — Actions run `36337981484`
  - Cloudflare Pages — deployment `1207d021-8c56-4e6d-a9e3-0d849040b5ea` (not a GitHub Actions run)
- Later commits on the PR change only this record and typed evidence metadata. Checks on the final PR head are recorded in the Issue #305 checkpoint, not here.
