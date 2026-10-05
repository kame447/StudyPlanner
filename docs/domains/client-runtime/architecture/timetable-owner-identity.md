# Timetable owner identity

Status: supporting architecture
Updated: 2026-10-05
Work owner: [Issue #460](https://github.com/kame447/StudyPlanner/issues/460)

## Responsibility and persistence boundary

A standard timetable term is unique per authenticated owner, year and term kind.
The domain creates its opaque ID; Firebase and local storage persist that ID unchanged.
Custom periods retain their existing independently generated IDs.

The standard ID is `timetable-term:<owner>:<year-kind>`, where `<owner>` is the
unpadded base64url encoding of the exact UTF-8 UID. Encoding does not trim or
normalize Unicode. Empty UIDs, malformed Unicode and UIDs exceeding 128 Unicode
code points are rejected. Even 128 four-byte code points remain below Firestore's
1,500-byte document-ID limit. The encoding is identity separation, not secrecy.

Firestore ownership rules remain unchanged. A client never obtains permission
to read, overwrite or delete another owner's term by deriving its ID.

## Existing-data repair

Full planner loading reads owner-filtered terms, templates and periods, then
prepares one timetable mutation. Non-custom legacy term IDs map to the current
owner-qualified ID. Known old year/kind aliases and `default` references map to
the corresponding owned term; explicit source IDs, including custom IDs, take
precedence over inferred aliases. Unknown references are preserved.

An account with no term records receives its own default full-year term. Its
legacy full-year references still remap without mutating an occupied global ID.
Synthetic fixtures verify that dependent templates survive and only owned
records participate in the mutation.

The same atomic mutation contains owned legacy-term removal and affected
template/period updates. Delete candidates come only from the supplied owned
snapshot. Foreign-owner input is rejected before preparing a patch. A custom
term occupying a proposed standard canonical ID fails closed rather than being
silently merged. Existing duplicate-period normalization semantics are unchanged.

The Firebase adapter commits the mutation atomically. If persistence fails, the
hook retains the original timetable projection and reports the failure. The
local adapter retains its existing recoverable-write behavior; this change does
not add cross-tab transactions or crash recovery. Repeated normalization of a
successfully repaired snapshot produces no further changes.

Manual standard-term activation uses the same domain ID constructor. OCR/manual
template and period saves, calendar import and term deletion treat term IDs as
opaque references and therefore continue to use the selected term's exact ID.

## Rollout and rollback boundary

This client-side change cannot modify an already-running older JavaScript
bundle. An old client still maps standard terms back to unqualified year/kind
IDs; it may fail with the existing ownership rules or, when that old ID is free,
recreate the legacy ID and delete its own scoped term. Mixed old/new clients can
therefore repeatedly reverse each other's normalization. Users must refresh all
open clients onto the new bundle before treating migration as settled. Rolling
back to an old bundle has the same limitation. No rule weakening, foreign-row
cleanup, bulk migration or silent version bypass is part of this fix.

## Verification ownership

- Domain tests cover deterministic owner separation, Unicode/length boundaries,
  known/unknown/custom references, missing-term recovery, owned-only deletes,
  failure on foreign input and idempotence
- Adapter/hook regressions use the real production transform, hook and adapters;
  the Firebase SDK fixture models existing ownership rules and batch atomicity,
  and does not substitute for deployed-rules verification
- The synthetic missing-term regression must fail against the previous production code
  and pass with the fix; it contains only synthetic owners and course data
- Browser regression, exact-content aggregate verification and post-deployment
  checks belong to the integration/release owner
