# Preserve the deleted major event when Undo restores it

Status: local candidate; focused verification and independent source/data-safety review complete.

## Scope and ownership

- Base: `522004730f57f726c95b25c412cdaba672128bc3` (main read on 2026-10-18).
- Branch: `fix/month-event-undo-latest`; no public branch or PR.
- Existing Issues #437/#483 provide the persistence/consistency context. The current open-PR inventory has no overlapping major-event Undo implementation.
- The last-date deletion candidate, recurring empty-field migration design, external calendar controls, and AI/Jev work are separate and unchanged.

## Reproduced defect and minimal correction

Deletion already resolves a major event by the current owner and ID from the accepted application projection. Its Undo closure instead saved the older event object supplied by a retained UI caller. A completed edit followed by deletion using that older object therefore restored the old title/memo and, for a recurring event, lost its newly excluded date.

The two changed references make both Undo persistence and its immediate UI projection use the same event captured at deletion admission. This is the latest accepted local projection, not a new server read or an edit-baseline concurrency check. No ID, saved format, Actual link, persistence API, source policy, or permissions change is introduced.

Alternatives checked before selecting this defect:

- Major-event OFF/ON membership and linked/deleted Actual provenance already have live-source and saved-source coverage; no new policy defect was established.
- Replacing an Actual-link draft wholesale with a current record would discard intentional form edits, so that apparent stale-object fix was rejected.
- The Undo closure mismatch has a direct real-Local persistence counterexample and requires only two reference changes.

## Verification

- Baseline: the two new single/daily event cases fail after Undo and a fresh Local repository read, restoring the old saved event.
- Corrected focused test: 3 passed, including a rejected Undo write followed by a successful retry of the retained callback.
- Final related run: 130 passed across 7 files. This includes existing month-event recovery, rollback, range, recurring scope, Actual provenance lifecycle, and study-progress preference checks.
- Fresh app type check: `tsc --noEmit --incremental false`, exit 0.
- New tests verify exact restored event values in storage and hook state, unchanged linked Actual values, OFF/ON/OFF actual-minute membership, and the recurring exclusion after a new repository read.
- The failure test injects a repository rejection before persistence. It proves hook failure/retry behavior, not a real network/Firestore failure.
- Build, browser/native execution, real Firestore, and cross-tab concurrency were not run for this local two-reference correction. The tests invoke the retained hook callback; a particular menu gesture race has not been demonstrated in a browser.

## Remaining limits and next gate

Undo still follows the existing lease/owner lifetime checks and existing repair on changed accepted reads. This patch does not add CAS, prevent an unrelated stale writer, or guarantee preservation of remote edits not yet accepted locally. Existing newer-read and owner retirement behavior is covered by the unchanged recovery tests.

Evidence is in `laplans-month-event-undo-latest-evidence-20261018`: original red and focused green logs, final related/type logs with exit codes, before/after input hashes, and final source manifest. The independent review found no source/data-safety blocker. No external publication, CI trigger, or main merge has occurred. The next gate is the parent's publication decision and any subsequently authorized native check.
