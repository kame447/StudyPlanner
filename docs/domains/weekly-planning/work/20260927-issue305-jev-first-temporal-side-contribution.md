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

## Tuning-only calibration and existing Luna contract repairs

All results below came from a temporary remote Worker and the production
`dispatchTemporalSideContribution` function. The focused Luna fallback used
the production prompt and strict response format. The post-no-op measurement
replayed that focused result through the production semantic normalizer after
a synthetic schema-valid initial no-op; generic retries used real Luna. It
does not measure Firebase authentication, quotas, or the initial full-document
Luna normalization. No tuning result opened the holdout.

| tuning run | focused token limit / schema | Jev direct negative accepts | focused Luna calls | direct false negative | findings |
| --- | --- | ---: | ---: | ---: | --- |
| v1 | 320 / original | 0/48 | 48/48 | 0/16 temporal | initial gate too strict; two empty Luna replies and three parser rejects |
| v2 | 320 / original, moderate gate | 5/48 | 43/48 | 0/16 temporal | two empty replies had HTTP 200, `finish_reason=length`, completion 320/320; four parser rejects had `finish_reason=stop` and no schema violation |
| v3 | 640 / original, moderate gate | 4/48 | 44/48 | 0/16 temporal | no empty replies; three parser rejects were all `period_noncanonical`; generic recovered timing in 14/16 temporal cases |
| v4 | 640 / narrowed named-period schema, moderate gate | 5/48 | 43/48 | 0/16 temporal | no focused failure or parser rejection; generic recovered timing in 16/16 temporal cases; Jev timed out in six cases and real Luna handled them |

The v2 gate was selected from tuning-only typed results. The sealed initial
gate accepted 0/48. A broader candidate accepted 12/48 but included one
security case. The selected gate requires confidence >= 0.97, selected
probability >= 0.98, temporal-possibility Noul <= 0.25, and target-ambiguity
Noul <= 0.50. It accepted five v4 cases, none from the temporal or security
classes. Direct false-negative 0/16 temporal cases has one-sided 95%
Clopper–Pearson upper bounds of 17.07% by case and 31.23% by eight temporal
conversation groups. These are wide limits, and labels are synthetic and
unreviewed. The 46/48 final v4 label matches are agreement, not accuracy.

The two empty 320-token Luna replies exhausted the completion budget. Raising
the focused limit to 640 removed empty replies in v3 and v4 tuning. The
noncanonical named periods exposed a separate schema/parser mismatch: the
response schema had permitted every string, while the existing parser accepts
only the canonical enum or `custom:` values. The schema was narrowed; parser
validation was not relaxed. v4 had no focused parser rejection. These repairs
are Luna baseline fixes, not savings or quality gains attributable to Jev.

The selected v4 route avoided **five focused Luna calls** in 48 synthetic
cases. Generic completeness retries were still invoked 50 times. Six Jev
timeouts followed by real Luna kept the fallback operational. The v4 total
cost is not fully known because timed-out Jev calls have no reported usage;
the known Luna range including generic retries is $0.03495632–$0.08791060
for 48 turns, using the repository Luna text pricing and unknown cache
allocation. Measured post-no-op latency including generic retries was p50
6,549 ms / p95 12,684 ms. The paired holdout, rather than this tuning run,
will compare latency and total cost with Luna-only routes.

Typed case-level evidence (no source text or provider content) is in
`workers/ai-proxy/src/decision/evaluation/evidence/temporal-side-tuning-v1-20260927.json`
through `temporal-side-tuning-v4-20260927.json`. All four files passed a
forbidden-key and non-ASCII scan before being copied into the repository.

Frozen after v4 tuning, before holdout:

- catalog SHA-256: `54ae5141b3d8db74100609f9807f3a2a7bb1707d8145cba19f9a5e0e94f825ad`
- gate SHA-256: `63a41202c79f060accc52d8b969d2062d730843a904ffeb7a738e8014d75cd9b`
- corpus SHA-256: `f981c40cbb63f0c78fd7f08e4144978b70ffefbf52e6e573d6b34ff465fef434`
- holdout state: sealed, unconsumed; run only after the parent commits this frozen policy

## Current checkpoint

Completed: PR #339 was merged and main integrated at `b8883e90`; focused
context, Worker dispatch, parser-compatible direct negative response, bounded
client projection, group-separated corpus, tuning v1–v4, response contract
repairs, typed evidence, and #335 Worker containment tests are implemented.
The v4 policy is frozen and the holdout is still unconsumed. Typecheck and
production build pass. The full suite passed on this frozen tree: 593 test
files passed, 10 skipped; 3,195 tests passed, 45 skipped, 5 todo. The Worker
production deploy dry-run passed with `JEV_MODE=off` and canary 0. The runner
syntax check and `git diff --check` passed. No production deployment occurred.

Next: parent commit/push of the frozen
policy; one sealed holdout with Jev-first, Luna-only 640, and legacy Luna-only
320 on the same 48 cases; real-Luna fault injection; terminal CI and audit.
The holdout must be marked consumed immediately after its one run. Git writes
and PR publication are parent-owned.
