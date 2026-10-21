# Local authentication registration storage

Status: PR #824 published; logout-admission correction under final verification.
Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`.
Branch: `fix/local-auth-registration-storage`.

## Reproduced defects and boundary

Synthetic MemoryStorage tests on unchanged main confirmed: (1) a rejected password-record write after the user write leaves an orphan user, preventing same-email signup retry and login; (2) injected user/session storage and ambient window password storage split one identity across two sources. Baseline characterization: two cases passed while explicitly asserting those defective outcomes, log `/tmp/auth-storage-audit.log`. Those diagnostic assertions were replaced by regression expectations, not retained as approval of the defect. No real credentials, browser data or accounts were accessed.

The local fallback is selected only for DEV/loopback/.local when Firebase is disabled. Firebase authentication, fallback eligibility, storage keys and serialized formats are unchanged. Existing local plaintext demo storage is not newly described as secure authentication. No hashing, migration, permission setting or actual account operation is performed. Existing orphaned accounts are not automatically claimed or repaired.

`AuthRepository` remains the application facade. Its injected gateway now owns password matching and combined registration, so credential rows remain adapter-private. Complete user-collection mutations (signup and profile updates) acquire one non-reentrant queue per exact Storage object, shared across gateway instances. These writers cannot interleave with in-progress compensation within the same module/realm. Session revocation, sign-in and reads retain their prior independent behavior; registration prepares both payloads and writes/restores synchronously before yielding. Direct gateway calls, another wrapper Storage identity, another tab/client, crashes and duplicate module copies remain outside this guarantee.

Registration snapshots both raw keys before any write, uses the established users-then-passwords order and restores exact original bytes or key absence on failure. Unchanged keys are not rewritten. Recovery attempts both keys even if one restoration fails; recovery failure is explicit and contains no credential bytes. A successful rollback rethrows the original failure. A rejected user-collection mutation releases the queue for later retry. There is no claim of crash atomicity.

## Alternatives and falsifiers

1. Extract a password port only: removes hidden global coupling but does not repair the reproduced partial registration. Insufficient alone.
2. Same-Storage port plus bounded compensation and serialized complete user-collection mutations (selected). Any affected Firebase code, changed eligibility/key/format, silent recovery failure, overwritten profile/sibling signup, global-storage access with injection, changed original error after successful recovery, or blocked independent Storage falsifies the design.
3. Reverse write order: merely changes which orphan remains. Rejected.
4. New envelope/migration/hash or broad authentication redesign: out of scope and greater compatibility/security impact.

## Seven-perspective acceptance

Architecture: injected storage ownership, stable application facade. Persistence: exact bytes/absence restored, no normalized rollback snapshots. State: all local user writers share queue ownership. Async: full operation and recovery settle before successor admission. Dates/schema: old createdAt/id generation and keys/shapes retained. UI: existing error handling and successful profile/session flows remain. Tests: synthetic failure/retry, independent source isolation, same/distinct email concurrency, profile race, independent Storage and existing profile lifetime/UI feedback regressions.

## Evidence

Initial related command: `npm run test:run -- src/repositories/localAuthStorageGateway.test.ts src/hooks/useAuthSessionState.profileLifetime.test.tsx src/components/MyPageDialog.saveFeedback.test.tsx src/repositories/firebaseAuthRepository.test.ts` — 4 files / 55 tests passed, exit 0 (`/tmp/auth-storage-regressions.log`). Ten new gateway regressions include first-write before/after side effects and second-write after side effects, exact formatting preservation, failed compensation, fresh-repository retry and same-Storage concurrency. Final related rerun after the missing-record and snapshot-preparation corrections passed 4 files / 56 tests, exit 0 (`/tmp/auth-storage-final-related.log`).

Node24.19.0/Vitest3.2.7; reused fresh current-main npm-ci seed from calendar-domain-refactor-work, matching lockfile SHA-256 `ea546daa78b887f737da4cfb1884b8f14f7b39ce4baa639e7baa04d5bfb6c693`. The initial and corrective full verification receipts are recorded below. Mocked Firebase tests do not establish live backend behavior. No browser/device acceptance claimed. Publication was subsequently approved and opened as draft PR #824.

Independent seven-perspective source review found no remaining blocker. An intermediate candidate reread credentials after capturing recovery snapshots; review identified a transient second-read failure could become an empty password array. The final implementation prepares both serialized payloads from captured raw snapshots before any write. An additional synthetic existing-credential sentinel test proves only one credential read and preserves both identities. This candidate hazard was source-inspected, not a pre-change RED execution or observed production incident. The original two baseline defect characterizations remain separate evidence.

## Final local verification receipt

Final `npm run verify` exited 0 on exact commit `2a0cc8628e6f11c92d6a43578606492d6809156c`, tree `b9d31c702d0361fb75cde57c5df96c255eda74c9`, with initially clean source. Fresh app and regenerated Worker typechecks passed; 1,055 test files / 10,539 tests passed (67 skipped, 1 todo retained); production build passed in 12.36 seconds. Log `/tmp/auth-full-verify.log`. Same canonical installed dependency seed/lock identity above; standard telemetry-disabled environment, DEV_LAN_HOST=127.0.0.1, isolated Wrangler log `/tmp/auth-verify-wrangler.log`. Tests generated `.cache/j1-old-worker` historical-fixture output without tracked source changes. The final null-sentinel equality preserves existing password-record matching rather than newly rejecting falsy string IDs; its focused 11 cases passed before this full run (`/tmp/auth-storage-final-sentinel.log`).

Two independent seven-perspective reviewers found no remaining source blocker. One additionally reproduced 47 related checks independently (`/tmp/calendar-auth-independent.log`). Only this documentation receipt changed after the full verified snapshot. This initial receipt predates publication as draft PR #824; it does not establish live Firebase/browser/device behavior. The change repairs new bounded local registration failures; it does not claim or migrate existing orphaned local identities.


## PR #824 correction: independent logout admission

The original broad facade queue introduced a regression against the existing native contract `Profile save cannot restore the signed-out UI under StrictMode`: while a profile has durably written but its acknowledgement is held, logout must clear the session before that acknowledgement is released. Source inspection identified the risk while CI was running. A synthetic test with the actual local gateway passed against unchanged main22e42203 (`/tmp/auth-signout-main-green.log`) and failed against the originally published local payloadf32fe129 (`/tmp/auth-signout-candidate-red.log`, false rather than true for completed logout). This is a confirmed candidate regression, not an original production defect, and no native result is inferred from the synthetic test.

The correction queues only the two writers of the shared users collection. Sign-in, reads and independent session revocation keep their original behavior; this does not add new session cancellation/arbitration policy. Simply bypassing logout while leaving sign-in queued was rejected because it could defer an earlier sign-in until after logout. Both registration payloads and compensation stay synchronous within the gateway. Signup/profile serialization remains enforced across two gateways over the same Storage.

Five related files /57 tests passed after the runtime correction (`/tmp/auth-signout-fixed-related.log`). A second deferred test additionally proves signup remains pending behind a profile mutation and preserves both records; the final two-case file passed (`/tmp/auth-signout-final-focused.log`). Existing native assertions and harness timing were not weakened or moved. Fresh final verification passed on commit `69c608492619bffd5b88ea5f0447f4eecade5384`, tree `d6173968dd97faf47bbd84df5f5bfa3aabfeef6a`: app and regenerated Worker typechecks, 1,056 test files / 10,541 tests (67 skipped, 1 todo), and production build in 13.95 seconds, exit 0 (`/tmp/auth-signout-full-verify.log`). Dependencies and supported telemetry-disabled environment remain as above. Only this receipt changed after that verified snapshot. Independent seven-perspective source/evidence review found no blocker on this corrective snapshot, including the baseline green/candidate red logs and preserved signup/profile serialization. Remote native validation remains separate from these local results. Shared dependency-audit and bundle-budget blockers are separate and must not be hidden.
