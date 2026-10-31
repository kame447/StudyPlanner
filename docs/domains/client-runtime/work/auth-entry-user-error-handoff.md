# Authentication entry and user-facing error boundaries

Status: local implementation; publication and native-browser acceptance pending.
Base: `3dfc779537c4d58f872be34a86ba2744be321e31` (merged admin UI PR #929).

## Agreed scope

- Keep the authentication brand and mode tabs anchored; fade only the existing form panel on mode changes (standard 300 ms, reduced 120 ms, off 0 ms). Preserve input identity, keyboard navigation, pending admission and natural scrolling.
- Translate external failures once at their owning operation boundary. Only explicitly authored `UserFacingError` guidance may pass through; unknown failures receive operation-specific Japanese guidance. Do not infer safety from the language of an arbitrary message.
- Preserve local validation, partially saved outcomes, owner/scope invalidation and receipt recovery. Do not add retries, network reads, authentication configuration changes or diagnostic payload logging.
- Audit ordinary screens as well as authentication. The reviewed inventory distinguishes 29 externally reachable candidate flows, two controlled local validations, two possible DOM failures, one internal diagnostic helper and one module without a production import. These are static classifications, not reproduced incident counts. Subsequent call-chain review confirmed four DOM-related boundaries (avatar/material conversion, inquiry attachment preparation and inquiry photo object-URL creation); the original two-candidate count was not exhaustive. These four are included, without extending this pass into unconfirmed exception paths.

## Implementation boundaries

Authentication owns SDK-code mapping before code information is discarded, including persistence setup and asynchronous profile failures. Registration failures can occur after account creation; guidance must not assert that no account exists or blindly request re-registration. Profile update notices and their caller receive the same safe failure.

The planner operation boundary retains controlled domain errors and replaces unknown failures before both notices and rethrows. Attendance/streak, material metadata, inquiry recovery/photos, OCR, voice, local image conversion and weekly approval are separate owned service boundaries; completion requires their individual evidence as well as combined verification. Existing partial-save recovery and validation are not replaced by a universal generic formatter.

## Existing work and release isolation

PR #902 / Issue #885 / `fix/issue885-auth-layout-stability` already contains the one-line `align-content: start` layout candidate and five browser tests. This local candidate reuses that change; the original PR is not overwritten or merged by this task. The approved publication plan reuses PR #902 for its five authentication-presentation paths and publishes the error-boundary changes separately; do not introduce a competing UI PR. The error unit includes its shared safe-error type but not the form-layout changes.

This work is separate from primary UI PR #930 and does not change its pending merge process. The initial split is based on fresh main `3dfc7795`, without the unmerged PR #930 changes. If main advances, inspect the resulting diff and attribute native verification to the new merge tree. Authentication email language/template/handler settings remain outside this implementation.

## Verification and exit criteria

- Focused authentication/source contracts and synthetic raw-SDK negative tests; retain state, IO-count and partial-outcome assertions.
- Independent source review followed by one combined fresh app/Worker type check, full suite and production build on a frozen snapshot.
- Native Chromium/WebKit form-motion evidence: same brand/tab/input/panel nodes; anchored positions; opacity-only transition; no restart on typing or validation error; reachable controls on short/large-text layouts.
- Native results are not physical-device/keyboard/browser-chrome guarantees. Do not claim visual completion from source tests or test discovery.
- Resolve failed relevant checks without weakening assertions; record exact publication/merge/native identities in the owning PR/Issue once those exist.

Local combined verification passed on tree `55dec8251c32e85aa54c77a0c845f1e3a8990b1f`: fresh app/Worker checks, 12,209 tests and production build. This is not proof of either split tree.

Current next step: verify the separate UI and error trees with fresh full gates, publish under the approved existing-PR/separate-error-PR plan, and obtain native-browser evidence for each exact merge tree. No new upstream branch or PR has been published for this unit at this checkpoint.
