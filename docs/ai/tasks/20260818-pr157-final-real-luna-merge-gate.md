# PR #157 final Real Luna merge gate

Status: active / PR #157
Updated: 2026-08-18
Branch: `agent/issue156-prompt-simplification-adversarial-audit`
Issue: #156
PR: #157

## Purpose

Finish the adversarial follow-up to PR #130 without adding sentence-specific patches. The final gate verifies that typed application decisions, human grounding, progress/correction handling, and dialogue realization still agree under repeated real `gpt-5.6-luna` runs.

## Current state

PR #157 contains the generalized fixes found during Issue #156. Deterministic CI and Browser Regression were green before the final Real Luna gate. The previous external blocker was OpenAI API quota exhaustion; the provider smoke is now succeeding again.

The repository now has a persistent assistant-triggered real-API path. Updating `.github/weekly-planning-real-api-command.json` on an `agent/**` branch starts the real-Luna checkpoint workflow. Use `checkpoint` for focused stochastic checks and `merge-gate` for the full repeated audit.

## Final acceptance

Before merge:

- deterministic CI and Browser Regression are green on the final branch state;
- repeated real-Luna merge-gate runs complete successfully;
- visible transcripts and resulting Fact Graph/application state are reviewed, not only the test exit code;
- open-ended progress does not invent page/slide/problem totals;
- fixed totals and explicit quantities remain exact;
- side contributions are acknowledged before the prior pending question resumes;
- 100% completion does not ask the same progress question again;
- correction from completed to incomplete reopens remaining work correctly;
- percentage to exact-quantity transition does not double-schedule;
- all runtime question classes receive a safe typed intent;
- no raw Japanese semantic keyword/regex routing or fixed normal-path Japanese response is added to make the audit pass;
- canonical status, roadmap, docs index, PR description, and this task reflect the final state.

If a real-Luna run exposes a meaningful defect, stop the merge path, add deterministic regression coverage where possible, fix the owning layer generally, and rerun from the same gate.

## After merge

Close Issue #156, remove the PR branch after confirming main contains the merge, then continue with the next independent priority. Issue #115 and Issue #52 remain separate scopes.
