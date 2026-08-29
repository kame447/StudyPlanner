# Registered material planning context checkpoint

Status: active

Owner Issue: #187
Branch: `research/material-metadata-apis`
PR: #221

## Goal

Registered bookshelf material facts should reduce repeated questions in weekly planning without copying mutable bookshelf progress into the Stable V5 Fact Graph or durable conversation memory.

## Current behavior under verification

- Weekly planning receives a bounded registered-material context per owner from the bookshelf runtime.
- Book identity is matched by normalized title/catalog title/aliases.
- Exact unique matches are preferred; ambiguous aliases do not auto-bind.
- Cover URLs, uploaded image data, and user identity are excluded from prompt-facing registered material context.
- When a uniquely matched material has pace management enabled and valid total/current progress, dialogue asks for the plan-local target scope instead of asking for already-known total/current progress again.
- Example: a saved material with total 1000 words and current 200 words can state the known 800-word remainder and ask whether this plan should cover all remaining work or a smaller specified scope.
- The bookshelf remains the current source of truth. Stored `scope_total` / `completed` facts are not copied into the weekly-planning Fact Graph.
- If the user explicitly chooses all remaining work, semantic interpretation may create a new plan-local `remaining` workload using the uniquely matched material's current `remainingUnits` / unit as contextual grounding. This represents the newly chosen plan scope, not a duplicate bookshelf progress record.

## Safety boundaries

- No raw-text regex or deterministic keyword parsing is introduced for user intent.
- Ambiguous material matches fall back to the existing clarification path.
- `paceEnabled=false`, invalid progress bounds, or missing units do not enable registered-progress reuse.
- Scheduler placement, readiness, lifecycle mutation, preview approval, and persistence remain deterministic responsibilities.

## Verification required before completion

- TypeScript checks
- unit tests including registered-material target-scope and remaining-scope prompt contracts
- Firestore rules regression
- production build
- PR diff check
- Browser Regression
- UI Regression Matrix
- UI Quality Automation
- Admin Overview Render
- exact latest-main comparison and re-sync if necessary
- final PR review/comment audit

Do not merge PR #221 without explicit user instruction.
