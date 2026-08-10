# Work breakdown resolution seven-view audit addendum

Date: 2026-08-07

## Observed retry failure

Pending question: `semantic_uncertainty / work_breakdown`, exact target task already known.

Current user answer: `数学のワークと古典の課題が残ってます。数学のワークの方が量は多いです。`

Initial provider output ignored the current constituents, repeated the old target task as `needs_breakdown`, and repeated the old uncertainty evidence. Grounding rejected it.

Repair output recognized the two current items but emitted them as two new top-level tasks while leaving the exact target task as `needs_breakdown`. The algorithmic decomposition normalizer then derived the old uncertainty again from the stale target task, so grounding rejected the repair too.

## Seven views

1. Conversation: a direct answer to “what remains?” must advance the decomposition instead of asking the same breakdown question again.
2. Semantic ownership: code must not infer that particular Japanese nouns are children. AI must place current constituents on the exact pending target.
3. Identity: while resolving one exact work-breakdown target, the semantic delta must contain exactly that target task. Extra top-level tasks are ambiguous and must fail closed.
4. Evidence: the target task used to resolve or continue the breakdown must carry current-turn evidence. Old source text is not a valid answer to the pending question.
5. Lifecycle: `needs_breakdown` may remain only when the current answer itself is insufficient; if retained, the newly derived uncertainty must be grounded in the current answer, not copied from the prior turn.
6. Repair/generalization: whenever validation fails during a typed pending work-breakdown turn, repair instructions must include the work-breakdown contract even when the first concrete error is only generic grounding. Do not rely on a `work-breakdown-*` error having happened first.
7. Regression/observability: validate this contract on the original sentence and on a different broad-study-task sentence without changing production prompts. Inspect raw provider JSON and the actual next Japanese reply, not workflow status alone.

## Generalized fix

- Pass current user text into the work-breakdown response validator.
- Require exactly one semantic task during a pending work-breakdown answer, bound by exact `existingPublicId` to the pending target.
- Require that target task's `sourceText` be grounded in the current user text.
- Reject extra new or existing top-level tasks in this typed turn.
- Keep `needs_breakdown` legal for genuinely insufficient current answers, but only with current evidence.
- Make repair-message construction aware of the typed pending question so the breakdown directive is always included on a failed breakdown-answer attempt.
- Do not deterministically move new tasks into components; only AI may interpret and place constituents.
