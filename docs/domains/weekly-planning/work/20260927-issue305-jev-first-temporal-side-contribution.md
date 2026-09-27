# Issue #305 — Jev-first pending-task temporal side contribution

Status: active — Jev first route rejected after one sealed holdout
Owner: HappyBell (Executor C)
Branch: `feat/issue-305-jev-first-temporal-side-contribution`
Base: `origin/main` at `2c43faaf` after PR #339 merged
Production rollout: unchanged (`JEV_MODE=off`, `JEV_CANARY_PERCENT=0`); no deploy

## Product decision and responsibility boundary

The existing Stable V5 path tries a focused Luna extraction when a valid initial
document made no semantic change and a machine pending question points to a
known task. If it finds no task temporal side contribution, generic completeness
retry still owns the rest of the user's meaning. The evaluated Jev candidate
could skip one focused Luna call on a high-confidence
`no_temporal_side_contribution` result. Luna continued to own the complete
temporal tuple, and generic retry, validation, state transitions, preview,
approval, save, and scheduling were unchanged.

**Decision: do not adopt the Jev first route.** The one sealed holdout saved
only three focused Luna calls in 48 cases while increasing generic Luna calls,
measured post-no-op latency, and known total cost. Temporal recovery was 15/16
versus 16/16 with corrected Luna alone. The Jev client and Worker routing were
removed from the PR. Production keeps the existing Luna route and receives two
independent fixes to that route's token budget and response schema.

Three candidate actions were compared before implementation:

1. Let Jev produce the complete date/time tuple. The evidence does not support
   free-value extraction, and this would overlap Luna's semantic ownership.
2. Add a general focused-routing framework. It would enlarge the shared surface
   across units #1–#4 and complicate concurrent integration.
3. Add a dedicated narrow classifier that can only suppress the focused call
   on a well-supported negative decision. This had the smallest implementation
   blast radius and directly measurable false-negative risk, so it was tested.

The disconfirming evidence was a temporal case that generic retry did not
recover on the Jev route, alongside greater end-to-end work than Luna alone.
The evaluation measured direct false accepts and final results after generic
retry. Synthetic labels are unreviewed and are not human gold or model accuracy.

## Holdout seal before tuning

The corpus was written before any provider tuning and committed at `374fa643`.
Each split contains 48 cases
from 24 conversation groups: 16 temporal, 16 no-temporal, and 16 security cases,
each class spread across 8 groups. Paraphrases never cross splits. The security
and negative classes have separate case and group denominators. The holdout
runner in frozen evaluation commit `eb8f227e` verified the catalog, gate, and
corpus fingerprints before the one holdout run. The retained seal records the
holdout as consumed; the runner was removed with the rejected production route.

- catalog SHA-256: `54ae5141b3d8db74100609f9807f3a2a7bb1707d8145cba19f9a5e0e94f825ad`
- gate SHA-256: `c670beca70dec50ddcaa0abfedb4a6a6f538612f3b500cf98722d52cb5e6d6c3`
- corpus SHA-256: `f981c40cbb63f0c78fd7f08e4144978b70ffefbf52e6e573d6b34ff465fef434`
- initial holdout state: sealed, unconsumed before tuning

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
cases. Generic completeness retries still made 50 Luna calls. Six Jev
timeouts (6/48) went to real Luna, adding Jev latency before fallback; their
unreported usage also makes the v4 total Jev cost unknown. The known Luna
range including generic retries was $0.03495632–$0.08791060 for 48 turns,
using the repository Luna text pricing and unknown cache allocation. Measured
post-no-op latency including generic retries was p50 6,549 ms / p95 12,684 ms.

Typed case-level evidence (no source text or provider content) is in
`workers/ai-proxy/src/decision/evaluation/evidence/temporal-side-tuning-v1-20260927.json`
through `temporal-side-tuning-v4-20260927.json`. All four files passed a
forbidden-key and non-ASCII scan before being copied into the repository.

Frozen after v4 tuning, before holdout:

- catalog SHA-256: `54ae5141b3d8db74100609f9807f3a2a7bb1707d8145cba19f9a5e0e94f825ad`
- gate SHA-256: `63a41202c79f060accc52d8b969d2062d730843a904ffeb7a738e8014d75cd9b`
- corpus SHA-256: `f981c40cbb63f0c78fd7f08e4144978b70ffefbf52e6e573d6b34ff465fef434`
- frozen policy commit: `eb8f227e`; holdout was run once only after this commit

## One sealed holdout and decision

The holdout used 48 new cases in 24 separate conversation groups. The same
cases were run once under each of three routes: Jev first with corrected Luna,
corrected Luna alone (640 tokens), and legacy-budget Luna alone (320 tokens,
with the same narrowed schema). Each route replayed the focused result through
the production semantic normalizer after a synthetic valid initial no-op;
generic retry used real Luna. This measures the post-no-op segment, not the
initial full-document call or Firebase/quota behavior. The run's catalog,
gate, and corpus hashes matched the frozen values above. The holdout is now
**consumed** and will not be rerun or used for retuning.

| Holdout route | focused Luna | generic Luna | temporal recovery after generic retry | latency p50 / p95 | total known cost range, 48 turns |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev first + Luna 640 | 45 | 57 | 15/16 | 6,688 / 19,408 ms | $0.043073–$0.102780 |
| Luna 640 only | 48 | 53 | 16/16 | 5,827 / 13,215 ms | $0.035216–$0.091671 |
| Luna 320 only | 48 | 50 | 15/16 | 6,296 / 12,897 ms | $0.035597–$0.089311 |

