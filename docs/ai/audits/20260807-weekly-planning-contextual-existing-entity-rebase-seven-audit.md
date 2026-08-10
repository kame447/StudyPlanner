# Contextual existing-entity rebase seven-view audit

Date: 2026-08-07

## Observed failure

A pending `work_breakdown` answer was finally normalized correctly:

- exact existing homework task public ID was returned;
- current constituents were represented as study components;
- decomposition status was `decomposed`;
- old uncertainty was semantically resolved;
- no priority relation was emitted.

The workflow still produced a duplicate homework task in the Fact Graph. New components were attached to the duplicate task, while the original `work_breakdown` uncertainty remained associated with the original task.

## Root cause

The ordinary semantic pipeline runs `applyWeeklyPlanningExistingEntityBindingsV5`, which removes temporary task/component containers produced by canonicalization and rebases new child facts onto exact accepted public IDs.

The contextual-answer branch explicitly skips this application and returns `not_applicable` whenever `contextualAnswer` exists. A semantic-uncertainty answer is canonicalized through the same canonicalizer, so it can create the same temporary containers, but the exact-ID rebase stage is bypassed.

This is a pipeline boundary inconsistency, not a task-decomposition-specific bug.

## Seven views

1. Identity: `existingPublicId` must mean the same thing in ordinary turns and typed clarification turns. Contextual execution must not weaken exact identity.
2. Graph: temporary containers created only to carry current-turn children must never remain active when they bind to an accepted task/component.
3. Lifecycle: resolving an uncertainty and rebasing the resolved delta must be atomic from the caller's perspective. The uncertainty must retire only on the graph where new facts are attached to the exact target.
4. Semantic ownership: core may rebase by exact public ID because AI already selected identity; core must not use title similarity or Japanese text.
5. Contextual special cases: direct quantity-role/effort answer paths create facts directly against their machine-selected target and do not require temporary-container rebasing. Full `semantic_uncertainty` document answers do.
6. Regression: do not enable rebasing blindly for every contextual branch. Apply it to contextual semantic-document canonicalization where `localToFactId` exists; preserve direct contextual effort/quantity paths.
7. Testing: verify one accepted target remains active, current components/workloads attach to it, temporary container disappears, uncertainty is inactive/removed, and ordinary cross-turn binding remains unchanged.

## Generalized fix

After a `semantic_uncertainty` contextual answer has produced a canonicalization result, run the same `applyWeeklyPlanningExistingEntityBindingsV5` stage used by the ordinary semantic path before downstream correction/scheduler processing.

Use the pre-turn graph as `originalGraph`, the accepted semantic document as the binding contract, and the contextual canonicalization result as the graph to rebase.

Do not run this rebase on direct contextual effort/quantity-role paths unless they later move to document canonicalization.
