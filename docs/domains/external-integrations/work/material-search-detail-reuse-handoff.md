# Material search detail reuse

Status: approved for publication; combined verification and native acceptance in progress.
Owners: Issue #542 (loading performance), existing metadata contract #187
Base: main 56a8e52212b72074e99f092d91b1bef488bc365f, tree 9a4bf105d3c76b5290e24a2283669c14e0fbaca5
Branch: perf/material-search-detail-reuse
PR: publication in progress; see the current Issue checkpoint below.

## Approved integration checkpoint — 2026-10-16

The owner has approved publication and main integration after browser verification. The following local implementation records retain their original test scope and historical limitations. Current release status is tracked in [Issue #542](https://github.com/kame447/StudyPlanner/issues/542#issuecomment-6209395456) and the four responsibility-specific PRs, rather than inferred from these earlier local measurements.

The original release composition was based on `56a8e52212b72074e99f092d91b1bef488bc365f`. After renewed approval, the integration preserves current main `da462379b2ef57d5028762da36a11e8976b5d9b6`, including #711, and the independently verified Actual first-save repair in [PR #712](https://github.com/kame447/StudyPlanner/pull/712) (tree `b6d03539705f8785d16ba4c9629b130222fb1610`). Publication of this loading release resumes only after that repair is adopted and delivery-verified. Month lazy loading and its bounded preload registration are accepted together; material detail reuse and corrected administrator CSS are additional independent review units in the cumulative release. Final combined full verification and native browser acceptance must complete before main integration. Existing capacity-budget failures remain separately deferred without changing thresholds. Physical-device speed is still unmeasured.

## Confirmed finding

Bookshelf/detail/report/timetable pages consume the already loaded planner snapshot.
Class attendance performs its own necessary owner/template-specific server query.
No new broad planner cache or date truncation is justified by those paths.

A built-in material search resolves up to four compatible candidates sequentially
before displaying their covers. Selecting one of those candidates currently sends
the same detail request again. The chosen fix reuses only a successfully resolved
candidate in that one returned search result, while the same authenticated Firebase
user object is current. No module-level, persistent, or cross-owner cache is added.
Failed, incompatible, discovery, omitted, and remote-search candidates retain the
normal selection-time detail lookup. Provider sequencing and manual fallback stay.

Alternatives considered: (1) defer all search enrichment, which changes cover
availability; (2) parallel provider requests, which conflicts with existing provider
sequencing; (3) reuse successful detail data within this search result, selected
because it removes a demonstrated duplicate without either trade-off.

## Verification plan / exit conditions

Use synthetic Firebase auth and HTTP responses only. Record before/after detail
request counts and controlled latency for search then selection. Cover owner
switch, failed/incompatible enrichment, discovery, repeated search, cover fallback,
and cancellation/unmount. Run focused metadata and selection tests. The integration
owner runs combined type/build/full verification and browser acceptance separately.
No production Firestore, external bibliography requests, GitHub write, or publish.


## Verified local candidate — 2026-10-16

The comparison executes the actual baseline service from main and the candidate
with the same fixture: three built-in candidates, successful synthetic details,
then selecting the second result. Each HTTP mock waits exactly 120 ms on a fake
clock. Before: 4 detail HTTP requests, search 360 ms, selection 120 ms. After:
3 requests, search 360 ms, selection 0 ms. These are controlled dependency delays,
not real-network, device, billed Firestore, or provider response measurements.
Initial search cover enrichment is intentionally unchanged. Successful validated
responses may still omit unavailable optional metadata; the receipt does not claim
that every optional field exists. A new search performs normal enrichment again.

Final focused command (DEV_LAN_HOST=127.0.0.1) ran these six files:
- src/services/materialMetadataService.detailReuse.test.ts
- src/services/materialMetadataService.test.ts
- src/services/builtInMaterialCatalog.test.ts
- src/components/BookshelfMaterialSearch.test.tsx
- src/components/BookshelfMaterialName.test.tsx
- src/components/MaterialQuickCreateModal.test.tsx

Result: 68 passed, 0 failed, exit 0. App typecheck also exited 0. The new regression
failed against the baseline with 4 requests and 120 ms selection dependency, then
passed on the changed code. Cases cover same-result reuse, auth-owner switch,
same-owner new auth object, logout, owner change during token acquisition and HTTP,
HTTP/malformed/incompatible failure, discovery, the four-candidate cap, repeated
search, replacement candidate, remote search, rendered selection, same-turn double
search, Enter during pending selection, cancellation, and unmount.

The UI still uses isSearching for button presentation. A synchronous operation ref
provides the same exclusion before React publishes that state, and drops late
responses after unmount. It adds no product state or persistent cache. The existing
root keys its authenticated subtree by owner and session epoch, so changing the
root auth session destroys these mounted search receipts as well.

The final run's 2,788 input files and 19,329 installed files were SHA-256 fingerprinted
before and after and matched. Input digest before this documentation-only update:
ed134800ecf50a056d58752ae7e225756cc267513113c961a634a5992fa07862.
Installed digest: ea872af1c98be7be67bc0f9a16824a438a3635b875da14dcddbdcaba50fc6240.
Node 24.19.0; Vitest 3.2.7; TypeScript 5.9.3; React 18.3.1; Firebase 12.12.0;
Vite 6.4.3. The LAN override only bypasses unsupported host-interface discovery in
this environment; no runtime provider/config fixture was changed.

### Remaining gates

The integration owner must verify combined full tests, Worker/app checks, production
build, and relevant browser behavior before any publication. This worker deliberately
did not duplicate the shared full verification or use production/provider services.
No new GitHub Issue/PR or remote branch was created. Local branch exists solely for
this one candidate; do not publish/merge without the separate required approval.

### Verified source and test bytes

- `src/services/materialMetadataService.ts`: `a0a8417fc83eee0ae594c67d3ef412545751590b4f14bfa60d0367b4708634d7`
- `src/services/materialMetadataService.detailReuse.test.ts`: `d5f50398d2e6c0afaff60d68d5f81dfc05591870212192dcec00d96d5e01b6b1`
- `src/services/materialMetadataService.test.ts`: `a422c5f5da8faf3fa3ac6dbb797ffc3439a495d15cb6c24444527e18155abc63`
- `src/services/builtInMaterialCatalog.test.ts`: `d4dc342de366a1a4cb9cd5bd62d891539180ee95d2e1f3179f3f3968f3263db1`
- `src/components/BookshelfMaterialSearch.tsx`: `6050905110c9d45acae83e44ba14ebd13cdb5d0035eeee135676d1ff658b7256`
- `src/components/BookshelfMaterialSearch.test.tsx`: `ba118bfe6f6477b6810982edd8890a7333fff6dad449335acd2e2db400829490`
- `src/components/BookshelfMaterialName.test.tsx`: `f62ee22fd0810ebfe2e1dde145fa48eca0c0445d6e4922e0fc43eb865fb0eea6`
- `src/components/MaterialQuickCreateModal.test.tsx`: `e719ea6b0bb2db51e2d1d8c8c8e32c84f638413d664bd247e0e9a73ff32bcfbc`