Jev directly accepted three negatives out of 48 cases and avoided only those
three focused calls. It directly misaccepted 0/16 temporal cases across 0/8
groups and directly accepted 0/16 security cases across 0/8 groups. For the
temporal direct-error count, the one-sided 95% Clopper–Pearson upper limits
are 17.07% by case and 31.23% by group; the same denominators apply to the
zero security accepts. These limits are wide. Jev and Luna-only 640 each had
0 focused temporal misses and 48/48 agreement with the synthetic labels, but
that is neither human-gold accuracy nor a broad no-degradation result.

The Jev route made 102 Luna calls including generic retries, versus 101 for
Luna-only 640. Its total known cost was higher despite three focused calls
saved; this total includes reported Jev cost ($0.001541) and a Luna input-cache
price range from `aiUsagePricing.ts`. The Jev route and legacy 320 each failed
to recover timing in `h-mixed-correction-time-2`, while corrected Luna-only
recovered it. No direct Jev false negative caused this observed difference;
one paired stochastic run cannot establish its cause. The 640-versus-320
comparison is evidence for the independent Luna budget repair, not for Jev.

Fault injection after the holdout covered abstain, conflicting heads, timeout,
network, HTTP 429/500, unsupported/malformed output, model mismatch, and
provider abort. All 10 cases took the real focused Luna fallback and received
HTTP 200 with a valid temporal decision. This verifies the rejected candidate's
fallback behavior but does not justify retaining its production code.

Typed case-level holdout and fault evidence is in
`workers/ai-proxy/src/decision/evaluation/evidence/temporal-side-holdout-20260927.json`
and `temporal-side-faults-20260927.json`. Both passed a forbidden-key and
non-ASCII scan; neither contains user text or provider content. The evaluated
dispatch, policy, runner, and full fingerprint implementation remain
reproducible at `eb8f227e`. They were removed from this PR because the Jev
route was rejected. The group-separated synthetic corpus and consumed seal
remain as evaluation records and have no production imports.

## Current checkpoint

Completed: PR #339 was merged; the evaluation policy was frozen at `eb8f227e`;
the holdout was consumed once; real-Luna fault injection passed 10/10; the Jev
route was rejected. Production Jev wiring has been removed, leaving only Luna
contract repairs, their regression tests, the corpus/seal, typed evidence,
and this record. On the reduced tree, `npm run verify` passed: typecheck,
592 test files passed (10 skipped), 3,152 tests passed (45 skipped, 5 todo),
and production build. A focused 49-test run including the existing #335
unknown-purpose containment regression and the new real-Worker 640-token
regression passed. Worker production deploy dry-run passed (473.57 KiB / gzip
93.59 KiB, `JEV_MODE=off`, canary 0). Both holdout and fault evidence files
match the scanned temporary outputs byte-for-byte; `git diff --check` passed.

Next: ask the parent to commit/push the reduced diff and create the PR. Follow
terminal CI and review on that exact state. Git writes and PR publication are
parent-owned; no production deployment occurred.

## PR body draft for the parent

**Suggested title:** `fix(weekly-planning): repair focused temporal Luna response contract`

**Summary:** Increase the focused Luna completion budget from 320 to 640 after
two real HTTP 200 replies exhausted 320/320 tokens and returned empty content.
Narrow the named-period response schema to the values already accepted by the
strict parser. The parser and semantic ownership boundary are unchanged.

**Evaluation decision:** Reject the Jev first route. In one sealed paired
48-case holdout, it saved 3 focused Luna calls but made 57 generic Luna calls
versus 53 for corrected Luna alone. Temporal recovery after generic retry was
15/16 versus 16/16; post-no-op latency p50/p95 was 6,688/19,408 ms versus
5,827/13,215 ms; known total cost range was $0.043073–$0.102780 versus
$0.035216–$0.091671. Tuning v4 had six Jev timeouts out of 48 cases, each
followed by real Luna. The direct temporal false-accept count was 0/16 cases
and 0/8 groups, but its one-sided 95% upper limits are 17.07% and 31.23%.
The single synthetic run does not establish general model accuracy or a
causal quality difference. Do not attribute the corrected Luna 640-versus-320
recovery observation (16/16 versus 15/16) to Jev.

**Reproducibility:** The holdout corpus was sealed before tuning at `374fa643`,
and policy, runner, and full fingerprints were frozen at `eb8f227e`. The
holdout was run once and is marked consumed. The rejected Jev production
modules and dependent runner were removed; the independent corpus, seal, typed
case evidence, and work record remain. Fault injection 10/10 reached real
focused Luna and received HTTP 200. This post-no-op replay does not include
the initial full-document call or Firebase/quota behavior; Luna cost is a
range because upstream cache allocation is unknown.

**Verification:** `npm run verify` passed (typecheck, 592 test files / 3,152
tests passed, production build). A focused 49-test run covered request and real
Worker upstream 640-token limits, schema, and #335 unknown-purpose containment.
Worker deploy dry-run passed (473.57 KiB / gzip 93.59 KiB) with Jev off/0.
No production deployment occurred. Refs: #305, #333, #335.
