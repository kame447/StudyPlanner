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
- holdout state at freeze: sealed and unconsumed; parent committed the frozen
  policy as `7b45cc8f` before execution

## Single holdout, paired baselines, and faults

After checking out the parent's frozen-policy commit `7b45cc8f`, the runner
reconfirmed all three hashes and opened the holdout exactly once. One remote
invocation produced 144 typed records: 48 Jev-first, the same 48 through fixed
320-token Luna only, and the same 48 through legacy 60-token Luna only. The
repository seal is now `consumed: true`, so another holdout attempt fails
closed. No gate, catalog, corpus, or label was changed after opening it.

Jev-first directly accepted 31/48 cases and used Luna for 17. Its final
synthetic-label agreement was 46/48. It produced 2 false
`plan_unavailable` decisions among 32 negative cases and 16 negative groups:
`h-security-xml-2` and `h-security-abnormal-1`. Both labels are
`synthetic_unreviewed`, both Jev decisions were withheld by the gate with
reason `uncertain`, and both false decisions came from the real Luna fallback.
The Jev direct path itself had 0 false `plan_unavailable` decisions across all
32 negative cases / 16 groups (one-sided 95% Clopper-Pearson upper bounds:
8.94% by case and 17.07% by group). For the final Jev-first route, the 2/32
case and 2/16 group upper bounds are 18.39% and 34.38%, respectively.

Fixed Luna-only also produced 2 false `plan_unavailable` decisions among the
same 32 negatives / 16 groups, with the same 18.39% case and 34.38% group
upper bounds. Its cases were `h-security-markdown-2` and
`h-security-abnormal-1`; it also returned `uncertain` for one positive case,
so synthetic-label agreement was 45/48. Jev-first therefore did not increase
the false-plan count relative to fixed Luna in this one paired holdout. This is
not a broad no-degradation or accuracy claim: the false case identities differ,
labels are not human gold, and the sample contains only 24 conversation groups.

In this sample, Jev-first avoided 31 of the 48 Luna calls. Its measured total
latency was p50 374 ms / p95 1,908 ms, versus fixed Luna-only p50 1,208 ms /
p95 1,915 ms. With every call reporting usage, Jev-first total cost was
$0.003276702-$0.003865272 ($0.000068264625-$0.0000805265 per turn), while
fixed Luna-only was $0.0043107-$0.00598395
($0.00008980625-$0.000124665625 per turn). Ranges reflect the absent Luna
cache-allocation breakdown and use repository pricing; they apply only to this
holdout.

The legacy 60-token baseline failed 32/48 calls: 24 returned HTTP 200 without
decision content and 8 returned upstream HTTP 400. Its apparent zero
false-plan count is therefore not a safety improvement and is not credited to
Jev. Usage was present for only 16 calls; their known cost range was
$0.00096868-$0.0015239, while the total cost outside that known range is
unknown because the 32 failed calls reported no usage.

The separate fault invocation exercised abstain, conflicting heads, timeout,
network failure, HTTP 429, HTTP 500, unsupported output, malformed output,
model mismatch, and provider cancellation through production dispatch. All
10 cases reached real 320-token Luna fallback, returned HTTP 200 with the
closed `uncertain` decision, and had zero response-key or decision-key
containment errors. Typed evidence is in
`temporal-scope-holdout-20260927.json` and
`temporal-scope-faults-20260927.json`; both passed forbidden-key and non-ASCII
scans and contain no corpus or provider raw text.

The tuning false decisions `t-security-system-2` and
`t-security-role-tag-1` likewise occurred only after Jev abstained and Luna
followed injected text. Together with the holdout security failures, these are
Luna injection-resistance findings to return to Issue #335 (safety) and Issue
#333 (Japanese behavior), separately from the Jev result.

## Current checkpoint

Completed:

- bounded typed decision context and validator
- normalizer projection and request correlation
- dedicated conservative policy with stricter `plan_unavailable` gate
- production dispatch with off/shadow/canary behavior and real Luna fallback
- group-separated 96-case corpus and pre-tuning seal
- local focused tests: 30/30 passing at the first seal checkpoint
- Issue #335 routing plus real Worker containment: 90/90 passing; an additional
  Worker regression proves a low-confidence Jev result reaches Luna without
  forwarding `decisionContext`
- exact route exclusion for multiple/unsupported validation errors
- runner finalized with verified Wrangler version, expiring token-protected
  remote preview, production dispatch, real Luna fallback, paired holdout mode,
  typed raw-text-free output, and fail-closed output overwrite protection
- full verification on the current tree:
  - `tsc --noEmit`: pass
  - build typecheck and Vite production build: pass (2,215 modules)
  - full Vitest: 582 files passed / 10 skipped; 3,086 tests passed / 45 skipped /
    5 todo
  - Worker `wrangler 4.140.0 deploy --dry-run`: exit 0, 459.46 KiB upload /
    92.08 KiB gzip, `JEV_MODE="off"`, `JEV_CANARY_PERCENT="0"`
  - catalog/gate/corpus fingerprints exactly match the frozen holdout seal
  - `git diff --check`: pass
- remote tuning v1/v2 completed; the Luna completion budget defect was fixed,
  the tuned gate/catalog were frozen, and both raw-text-free typed evidence
  files passed forbidden-key and non-ASCII scans
- the single sealed holdout, both paired Luna baselines, and all 10 remote
  faults completed; the holdout is consumed and the two final evidence files
  are raw-text-free

Next concrete work:

1. Run final typecheck, full tests, build, production Worker dry-run, exact diff,
   seal, and evidence-privacy checks on the post-holdout tree.
2. Ask the parent to commit/push the consumed seal, typed holdout/fault evidence,
   and final record, with a PR body draft that scopes all claims to this sample.
3. Follow PR review and CI to terminal state; resolve failures without reopening
   or retuning the consumed holdout.

Unresolved:

- the legacy 60-token tuning run had 32/46 Luna fallback failures (24 empty
  HTTP-200 responses and 8 upstream HTTP-400 responses); the fixed 320-token
  tuning run had 0/20 fallback failures
- fixed Luna remains susceptible to some injected security text: two tuning and
  two holdout Jev-first false decisions occurred after Jev abstention and must
  be tracked in #333/#335 rather than attributed to the Jev direct path
- label audit completed before tuning; all labels follow explicit plan-wide,
  task-specific/safe-uncertain, or security-safe-uncertain rules, so no difficult
  case required the one allowed parent judge batch
- production configuration remains intentionally off; no rollout is authorized
