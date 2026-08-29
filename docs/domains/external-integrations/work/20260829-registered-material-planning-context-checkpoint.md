# Registered material planning context checkpoint

Status: verified

Owner Issue: #187
Branch: `research/material-metadata-apis`
PR: #221

## Goal

Registered bookshelf material facts should reduce repeated questions in weekly planning without copying mutable bookshelf progress into the Stable V5 Fact Graph or durable conversation memory.

## Verified behavior

- Weekly planning receives a bounded registered-material context per owner from the bookshelf runtime.
- Book identity is matched by normalized title/catalog title/aliases.
- Exact unique matches are preferred; ambiguous aliases do not auto-bind.
- Cover URLs, uploaded image data, and user identity are excluded from prompt-facing registered material context.
- When a uniquely matched material has pace management enabled and valid total/current progress, dialogue asks for the plan-local target scope instead of asking for already-known total/current progress again.
- Example: a saved material with total 1000 words and current 200 words can state the known 800-word remainder and ask whether this plan should cover all remaining work or a smaller specified scope.
- The bookshelf remains the current source of truth. Stored `scope_total` / `completed` facts are not copied into the weekly-planning Fact Graph.
- If the user explicitly chooses all remaining work, semantic interpretation may create a new plan-local `remaining` workload using the uniquely matched material's current `remainingUnits` / unit as contextual grounding. This represents the newly chosen plan scope, not a duplicate bookshelf progress record.
- Prompt wording is kept compact, while tests assert semantic contracts rather than stale exact prose. `existing_target_progress` remains current-progress-only and does not ask for another work item; all-complete flows do not re-ask the same progress.

## Safety boundaries

- No raw-text regex or deterministic keyword parsing is introduced for user intent.
- Ambiguous material matches fall back to the existing clarification path.
- `paceEnabled=false`, invalid progress bounds, or missing units do not enable registered-progress reuse.
- Scheduler placement, readiness, lifecycle mutation, preview approval, and persistence remain deterministic responsibilities.
- Saved bookshelf facts are context, not current-turn semantic output; they are not replayed into the Fact Graph as user-stated facts.

## Verification

Code verification HEAD before this checkpoint-only update: `e1974eb248c50b16a72620890d7dc3b80881e9bc`.

- CI run `33252162643`: success
  - TypeScript checks: success
  - unit tests: success
  - Firestore rules regression: success
  - production build: success
  - PR diff check: success
- Browser Regression run `33252162710`: success
- UI Regression Matrix run `33252162651`: success
- UI Quality Automation run `33252162624`: success
- Admin Overview Render run `33252162649`: success
- latest `main` at verification: `f3b0aca0b9f0c1a7cfd91099256115c5119d5fa5`
- branch was `behind 0`

The checkpoint update itself is documentation-only. Required workflows must also be checked on the resulting exact final HEAD before final completion is reported.

Do not merge PR #221 without explicit user instruction.
