# Local authentication registration storage

Status: locally verified and independently reviewed; publication pending.
Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`.
Branch: `fix/local-auth-registration-storage`.

## Reproduced defects and boundary

Synthetic MemoryStorage tests on unchanged main confirmed: (1) a rejected password-record write after the user write leaves an orphan user, preventing same-email signup retry and login; (2) injected user/session storage and ambient window password storage split one identity across two sources. Baseline characterization: two cases passed while explicitly asserting those defective outcomes, log `/tmp/auth-storage-audit.log`. Those diagnostic assertions were replaced by regression expectations, not retained as approval of the defect. No real credentials, browser data or accounts were accessed.

The local fallback is selected only for DEV/loopback/.local when Firebase is disabled. Firebase authentication, fallback eligibility, storage keys and serialized formats are unchanged. Existing local plaintext demo storage is not newly described as secure authentication. No hashing, migration, permission setting or actual account operation is performed. Existing orphaned accounts are not automatically claimed or repaired.

`AuthRepository` remains the application facade. Its injected gateway now owns password matching and combined registration, so credential rows remain adapter-private. All complete local auth operations acquire one non-reentrant queue per exact Storage object, shared across gateway instances. Profile changes, signup, sign-in, sign-out and reads therefore cannot interleave with in-progress compensation within the same module/realm. Direct gateway calls, another wrapper Storage identity, another tab/client, crashes and duplicate module copies remain outside this guarantee.

Registration snapshots both raw keys before any write, uses the established users-then-passwords order and restores exact original bytes or key absence on failure. Unchanged keys are not rewritten. Recovery attempts both keys even if one restoration fails; recovery failure is explicit and contains no credential bytes. A successful rollback rethrows the original failure. A rejected operation releases the queue for later retry. There is no claim of crash atomicity.

## Alternatives and falsifiers

1. Extract a password port only: removes hidden global coupling but does not repair the reproduced partial registration. Insufficient alone.
2. Same-Storage port plus bounded compensation and serialized complete operations (selected). Any affected Firebase code, changed eligibility/key/format, silent recovery failure, overwritten profile/sibling signup, global-storage access with injection, changed original error after successful recovery, or blocked independent Storage falsifies the design.
3. Reverse write order: merely changes which orphan remains. Rejected.
4. New envelope/migration/hash or broad authentication redesign: out of scope and greater compatibility/security impact.

## Seven-perspective acceptance

Architecture: injected storage ownership, stable application facade. Persistence: exact bytes/absence restored, no normalized rollback snapshots. State: all local user writers share queue ownership. Async: full operation and recovery settle before successor admission. Dates/schema: old createdAt/id generation and keys/shapes retained. UI: existing error handling and successful profile/session flows remain. Tests: synthetic failure/retry, independent source isolation, same/distinct email concurrency, profile race, independent Storage and existing profile lifetime/UI feedback regressions.

## Evidence

Initial related command: `npm run test:run -- src/repositories/localAuthStorageGateway.test.ts src/hooks/useAuthSessionState.profileLifetime.test.tsx src/components/MyPageDialog.saveFeedback.test.tsx src/repositories/firebaseAuthRepository.test.ts` — 4 files / 55 tests passed, exit 0 (`/tmp/auth-storage-regressions.log`). Ten new gateway regressions include first-write before/after side effects and second-write after side effects, exact formatting preservation, failed compensation, fresh-repository retry and same-Storage concurrency. Final related rerun after the missing-record and snapshot-preparation corrections passed 4 files / 56 tests, exit 0 (`/tmp/auth-storage-final-related.log`).

Node24.19.0/Vitest3.2.7; reused fresh current-main npm-ci seed from calendar-domain-refactor-work, matching lockfile SHA-256 `ea546daa78b887f737da4cfb1884b8f14f7b39ce4baa639e7baa04d5bfb6c693`. Full types, all tests and build remain required on final content. Mocked Firebase tests do not establish live backend behavior. No browser/device acceptance claimed. No publication authorized for this new unit.

Independent seven-perspective source review found no remaining blocker. An intermediate candidate reread credentials after capturing recovery snapshots; review identified a transient second-read failure could become an empty password array. The final implementation prepares both serialized payloads from captured raw snapshots before any write. An additional synthetic existing-credential sentinel test proves only one credential read and preserves both identities. This candidate hazard was source-inspected, not a pre-change RED execution or observed production incident. The original two baseline defect characterizations remain separate evidence.

## Final local verification receipt

Final `npm run verify` exited 0 on exact commit `2a0cc8628e6f11c92d6a43578606492d6809156c`, tree `b9d31c702d0361fb75cde57c5df96c255eda74c9`, with initially clean source. Fresh app and regenerated Worker typechecks passed; 1,055 test files / 10,539 tests passed (67 skipped, 1 todo retained); production build passed in 12.36 seconds. Log `/tmp/auth-full-verify.log`. Same canonical installed dependency seed/lock identity above; standard telemetry-disabled environment, DEV_LAN_HOST=127.0.0.1, isolated Wrangler log `/tmp/auth-verify-wrangler.log`. Tests generated `.cache/j1-old-worker` historical-fixture output without tracked source changes. The final null-sentinel equality preserves existing password-record matching rather than newly rejecting falsy string IDs; its focused 11 cases passed before this full run (`/tmp/auth-storage-final-sentinel.log`).

Two independent seven-perspective reviewers found no remaining source blocker. One additionally reproduced 47 related checks independently (`/tmp/calendar-auth-independent.log`). Only this documentation receipt changed after the full verified snapshot. Locally verified, not published/merged or proven on live Firebase/browser/device. The change repairs new bounded local registration failures; it does not claim or migrate existing orphaned local identities.
