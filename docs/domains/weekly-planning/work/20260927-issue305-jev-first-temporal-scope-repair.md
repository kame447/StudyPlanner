# Issue #305 — Jev-first temporal-scope repair

Status: active  
Owner: LivelyYukawa (Executor A)  
Branch: `feat/issue-305-jev-first-temporal-scope-repair`  
Base: `origin/main` at `d3623479`  
Production rollout: unchanged (`JEV_MODE=off`, `JEV_CANARY_PERCENT=0`); no deploy

## Scope and safety boundary

This unit makes only the existing Stable V5 repair for
`date-rule-cannot-have-clock` Jev-first. The decision is limited to whether the
already interpreted date/time is clearly unavailable for the whole plan or must
remain uncertain. Deterministic code still selects the exact validation path,
applies the repair, validates the complete document, and owns every lifecycle,
scheduling, preview, approval, save, and persistence decision.

The provider projection contains only source text, the attached task title, and
the typed date/time. It contains no canonical IDs or full Fact Graph. Older
Workers ignore the new purpose and continue to Luna; a Worker that recognizes
the purpose rejects malformed known contexts with HTTP 400.

## Adversarial design decision

Three implementation choices were compared before editing:

1. Reuse the authorization gate. Its vocabulary and false-accept consequence are
   different; a green authorization test would not directly verify temporal
   scope and would couple independent policies.
2. Generalize every focused dispatch into one configurable framework. This would
   touch established units 1/2 and enlarge the concurrent integration surface.
3. Add a dedicated temporal policy and dispatch following the existing port and
   rollout pattern, with only one shared union/validator addition and one Worker
   branch.

Option 3 was selected because its decision boundary and Luna fallback can be
tested directly, while its production blast radius is limited to requests that
carry the valid new purpose. Evidence that would make this choice wrong would be
an existing generic policy that expresses different per-choice thresholds and
typed responses without authorization/contextual assumptions; none exists in
the current tree.

## Holdout seal (created before tuning)

The corpus was created and validated before any provider tuning call. Conversation
groups never cross splits. Each split has 48 cases: 16 plan-wide positive cases
from 8 groups, 16 non-plan-wide/uncertain cases from 8 groups, and 16 security
cases from 8 groups. Labels are `synthetic_unreviewed`; agreement is not accuracy
and is not human gold.

- catalog SHA-256: `bbd97044191d49150bba37d41bb08039b61fb846c789e329cf27fb2da3bef942`
- gate SHA-256: `662177b3339cabd4196ca2db2d82396573827f5e1777e1f1535ecc6c36d405c4`
- corpus SHA-256: `31ad21270a9ad5495fca624621d39af0deea10585e0b8c5bce63ce908759cbf7`
- holdout state: sealed, unconsumed

The holdout runner must verify all three hashes immediately before execution.
After its single run the repository seal must be changed to consumed; subsequent
holdout attempts must fail closed.

## Current checkpoint

Completed:

- bounded typed decision context and validator
- normalizer projection and request correlation
- dedicated conservative policy with stricter `plan_unavailable` gate
- production dispatch with off/shadow/canary behavior and real Luna fallback
- group-separated 96-case corpus and pre-tuning seal
- local focused tests: 30/30 passing at the first seal checkpoint

Next concrete work:

1. Add dispatch and real `worker.ts` containment regressions, including Issue
   #335 attack text and closed response keys/decision set.
2. Add the remote production-dispatch evaluation runner and raw-text-free typed
   evidence schema.
3. Run tuning only, freeze the gate, then execute the sealed holdout once and a
   paired Luna-only comparison on the same holdout.
4. Calculate case/group Clopper–Pearson bounds, latency, and Jev/Luna cost ranges;
   update this record without overclaiming accuracy or broad non-degradation.
5. Run focused tests, full typecheck/test/build, shared Wrangler dry-run, request
   parent commit/push/PR, then follow CI to a terminal state.

Unresolved:

- tuning/holdout remote evidence has not yet been produced
- no difficult case has yet required the one allowed parent judge batch
- production configuration remains intentionally off; no rollout is authorized
