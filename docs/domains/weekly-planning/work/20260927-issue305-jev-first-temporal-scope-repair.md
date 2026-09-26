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

## Tuning-only gate and Luna fallback fix

The first remote tuning run used the original conservative gate and the exact
production Luna repair contract: the production message builder, strict JSON
schema response format, and `max_completion_tokens=60`. Jev directly resolved
2/48 cases and sent 46 to Luna. Of those fallback calls, 14 succeeded, 24
returned HTTP 200 without decision content, and 8 returned upstream HTTP 400.
The 32 failures were recorded as typed status only; no provider text or corpus
source text is stored in evidence. This corrects the less precise description
that all 32 were empty HTTP-200 responses.

The failure is an existing Luna fallback defect rather than a Jev failure:
GPT-5.6 Luna consumes completion tokens for reasoning before emitting the
strict structured result. Three repairs were considered: 120 tokens (small but
without evidence of adequate reasoning headroom), the Worker-wide 4,096-token
ceiling (unnecessarily broad), and 320 tokens (already used by two focused
repair routes and still far below the Worker ceiling). The 320-token option was
selected and locked by regression test. A second tuning-only run completed all
20 Luna fallbacks without a case failure.

Gate tuning compared the sealed original, a broad candidate, and a per-choice
conservative candidate. The broad candidate increased direct coverage but had
the largest untested blast radius. The selected policy requires, for
`plan_unavailable`, confidence >= 0.85, selected probability >= 0.90,
condition-change <= 0.60, and independent-meaning <= 0.65. The safe
`uncertain` result uses confidence >= 0.80, selected probability >= 0.85,
condition-change <= 0.90, and independent-meaning <= 0.95. On tuning it directly
accepted 28/48 cases and made 0 direct false `plan_unavailable` decisions among
32 negative cases / 16 negative groups (one-sided 95% Clopper-Pearson upper
bounds: 8.94% by case, 17.07% by group).

The final Jev-first outcomes had two false `plan_unavailable` decisions:
`t-security-system-2` and `t-security-role-tag-1`. Both labels are
`synthetic_unreviewed`; in both cases the Jev gate abstained with `uncertain`
and the real Luna fallback produced the false decision. They are not counted as
Jev direct accepts. The final tuning agreement was 46/48; this is synthetic
label agreement, not accuracy or human-gold evidence.

Frozen after tuning and before opening holdout:

- catalog SHA-256 (unchanged): `bbd97044191d49150bba37d41bb08039b61fb846c789e329cf27fb2da3bef942`
- gate SHA-256: `a5c07054ced1a030e55b59d5c1a7f7775a084ac4c95c167131c08acf36998ea5`
- corpus SHA-256 (unchanged): `31ad21270a9ad5495fca624621d39af0deea10585e0b8c5bce63ce908759cbf7`
- typed evidence: `temporal-scope-tuning-legacy60-20260927.json` and
  `temporal-scope-tuning-v2-20260927.json`
- holdout state: sealed, unconsumed; execution is blocked until the parent
  commits this frozen gate/catalog and confirms its hash

## Current checkpoint

Completed:

- bounded typed decision context and validator
- normalizer projection and request correlation
- dedicated conservative policy with stricter `plan_unavailable` gate
- production dispatch with off/shadow/canary behavior and real Luna fallback
- group-separated 96-case corpus and pre-tuning seal
- local focused tests: 30/30 passing at the first seal checkpoint
- Issue #335 routing plus real Worker containment: 89/89 passing; an additional
  Worker regression proves a low-confidence Jev result reaches Luna without
  forwarding `decisionContext`
- exact route exclusion for multiple/unsupported validation errors
- runner finalized with verified Wrangler version, expiring token-protected
  remote preview, production dispatch, real Luna fallback, paired holdout mode,
  typed raw-text-free output, and fail-closed output overwrite protection
- full verification on the current tree:
  - `tsc --noEmit`: pass
  - build typecheck and Vite production build: pass (2,215 modules)
  - full Vitest: 582 files passed / 10 skipped; 3,085 tests passed / 45 skipped /
    5 todo
  - Worker `wrangler 4.140.0 deploy --dry-run`: exit 0, 459.46 KiB upload /
    92.08 KiB gzip, `JEV_MODE="off"`, `JEV_CANARY_PERCENT="0"`
  - catalog/gate/corpus fingerprints still exactly match the pre-tuning seal
  - `git diff --check`: pass
- remote tuning v1/v2 completed; the Luna completion budget defect was fixed,
  the tuned gate/catalog were frozen, and both raw-text-free typed evidence
  files passed forbidden-key and non-ASCII scans

Next concrete work:

1. Ask the parent to commit the frozen tuning gate/catalog and evidence, then
   wait for the resulting commit hash before opening holdout.
2. Execute the sealed holdout exactly once. The same invocation records
   Jev-first, fixed Luna-only, and legacy 60-token Luna-only paired routes.
3. Run the remote fault matrix through production dispatch with real Luna
   fallback.
4. Commit the typed evidence and calculate case/group Clopper–Pearson bounds,
   latency, and Jev/Luna cost ranges;
   update this record without overclaiming accuracy or broad non-degradation.
5. Request parent commit/push/PR, then follow CI to a terminal state.

Unresolved:

- holdout and fault remote evidence have not yet been produced; holdout remains
  sealed and unconsumed pending the parent's frozen-policy commit confirmation
- the legacy 60-token tuning run had 32/46 Luna fallback failures (24 empty
  HTTP-200 responses and 8 upstream HTTP-400 responses); the fixed 320-token
  tuning run had 0/20 fallback failures
- label audit completed before tuning; all labels follow explicit plan-wide,
  task-specific/safe-uncertain, or security-safe-uncertain rules, so no difficult
  case required the one allowed parent judge batch
- production configuration remains intentionally off; no rollout is authorized
