# Contact page startup loading

Status: local implementation, publication not authorized
Owner: startup performance worker, 2026-10-15
Issue: #542 (existing startup/performance tracking); no new Issue or PR
Branch: `perf/defer-contact-startup`
Base: remote main `729d212c982bb30f4db070f4b13b6e5beb4d9923`, tree `1b1c25eafc2356e573ffd3f829b38639ce169b7f`

## Scope and boundary

Keep the contact page title and return navigation synchronous while deferring its form, receipt recovery and photo code until the contact page is opened. Do not alter authentication, consent, preference, planner-read or memory readiness gates, existing startup video/motion behavior, the pending streak prefetch candidate, or Firestore reads. No production data or API is used for measurement.

Candidates compared: loosening serial startup gates (rejected: consent/owner authority), lazy settings (larger UI lifetime and recently merged motion surface), lazy contact body (selected: absent from Home and terms/privacy, stable shell preserves focus/navigation). If its dependencies remain reachable from another eager import, or contact navigation/receipt lifetime changes, the optimization must be rejected or corrected.

## Verification plan

1. Capture production-build entry static dependency closure and per-module bytes on the unchanged base.
2. Split only contact presentation body; preserve existing body logic byte-for-byte where possible.
3. Verify cold-loading return navigation, owner changes, contact recovery, same-document navigation, existing startup readiness/intro boundaries, and build entry closure after the change.
4. Run fresh app typecheck and focused suites. Full combined verification belongs to the integration owner before publication.

Exact measurements, input/environment identities and final results will be recorded here. Initial load size is a delivery proxy; it is not actual device startup latency or a claim of reduced Firestore billing.

## Local acceptance (2026-10-15)

The production implementation is limited to `ContactPage.tsx` and the extracted `ContactPageContent.tsx`. The page's back link and title remain mounted across body loading, so the existing public-navigation focus target is stable. Loading uses the existing compact circular icon and a screen-reader-only accessible name, without adding visible explanatory text or changing motion policy. A failed chunk leaves the return link available and offers an explicit document reload. The existing form implementation is byte-identical (SHA-256 `003ef4818a645a6d9f0a1e2b0287c1a4b2848e32a7e0bde3913fea4253166529`); receipt reuse, photo upload/recovery, and owner fencing are unchanged.

### Before/after production build

The measurement follows the main entry's static JavaScript imports recursively from the actual Vite/Rollup output. Dynamic imports are excluded from the initial closure. Gzip is the sum of independently compressed chunks, not one combined compressed file.

| Measurement | Main baseline | Local candidate | Delta |
| --- | ---: | ---: | ---: |
| Initial static JS, raw bytes | 1,736,494 | 1,716,580 | -19,914 (-1.15%) |
| Initial static JS, gzip bytes | 471,551 | 465,220 | -6,331 (-1.34%) |
| All JS, raw bytes | 2,568,642 | 2,570,183 | +1,541 |
| All JS, gzip bytes | 704,340 | 706,074 | +1,734 |

This is a small initial-delivery optimization with a total-size tradeoff; it is not a claim that the overall bundle is smaller. The existing bundle budgets are unchanged. The form, draft, submission, photo preparation/upload and their shared validation modules leave the initial static graph. Contact code remains available when requested. No feature or animation is removed.

Both production builds succeeded (baseline 6.38 seconds, candidate 5.80 seconds). These build durations are compiler timing, not application startup timing. Node v24.19.0, Linux x64, Vite 6.4.3, React/react-test-renderer 18.3.1, Vitest 3.2.7, TypeScript 5.9.3; process time zone Asia/Tokyo. No Firebase configuration or production API was supplied.

The existing synthetic critical-path cases still assert cold readiness at 2,800 ms and warm readiness at 230 ms before and after. Those are injected delays, not observed device latency. Auth → consent → saved preference → max(memory, profile → parallel planner reads) and the separate intro completion boundary are deliberately unchanged.

### Verification

- Baseline: existing contact, public navigation and startup latency suites: 48 tests / 3 files passed.
- Final focused: contact (including delayed arrival, abandoned instance/current session, failed chunk/reload), real draft and upload services, public navigation/theme, branding, root lifetime, startup latency and parallel startup: **177 tests / 12 files passed**.
- `npm run typecheck:app:full`: fresh app typecheck passed.
- Final focused/typecheck input snapshot: **2,778 repository inputs and 19,331 installed dependency files unchanged before/after**. The subsequent changes are this handoff's documentation only.
- Existing listener and contact fixtures now explicitly await actual dynamic module delivery before asserting the same auth listener/receipt behavior; assertions were not relaxed.
- `git diff --check`, native spec syntax and Playwright collection succeeded: four new delayed/error cases plus seven existing public-navigation cases, 11 total.
- Native execution is **unverified**: local Chromium fails before opening a page with `socket() failed: Operation not permitted`. All 11 launch failures are environment blocks, not application test results; these occurred before the final compact-loading presentation change, whose native behavior remains unverified as well. A minimal capability check confirmed the same restriction; no further launch retries or browser installation were attempted.

### Remaining acceptance and publication

No remote branch, Issue, PR, merge, deployment, or production write was created. Full combined `npm run verify`, independent review, native Chromium and existing cross-browser public-navigation acceptance belong to the integration/publication owner. No physical iPhone/PWA timing, actual browser render time, production network latency, or billing reduction has been measured. Publication requires the parent's explicit authorization.

The local baseline/candidate module graphs, distribution assets, comparison JSON, test/typecheck logs, native collection/blocker records, and before/after fingerprints are retained in the startup performance evidence packet handed to the integration owner.

## Authorized integration checkpoint — 2026-10-16

The owner approved publication and verified-in-order main integration. The existing implementation branch `perf/defer-contact-startup` is reused. This cumulative candidate preserves the earlier accepted batch changes and current main `729d212c`; only this unit's original patch and documentation indexing are added. Final exact-content verify, applicable CI/browser results, main integration and public asset verification are owned by the single release coordinator. Existing capacity-budget failures remain separately deferred without threshold changes. Physical-device behavior and production performance remain unverified.
