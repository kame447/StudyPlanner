# Actual progress source preservation

Active branch: `fix/actual-progress-source`. Base: `db752a8a48241bdf69a0b4a8e71cb4462fbf9692`.
Scope: preserve confirmed same-owner Actual provenance through source deletion and unlinking; prefer current links in progress classification; do not infer unknown historical sources from titles. No production data migration.

Implementation checkpoint: source-preserving saves, source-aware fallback classification, and atomic month-event deletion implemented and independently reviewed. GitHub publication belongs to the integration owner. No duplicate active provenance PR was reported by the publication owner; #673 contains the preceding live-link classification only.

Design: optional Actual snapshot, canonical/legacy same-owner source resolution at application/repository save boundaries, and retained-Actual snapshot updates with month-event deletion. Local queue offers recoverable writes, not cross-tab/crash atomicity. Firestore enumerates related Actual IDs before a transaction, then rereads source and each Actual before updating. New linked saves capture a resolved source or fail closed; known prior snapshots survive edits; old clients concurrently adding snapshot-free rows after enumeration remain a compatibility limitation. Oversized transactions fail before deleting anything.

Exit criteria: source-kind settings, save/unlink/relink, legacy deletion, reload, owner isolation, rollback, and Firebase transaction/Rules checks pass; exact focused diff/evidence delivered to integration owner for final full verification.

## Boundaries and verification

- Home settings distinguish study/general/timetable. Existing learning reports and streak history also count mock-exam/cram-school Plan types, so the optional source snapshot retains `planType` from the resolved occurrence. These pre-existing policies remain distinct.
- Current same-owner links win over saved source snapshots. New linked saves/relinks whose source disappears before validation fail with a reload message. Unknown historical standalone/orphan records are not reclassified by title.
- Firebase Actual saves reread existing Actuals in a transaction. A deletion's concurrently added source is included in both persisted data and returned UI data. Exact record lookups use Firestore document identity, including older documents missing a stored `id` field. Duplicate candidates are reread before deletion; records relinked elsewhere survive.
- Owner-only Rules deny reading missing documents. A concurrently deleted candidate therefore aborts the transaction and leaves the source intact. Retrying a source already deleted likewise requires a reload; Rules are not broadened for this patch.
- Saves read current Actuals and, only when a current/previous link requires it, the selected schedule authority. Independent standalone study saves do not trigger schedule migration. Source deletion enumerates owner-and-link candidates, then uses one transaction; more than 499 candidates fails before any delete. Old clients inserting snapshot-free rows after enumeration remain outside the guarantee.
- No production database writes or historical bulk migration were performed. App/Worker typecheck and focused tests are the implementation-worker scope; final aggregate verification belongs to the integration owner.

## Verification checkpoint (2026-10-15)

- Focused production/domain/hook/persistence scope: 29 files, 527 tests passed. Existing material-admission Firebase UI integration: 16 additional tests passed. Test harnesses now model the source-preserving transaction and exact document-ID query rather than the replaced batch boundary.
- App and Worker typechecks passed, including regenerated Worker runtime types.
- Auth/Firestore Emulator Rules regression passed with `demo-studyplanner`, Firebase CLI 15.33.0 and Firestore emulator 1.22.0. New checks cover each optional source kind, document-ID queries, unlink preservation, foreign-owner rejection, source deletion transaction, and fail-closed missing-Actual candidate reads. `firestore.rules` is unchanged.
- Independent review identified and verified fixes for occurrence overrides, existing mock-exam/cram-school classification, newly missing sources, concurrent source backfill, old missing-id documents, relinked duplicate preservation, and stale canonical save targets.
- Remaining: integration owner must merge the unrelated overnight/FAQ/material fixes and run the final aggregate verify/build on the combined exact snapshot. No publish, merge, deployment, or production data writes performed by this worker.
