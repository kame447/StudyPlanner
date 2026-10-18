# Targeted Actual save preparation: recovered integration checkpoint

Status: verified recovery candidate; combined verification and CI pending
Updated: 2026-10-17
Owner: Issue #542 read-load scope; source-snapshot dependencies #683 / #712
Original candidate: `05d0a30635ebbaff97340f8eeebb18c0d991ddbf`
Original and recovered base: `9abc46038e7fb6d8dd0c26dabf31b8e251311473`
Integration owner: `publish_three_verified_improvements`
Integration checkpoint reported by owner: `e605853e`, after the other approved independent candidates

## Recovery and exact scope

The prior worktree, original commit object and execution artifacts were unavailable after an environment reset. This checkpoint does not present the lost run reports as fresh evidence. Recovered production files and the unit regression file match their previously recorded SHA-256 values exactly:

- `src/repositories/firebasePlannerRepository.ts`: `4eea8aa448314e7a96675c98dc6d90581a368b45d683064e86d893761af02d20`
- `src/repositories/repositoryContracts.ts`: `cee37eff0f3dcb315bea88394afad84201acc21e75b09c56546816215ff737a5`
- `src/repositories/scheduleEventAuthorityRepository.ts`: `005578dad255da2fd7bd51717b0b0b3e9827428308b0b00a19c367cf471f3639`
- `src/repositories/firebasePlannerRepository.actualWriteReads.test.ts`: `a0f0d880326a72bf42f958a50547514796af63b7a38fbea95582c76fadfee6dc`

The two additional Emulator test definitions were reconstructed. Their current file hash is `28073743ab5e9ce2091857143a5d9879ddb552db5f00969635063b06cfec5160`; it is not the lost original `cbef26a561cb48dce7ab9d3b9630a34c0074f9bc2c50da881c2743dbfb1dc882`. The current 10 executed cases retain all eight existing base cases and add fresh real-SDK coverage below. Documentation is a recovery-aware replacement, not a claim of byte-exact recovery.

## Behavior and authority

Actual save preparation no longer fetches every same-owner Actual merely to find one prior record. Firebase supports an optional targeted getter; other repositories keep the existing full-list fallback. Missing records use an owner-filtered inclusive identical document-ID range under the unchanged owner Rules.

If the prior record is linked, the getter reads the complete same-owner same-source group, normalizes legacy date-only rows and applies the existing duplicate-winner behavior. This preserves old and recurring occurrences without a date cutoff. If the raw candidate disappears or is relinked between the ID and group reads, preparation fails closed before a stale unlink can recreate it without its non-study provenance.

Partial preparation reads never publish complete study-history evidence. Existing Actual/material mutation invalidation, same-owner source snapshots, vanished-source rejection, write transaction and material progress behavior remain unchanged. No Rules or index change is introduced. This is not a general cross-client atomic-history guarantee.

## Fresh verification on recovered source

- Focused tests: 2 files, 56 cases passed: the recovered 42-case Actual suite and 14 confirmed-history/invalidation cases.
- `npm run typecheck:app:full`: fresh non-incremental exit 0 on the final source/test inputs.
- Firestore Emulator: 10/10 passed using the real Firebase SDK, project `demo-studyplanner`, loopback `127.0.0.1:8816`, and unchanged checked-in Rules SHA-256 `1842acb385effb9996f8d214ae2d237b5bf32a0184a0e6ac07dbaee3629a0c28`.
- The first new Emulator case compares the targeted getter with full-history normalization for legacy duplicate winners, old occurrences and foreign-owner exclusion, and checks that partial reads cannot certify history.
- The second new case forwards every query to the real SDK, then uses a deterministic test-only callback after the ID response to delete or relink the record before the group query. Both interleavings reject stale unlink and leave the Actual/material state unchanged apart from the deliberately injected concurrent owner mutation. SDK responses are not fabricated.
- Independent review: no blocker on the reconstructed Emulator file hash above. The reviewer confirmed the real-SDK interleaving, race-executed assertion, server-read postconditions, unchanged Rules and final 10/10 log without duplicating the run. This Emulator race case exercises the material facade; both ordinary and material save routes are covered by the recovered unit regressions.
- `git diff --check`: clean.

Resolved recovery failures are retained in local logs. The first reconstructed unit helper had a structural TypeScript mismatch; restoring its prior object-spread fix both resolved the error and recovered the exact historical unit-file hash. The first Emulator attempt passed 9/10: the test's post-delete proof used a direct missing-document get, which the unchanged owner Rules correctly deny. The proof was changed to the owner-scoped exact range; the final 10/10 run passed without a production or Rules change.

Local evidence: `artifacts/actual-recovery/recovery-receipt.json` records all file/log hashes; `focused-final.log`, `typecheck-app-frozen.log` and `emulator-tests-final.log` hold fresh results. Earlier failure logs remain alongside them. The standalone recovery tree's receipt is not a substitute for the integration owner's exact combined-content verification.

Environment: Node 24.19.0, installed TypeScript 5.9.3, Vitest 3.2.7, Firebase 12.12.0, Vite 6.4.3, React 18.3.1; the integration owner performed fresh `npm ci` against the verified base lockfile, reused by this worker through a symlink. Java 21.0.12.1 ran official Firestore Emulator 1.22.0, jar SHA-256 `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c`.

## Measured tradeoff and remaining gates

Fresh unit assertions show a new standalone save with 1,000 unrelated Actuals retains two logical SDK queries while reducing returned fixture documents from 1,000 to zero. An existing linked record whose whole 1,000-row history belongs to one source has a preparation-only tradeoff: one query returning 1,000 documents becomes two queries returning 1,001. These are controlled mock invocation/document-response counts, not Firestore billed reads or production latency. Subsequent streak full-history confirmation and complete schedule-source reads remain separate costs.

The integration owner must complete fresh combined full app/Worker types, full tests, build and applicable CI/release checks. No production experiment or deployment was performed by this recovery worker. Existing Issue #542 is reused; the original logical branch is reused for local recovery. No replacement Issue or PR was created. Remove the local work branch only through the normal accepted/abandoned lifecycle after integration.
