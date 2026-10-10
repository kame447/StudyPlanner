# Issue #488: Stable session publication admission

Status: active / test-only fixture correction after focused failure; production typed, follow-up unexecuted
Updated: 2026-10-10 UTC

## Ownership and checkpoint

- Owning issue: [#488](https://github.com/kame447/StudyPlanner/issues/488), resumed under [the integration checkpoint](https://github.com/kame447/StudyPlanner/issues/488#issuecomment-6093252062).
- Local branch: `fix/issue488-stable-session-admission`.
- Exact base/HEAD: `ee815b476ab4c5d5c217e27846550131af544270`.
- The integration owner reports newer upstream main `cb3167a456d5b429c776874ce9cb36554a375c47`; this unit keeps its measured baseline/base until separate integration. No verification on the new main is claimed.
- Separate application/session safety unit. E-session owns partition count and session-duration placement; this unit owns admission before Stable publication and atomic draft replacement. H/J/F1/E-session are not introduced.
- No PR or remote branch publication. Seven existing production owners and four existing test suites are changed, plus this checkpoint. No new state registry or persisted mode.

## Measured baseline

Frozen test-only patch `8b1378a9dd53a7ca29104e08e2ba4a20061da44b50cb77768cc245bc2ff875d6` ran on unchanged main production with private235 locked dependencies, Node22 and one worker: selected3, failed2/passed1, engine exit1. Other29 collected rows were unselected.

1. Initial Stable one-candidate checkpoint passed actual codec read-back, but the next real controller publication exposed501 candidates rather than retaining1. The first failure was the preview count. Later committed-callback, graph/state retention, truthful-error and no-save assertions were unreached.
2. Compatibility output with a genuinely bound empty runtime accepted501 and passed all selected postconditions. Runtime presence is not Stable intent.
3. The edited-approval UI reached creation once, but cleared previous drafts first. No-approval, retained-draft and visible-error assertions followed that first failure and were unreached. The injected error tests the UI boundary, not actual count admission.

All2,329 inputs and donor/private dependency identities were preserved:235 manifests,19,305 regular file hashes/realpaths/inodes,24 internal symlinks, no shared regular inode. Baseline was fully terminated before implementation. Types/full/build were not run for the baseline. Source artifacts and the failed generation are retained outside the repository.

## Implemented candidate boundary (not verified)

- `weeklyPlanningStateCodec.ts` exposes a small pure per-collection count diagnostic from the existing500 constants. Stable codec checks and live admission use that same authority. Count errors have a dedicated application Error identity and truthful count message.
- `useWeeklyPlanningState.ts` projects an action exactly once, invokes a synchronous optional admission callback, and only then publishes its ref/React state. Reducer no-ops are not newly rejected.
- `useWeeklyPlanningApplication.ts` selects admission for ordinary commits carrying actual Stable result scope, or draft addition/approval with typed Stable provenance in the actual next state. It checks draft-status records, previews, recovery blocks and recovery operation items separately.
- `types.ts` carries transient Stable owner/conversation publication scope and optional atomic replace intent; neither is persisted. `weeklyPlanningReducer.ts` keeps append by default, with replacement as one mutation.
- `weeklyPlanningTurnController.ts` supplies scope only for actual `stableV5Graph` output. Synchronous admission rejection uses existing prepared rollback, discard, fail-turn and rethrow; its message remains visible. It is not a semantic/provider failure and consumes no AI repair.
- `AiPlanningView.tsx` replaces both clear/create sequences with one atomic replace call. Both promotion and edited-approval rejection leave the dialog/error path available; approval is not invoked after replacement failure.

Draft provenance selects a count contract, not permission to save. Existing owner/conversation, mixed metadata, runtime freshness and recovery identity validation retain approval authority. Missing runtime does not downgrade explicitly Stable drafts. Replacing all Stable drafts with genuinely compatibility-only records returns to compatibility's existing contract; mixed retained Stable + incoming compatibility remains counted. `begin_approval` admission occurs before the existing approval function's repository calls. Failure/complete recovery transitions are not blocked by a new count check.

Compatibility storage fallback, general Plan count, compiler resource bounds512, the independent2MiB envelope limit, saved-operation identities and retry behavior are unchanged. Approved/discarded history is counted as the actual Stable checkpoint does: only pending draft records count. No live200-message cap is added.

## Static controls prepared

Twenty-six targeted rows across four existing suites (counts remain static until collection/execution):

- Five actual application/controller result rows: baseline Stable rejection, compatibility-empty control,500 previews plus500 retained drafts, preserved500 ignoring incoming501, compatibility with a populated prior Stable graph. Execution output is scripted; real controller, graph staging/rollback and codec are used.
- Eight direct application projection rows: empty append/no-op versus atomic empty replace,499+1,500+1, replace500→500/501, mixed append, compatibility-only replacement501, and approved-history exclusion. These are typed count fixtures, not scheduler feasibility or live language proof.
- Three existing-state approval rows: Stable500/1 is created through the real application and read back through the Stable codec; then an explicitly marked in-memory501 fault is injected for the oversized defense case. Both Stable rows lose runtime before approval. The501 guard must reject before publication/repository and preserve the valid500 checkpoint; small missing-runtime Stable remains subject to existing approval authority. Compatibility501 is genuinely restored/saved and reapproval remains idempotent.
- Four real-codec differential rows at500/501: drafts, previews, recovery blocks and recovery operation items. Recovery.blocks501 necessarily has at least501 operation items under the existing identity contract; the operation-items row separately isolates extra saved items with one retained recovery block. Stable metadata remains rejected by the compatibility reader; valid metadata-free compatibility shapes preserve exact IDs/counts/recovery identities for the format-specific contrast. No aggregate sum is used.
- Four real owning-UI callbacks: unchanged full selection reaches actual approval/repository once without replacement; empty edited selection stops before approval/repository with visible error; dedicated admission Error injection during edited approval and promotion, preserving old drafts/preview and visible error with no pre-clear or approval.
- Two trace side-effect rows: actual failed-turn trace Error/name/message through append failure, persistent outbox retry and Worker preparation, with client/server budgets and future-field/oversize controls. No new production trace field/stage is introduced; the future field is test-only data on the existing extensible planning-state summary carrier. Error projection explicitly retains only bounded type/message; its unknown-field exclusion remains asserted.

The existing codec fallback, controller/reducer and approval/recovery suites are included in the prepared focused command. Existing old test bodies are retained; the initial baseline rows gained boundary variants and stronger Error/message/revision assertions. The failed implementation generation is retained; subsequent test-only corrections align fixture shapes and source constants with existing contracts without relaxing count, rollback, authority, Error or persistence requirements.

## Static review correction before execution

The first frozen candidate retained the old unconditional empty-add no-op. Explicit `replace: true` with an empty list now clears drafts/preview atomically, while append-empty remains a no-op and repeat empty replacement does not advance revision. The UI separately refuses an empty edited selection before approval and displays a truthful error. The position-edit helper does not itself interpret omitted blocks as deletions, so this guard also closes an existing empty-callback risk; it is not described as a newly caused clear-to-create behavior. Two actual application/UI controls retain the boundary and assert zero repository writes. Static child inspection confirms onSave receives the entire editableBlocks array (initialized from all blocks, edited by map, and resynchronized from props), never an empty edit-delta sentinel. Deletion is an immediate onRemove(id) dispatch; the existing last-deletion/empty-snapshot test remains. The new empty-callback row is defensive callback evidence, not a measured browser all-deletion gesture. Its symmetric untouched-full-selection control executes the real approval owner/repository callback and requires one save with no replacement. The first static generation remains archived; the measured implementation3 result follows below.

## Implementation3 measurement and fixture corrections

Frozen candidate `52b9ecf9c3e8e46d0d080adb8c1d176efae84c2bf5f79b2adc6fe99052532f5a`, production patch `8aca7255bc118794e14a19768dc70e45efc0dd61747cd9d1dac7ed93be207a00`: focused11 suites132/140 pass,8 fixture failures; all114 preserved old rows passed,18/26 targeted rows passed. Fresh app types, local Worker generation and fresh Worker types each exited0. All four pre/post snapshots matched2,329 inputs and235 private /19,305 donor-and-private regular file identities. The execution slot was returned.

The8 failures were:2 invalid Stable-metadata-through-compatibility restoration fixtures;3 invalid cross-format acceptance expectations (Stable500 passed,501 iteration unreached);1 incorrect Plan source string (actual approval/repository reached once, later state assertions unreached);2 future sentinels placed in the intentionally closed error projection (actual failed append/outbox/retry and Error name/message retained, Worker assertions unreached). They are not green evidence for their missing controls.

The next generation only changes these existing tests and this checkpoint. Production remains byte-identical to the typed8aca7255 patch. It uses a normal Stable500 codec path plus explicit live-state501 fault injection, independently valid compatibility shapes at identical counts, the actual Plan provenance constant/source ID parser, and an extensible diagnostic summary sentinel with stronger truncation metadata and closed-error exclusion assertions. The old logs/inputs remain archived.

## Verification and next action

- Static diff/whitespace inspection: no errors found.
- Follow-up fixture generation: **not executed or typechecked**. Prior green types cover the prior exact files only.
- Heavy slot is owned elsewhere. Next: freeze exact patch and input hashes, independent static review, then obtain the execution slot before any test/type/build command. Classify fixture/product failures and disclose assertions not reached.
- Required release gates remain focused tests, fresh types, complete applicable test/build checks and independent review on the exact final candidate; later main/combined integration requires its own evidence. No live AI/browser/Firestore/network verification is claimed. Count admission does not guarantee storage I/O or the2MiB envelope byte limit.
