# Legacy architecture review

Status: historical snapshot
Original location: `docs/architecture-review.md`
Archived: 2026-08-22

The original review described an early architecture with client-only/local storage assumptions, a rule-based parser, browser-held OpenAI-compatible configuration and direct Ollama/OpenAI-compatible access.

Those assumptions no longer describe current StudyPlanner architecture:

- Firebase authentication/repositories are used for current shared application data boundaries.
- production AI access is gateway/proxy based; provider secrets are not a browser-owned production contract.
- weekly planning uses Stable V5 with AI semantic interpretation plus deterministic validation/binding/planning/scheduling/approval boundaries.
- rule-based/raw-text parser fallback is not a current weekly-planning semantic authority.

The original DFD/ER/review text is preserved in Git history for historical investigation. Current repository navigation is `PROJECT_MAP.md`; current weekly architecture starts at `docs/architecture/README.md` and `docs/ai/weekly-planning-current-contract-v5.md`.
