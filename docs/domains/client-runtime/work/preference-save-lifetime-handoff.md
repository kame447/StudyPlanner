# Confirmed preference save lifetime

Status: locally implemented with focused evidence and independent semantic review; unpublished.
Owner: data-read lane under #542; no existing active PR for this save lifecycle.
Branch: `fix/preference-save-lifetime`
Base: `e6ce01091319bd47b6cf66ef35fc4f444924d69a` (current main verified by ownership coordinator 2026-10-17 08:34 UTC).

## Scope and decision

Changing the confirmed week-start setting marks the personalization hook as loading while retaining its confirmed profile. The root treats that flag as initial bootstrap loading and removes the planner bootstrap and App. Both successful and failed saves can recreate the planner reader and discard screen-local state. The settings context currently exposes neither the save state nor its failure.

Alternatives to verify:
1. Separate all read/write state throughout the hook API. Explicit, but changes existing hook semantics and every typed consumer.
2. Keep the existing hook admission/owner fences and distinguish loading without a confirmed week-start from mutation with a retained confirmed profile at the root. Expose save progress/error to the existing settings surface. Selected only if lifecycle and operation-count tests pass.
3. Cache planner data across unmounts. Rejected: does not retain drafts and would introduce new owner/mutation freshness obligations.

Initial consent, failed or pending initial preference reads, missing week-start and owner transitions must keep their current gates. Successful explicit reset must return to initial selection. No repository queries, schema, Rules, historical coverage or auth permissions change.

## Verification and exit

Reproduce with the actual root, personalization hook, planner bootstrap and settings control; count repository operations and observe the mounted draft across a deferred success/failure. Cover retry, repeat clicks, reset, initial-read failure/pending, owner retirement and consent change. Run related tests only. Integration/full-suite/browser release gates remain separate. No GitHub/main writes.

## Measured result

The actual root, personalization hook, planner bootstrap and settings controls are exercised together. The expensive App body is a stateful probe; auth, preferences and planner repositories are controlled mocks/local fixtures. A successful **or failed** week-start save previously unmounted that body and, on settlement, invoked all eight bootstrap getters again: schedule snapshot, Actuals, Todos, subjects, materials, templates, terms and periods. Auth profile retrieval, memory initialization and memory subscription also each repeated once.

After the change, those additional eight getter invocations become **zero**, profile/memory boundaries do not restart, the same App instance and probe draft survive, and the actual settings palette disclosure stays expanded. With 1,000 synthetic Actual rows, repeated Actual response rows become **1,000 → 0** per setting save. These are repository-operation and synthetic response counts, **not measured Firestore SDK queries, billed reads, production latency or browser paint**. The setting repository's own fresh `getProfile`/`setDoc` write path is unchanged and excluded from this count. No data is cached across a new session, and no history is truncated.

The root distinguishes initial loading without a confirmed week-start from saving with this owner's retained preference. Its existing startup checks remain active for unread/missing preferences. The settings context exposes pending/error state, the existing controls disable during a write, and a failure stays visible for explicit retry. The hook's admission, owner fencing and repository writes are unchanged. A successful explicit reset intentionally removes the confirmed profile and returns to first-time selection.

## Focused verification

Final current-source run: `DEV_LAN_HOST=127.0.0.1 npm run test:run --` the following nine files, **161 passed**, exit 0:

- `src/components/LaplanceAppRoot.preferenceSave.test.tsx` — 11 cases: deferred success/failure, retained draft and real settings disclosure, repeated/conflicting clicks, visible failure/retry, reset success/failure, initial read/pending/failure, initial preference save, previous-owner late resolution/rejection, consent withdrawal.
- `src/components/LaplanceAppRoot.test.tsx`
- `src/components/LaplanceAppRoot.parallelStartup.test.tsx`
- `src/components/LaplanceAppRoot.profileRecovery.test.tsx`
- `src/components/LaplanceAppRoot.startupLatency.test.tsx`
- `src/components/AppSettingsDialog.test.tsx`
- `src/components/AppSettingsGeneral.appearance.test.tsx`
- `src/components/AppSettingsGeneral.motion.test.tsx`
- `src/features/weeklyPlanning/personalization/useWeeklyPlanningPersonalizationProfile.test.tsx`

`npm run typecheck:app:full` passed fresh/nonincremental. `git diff --check` passed. No full-suite, Worker typecheck, build, browser or production experiment was run for this worker slice. These focused results do not establish those separate gates.

The same final new test bytes were also run against untouched base runtime in a separate audit worktree, selecting the two measured success/failure cases. Both failed as expected (nine intentionally unselected); logs show the extra reads, discarded draft/disclosure and absent save-error display. No failed baseline assertion was weakened.

Failure classification:
- The first baseline attempt exhausted the test worker heap while formatting a failed equality between large cyclic React test instances. Replacing that diagnostic with boolean instance identity kept the same requirement and bounded failure rendering; the corrected baseline then failed deterministically in 1.39 seconds. The original log is retained.
- The first broader focused run had seven failures in the old parallel-startup fixture. It represented an initial pending read with a populated confirmed profile, unlike the real hook, whose initial and refreshed reads expose `profile: null`. The fixture now reflects that initial-read contract; all existing startup assertions remain. The new real-hook test independently exercises retained profiles during writes.
- Initial fresh typecheck rejected an overly broad generic type for a test spy map. The map now records only the call-history shape it consumes; runtime was not changed.

## Remaining acceptance

Independent review found no blocking code or fixture-contract issue and verified both measured count logs against the identical final test snapshot. Its final receipt is bound to the local content manifest. This local branch is not published. UI browser rendering/focus, exact integration behavior with other pending candidates, and the final approved release checks remain unverified. No universal navigation read improvement is claimed: this change is limited to confirmed preference writes. The rejected same-Plan narrowing and existing startup/streak implementations remain untouched.

Local evidence is held under this worktree's ignored `artifacts/preference-save/`: exact-test baseline, final focused/typecheck logs, immutable measured test snapshot and receipt with content hashes. Preserve these logs when integrating; do not treat a later commit alone as a new test pass.

At the final ownership check (2026-10-17 08:44 UTC), GitHub main advanced to `bd71dcc888664a572033581d9e3bfbe2faabfcae` via external #722. The coordinator's exact commit read contains only the observability contract, Worker request observer and its test, with no overlap here. This tested local candidate remains based on `e6ce0109`; an integration owner must preserve that newer external merge. No rebase or broader test pass is implied.
