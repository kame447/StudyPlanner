# Material structure save failure

Status: active, local implementation

## Ownership and checkpoint

- Branch: `fix/material-structure-save-failure`.
- Base: `ef8d5ad9388eafb55dffba128291e81842eaa80d` (main, tree `8d9effad4d2b86e7e563e6fe1be417dce0d19aec`).
- Separate data-safety defect from PR #741's long-text layout and unresolved wide-WebKit cumulative timeouts. No external Issue/PR created yet; publication is held for the publisher.
- Existing open/closed issue/PR and material/storage branch searches found no active implementation for failed local table-of-contents writes. The current 24 open PR / 198 remote-ref readback also found no overlapping save/reload owner. #741 remains the owner of long-text UI work.
- Runtime owner handles rendering, QA owner handles clock/actionability, this branch handles local persistence acknowledgement and editor draft retention.

## Evidence and alternatives

The current storage helper catches `setItem` errors without reporting failure. The editor always closes and clears its draft after calling it. A successful local write is synchronous, so an asynchronous save/reload race is not supported by this path.

1. Report success/failure from the existing storage facade and close the editor only after success. Smallest shared-boundary change; verify quota/security failure, complete draft retention, retry, and successful live-state/reload.
2. Add a separate throwing persistence API for this editor. Preserves the old best-effort API but adds a duplicate write entry point; useful only if existing callers require different storage semantics.
3. Read storage back from the component after writing. Avoids changing the facade but couples the UI to serialization/normalization and risks false mismatch; reject in favor of explicit acknowledgement.

The hypothesis is falsified if an injected write failure already keeps the editor and complete draft open. No browser failure is attributed to storage without evidence.

## Next action and exit criteria

Reproduce the loss with the real component and a throwing storage implementation before changing production code. Use the existing inline error presentation. Preserve successful save, Cancel, nested chapter identity, and catalog import behavior. Add focused tests and exact-input evidence, then request independent source review. Native browser behavior and final publication gates remain separate and unverified until run by the integration owner.

## 2026-10-18 local candidate

- Confirmed the defect: three new actual-component tests fail on the original code because the editor disappears after rejected writes. Six storage-facade checks also fail against the original code, including the unhandled `localStorage` getter error.
- The storage facade now returns `true` only after synchronous `setItem` succeeds, and `false` for unavailable/throwing storage. Serialization, storage key, schema, and successful writes are unchanged.
- The editor reports failure through its existing `role="alert"` / `inline-error` region. It keeps the open draft, does not refresh saved preferences, and permits retry or explicit Cancel. It closes only after acknowledged persistence.
- New coverage: 24 chapters plus a nested section, all saved bytes and preference flags, long edited title, numeric progress, quota/access denial, revoked storage getter, first-save draft, retry, explicit Cancel, immediate detail/reopen, and component remount using the same storage. These are real React-component / storage-fault tests, not native-browser rendering or full-document reload evidence.
- Existing best-effort catalog-import behavior and preference toggles have no new error UI. Their ignored return value is retained; this patch does not promise durable catalog-import recovery or retain drafts across a page reload.

### Exact local verification

- First reproduction: component 3/3 expected failures; facade 6/6 expected failures.
- Focused tests: 35 passed across 7 actual files. An eighth requested filename, `bookshelfWritePreparation.test.ts`, does not exist and was not executed; no coverage is claimed for it.
- Boundary tests on the final bytes: 53 passed across 5 files, including the actual `bookshelfViewModel.test.ts`. Together these logs cover 85 distinct passing tests across 11 files (the original 3 component tests are repeated; 2 more component tests were added).
- Fresh non-incremental app types passed. Production build passed in 4.99 seconds, with the existing bundle-size warning. No dependencies, CSS, native tests, or timeout settings were changed.
- Independent initial source review found no blocker; exact final receipt is pending. Full `npm run verify`, browser behavior/visual review, publication, and deployment are not claimed and remain with the integration owner.
- Evidence: `laplans-material-structure-save-failure-evidence-20261018` records exact input hashes, installed toolchain, commands, red/green logs, and patch. No claim that PR #741's wide-WebKit timeouts are fixed.

Next: bind the final source review and local commit, then hand this separate data-safety candidate to the publisher. Do not merge it into the unresolved performance diagnosis without explicitly tracking the separate contract.
