# Contextual semantic repair anchoring seven-view audit

Date: 2026-08-07

## Observation

During a pending `work_breakdown` answer, the initial semantic output copied the old target/uncertainty instead of interpreting the current constituent list. Validation correctly rejected it.

The repair request then contained the exact target public ID and explicit generalized requirements: one target task only, current-turn evidence, constituent work on that task, no old uncertainty or unrelated state. Despite this, the provider returned essentially the same old target/uncertainty again.

The repair message sequence currently includes the invalid provider JSON as an `assistant` message immediately before the repair instruction. For a typed contextual turn this can anchor the model on the invalid structure it is supposed to discard.

## Seven views

1. Conversation: a clarification answer should be reinterpreted from the current user answer, not repeatedly echo the previous invalid state.
2. Semantic ownership: AI remains responsible for interpreting the constituent items; code must not manufacture components.
3. Context: the authoritative context is `current userText + publicStateSummary.pendingQuestion + exact target`, not the invalid provider output.
4. Repair: typed contextual repairs should be fresh retries from authoritative context plus validation errors. The invalid JSON may be useful for generic schema repair, but it is harmful when the required action is to discard its stale semantic structure.
5. Safety: fresh retry does not relax validators. The corrected response must still satisfy exact-target, grounding, schema, recurrence, and evidence checks.
6. Generalization: select fresh contextual repair by typed pending state (`work_breakdown`), never by Japanese wording or scenario labels. Generic non-contextual schema repair keeps the existing invalid-response-assisted path.
7. Testing/observability: assert that a work-breakdown repair request does not include the invalid JSON as an assistant turn, while ordinary schema repair still does; then rerun the same real API turn and a different structurally equivalent scenario.

## Fix

For pending `work_breakdown` only, construct repair messages from the original base messages plus a repair instruction containing the exact typed context and validation errors. Do not append the invalid response as an assistant message. Keep one repair attempt and all existing validators.
