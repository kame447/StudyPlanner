# Issue #305 — Jev-first pending-task temporal side contribution

Status: active
Owner: HappyBell (Executor C)
Branch: `feat/issue-305-jev-first-temporal-side-contribution`
Base: `origin/main` at `a841b68656bf2d9a2c823833c6dbbb9d9cb50f73`
Production rollout: unchanged (`JEV_MODE=off`, `JEV_CANARY_PERCENT=0`); no deploy

## Boundary and candidate choice

The existing Stable V5 path tries a focused Luna extraction when a valid initial
document made no semantic change and a machine pending question points to a
known task. If it finds no task temporal side contribution, generic completeness
retry still owns the rest of the user's meaning. This unit may skip only that
single focused Luna call when Jev gives a high-confidence, non-conflicting
`no_temporal_side_contribution` result. Luna still owns the complete temporal
tuple whenever a temporal constraint is possible or the classifier abstains or
fails. Generic retry, validation, state transitions, preview, approval, save,
and scheduling remain unchanged.

Three candidate actions were compared before implementation:

1. Let Jev produce the complete date/time tuple. The evidence does not support
   free-value extraction, and this would overlap Luna's semantic ownership.
2. Add a general focused-routing framework. It would enlarge the shared surface
   across units #1–#4 and complicate concurrent integration.
3. Add a dedicated narrow classifier that can only suppress the focused call
   on a well-supported negative decision. This has the smallest blast radius
   and directly measurable false-negative risk, so it was selected.

What would make this interpretation wrong: an explicit or indirect task timing
condition in a Jev-accepted negative case, or evidence that the generic retry
does not recover it. The evaluation measures both the direct false accept and
the final result after the generic retry. Synthetic labels are unreviewed and
are not human gold or model accuracy.

## Holdout seal before tuning

The corpus was written before any provider tuning. Each split contains 48 cases
from 24 conversation groups: 16 temporal, 16 no-temporal, and 16 security cases,
each class spread across 8 groups. Paraphrases never cross splits. The security
and negative classes have separate case and group denominators. The holdout
runner must verify the recorded catalog, gate, and corpus fingerprints and must
refuse a second run after the holdout is marked consumed.

- catalog SHA-256: `54ae5141b3d8db74100609f9807f3a2a7bb1707d8145cba19f9a5e0e94f825ad`
- gate SHA-256: `c670beca70dec50ddcaa0abfedb4a6a6f538612f3b500cf98722d52cb5e6d6c3`
- corpus SHA-256: `f981c40cbb63f0c78fd7f08e4144978b70ffefbf52e6e573d6b34ff465fef434`
- holdout state: sealed, unconsumed

## Current checkpoint

Completed: task and current Stable V5 boundary inspected; dedicated bounded
context, first conservative catalog/gate, 96-case group-separated corpus, and
pre-tuning fingerprints added. No provider evaluation has run yet.

Next: finish focused and Worker dispatch wiring after PR #339 merge; implement
the remote runner and #335 regressions; run tuning only, freeze gate, run the
sealed holdout once against the production dispatch with real Luna fallback and
paired Luna-only baseline; classify and fix failures; run full verification;
ask the parent to commit/push and open the PR; follow terminal CI and audit.

Outstanding dependency: PR #339 is still open. Shared `worker.ts`, focused
context union, and client transport additions wait for its merge and the
parent's main integration. Git writes and publication are parent-owned.
