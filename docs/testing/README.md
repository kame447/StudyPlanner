# Testing documentation index

Updated: 2026-08-22

## Current policy

Weekly-planning current test policy:

- `../ai/testing/weekly-planning-test-philosophy.md`
- `../ai/testing/weekly-planning-real-api-eval-policy.md`

Repository execution surfaces:

- unit / integration / component / property tests under `src/**`
- Playwright E2E under `tests/e2e/`
- CI under `.github/workflows/ci.yml`
- Browser Regression under `.github/workflows/browser-regression.yml`

Exact AI wording is not the primary automated oracle. Automate deterministic contracts; use real-model / human review where semantic or conversational quality cannot be reduced to a stable exact string.

## Historical roleplay documents

- `weekly-planning-roleplay-test-plan.md` — V4-era scenario / audit specification
- `weekly-planning-roleplay-status.md` — historical coverage snapshot

These files are evidence for older behavior and scenario design, not the current implementation queue. Current status comes from current code/tests, `docs/ai/weekly-planning-current-contract-status.md`, open Issues and active tasks.
