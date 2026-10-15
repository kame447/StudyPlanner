# Background study-session continuity

Status: active, awaiting combined integration verification

## Scope and behavior

- Base: `70953efd`; branch: `fix/background-study-timer-20261014`.
- Reuse the existing owner-keyed study provider. Returning Home hides the session instead of unmounting it; a persistent return button reopens it. Starting another session while one exists returns to the existing one.
- Persist started sessions and unsaved record edits in owner-scoped local storage. Restore hidden, with explicit return to the session. No backend schema changes.
- Preserve normal and pomodoro timestamps, pause/resume, completed-set cutoff, midnight adjustment, edited records, and planned/unplanned association.
- Saving marks the snapshot uncertain before dispatch. Interrupted or uncertain saves remain blocked after reload to avoid duplicate records/material progress. Successful save clears the snapshot. Deliberate discard asks confirmation and is blocked during an active save.
- A blocked/full local storage reports that reload/closing will lose measurement. OS background execution, notifications, background audio, cross-device recovery, and cross-tab synchronization are not provided. Elapsed time is derived from timestamps, refreshed on return/visibility events.

## Verification checkpoint

Focused verification completed on the following source snapshot (SHA-256):

- StudySessionView.tsx: `31b0d61aad6b8bf7b4d7ac01aacdb989c759ab7fab21f633012d8f787f3a9b57`
- StudySessionView.unplanned.test.tsx: `ac7ec71f06065ccef3f57c0b3cf5d8d636f48a4e0c2b95c3b02938e3e56b9065`
- StudySessionResume.css: `8823fe692f147851241027468df935a094742fb97ce72328629d2fef98678c08`
- studySessionStorage.ts: `3dd55f04acab3acf38fdfa915419466a6c24083da43606360a5d500936ce9d3c`
- studySessionStorage.test.ts: `92e78a909e03556e1a4592a1c6aec8a28c649f72b4381b2f8e90ce75b428b520`

Commands:

- `DEV_LAN_HOST=127.0.0.1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=2 npm run test:run -- src/components/StudySessionView.unplanned.test.tsx src/lib/studySessionStorage.test.ts src/lib/actualTracking.test.ts src/lib/pomodoroSession.test.ts`: exit 0, 4 files / 91 tests pass.
- `npm run typecheck:app`: exit 0.
- `git diff --check`: exit 0.
- Installed packages reused from the existing durable-ai-turns workspace node_modules (Vitest 3.2.7, React 18.3.1). No dependency or configuration changes.
- Initial test startup could not enumerate host network interfaces; the existing DEV_LAN_HOST configuration override resolved this without source changes.

## Integration and exit criteria

- Integrate with subject selection, timer UI cleanup, and custom pomodoro settings. The storage validator already accepts the agreed custom preset and 1–1440 integer minute fields; combined custom-mode recovery still needs its integration test.
- Run combined final `npm run verify` and browser/visual checks on the integrated content. These were deliberately left to the integration owner; this worker ran no browser.
- Check the return button on narrow mobile screens and navigation bars, plus real background/foreground behavior. Browser/OS lifecycle behavior remains unverified on a device.
- No GitHub writes, issue/PR creation, upstream push, merge, or branch deletion performed by this worker. Remove the local implementation branch after accepted integration under the normal cleanup policy.


## Save-safety audit follow-up

- Reproduced two defects against integrated base `fd5d0666`: a second mounted tab could replay the same saved snapshot, and a backward clock adjustment followed by Pause persisted negative elapsed time that recovery rejected.
- Session identities now survive recovery. A session-specific Web Lock and durable dispatch marker admit at most one dispatch across tabs; confirmed pre-dispatch rejection releases the marker, while successful or uncertain dispatch keeps it. Different sessions may save in either order. Closing one session only clears its matching snapshot.
- Reuse the existing app ID helper and the browser Web Locks approach already used by study-streak persistence. No backend, repository API, dependency, or database schema changes.
- Without Web Locks or writable storage at session creation, new sessions stay in memory and retain ordinary save behavior, with the existing recovery-unavailable warning. A previously recoverable session fails closed if durable duplicate protection becomes unavailable before dispatch.
- Dispatch markers intentionally persist, even after the active snapshot is removed, because an older tab may still hold that session. Their storage consumption grows with saved sessions; available capacity depends on the browser. Quota failure is surfaced and prevents dispatch of recoverable sessions. No arbitrary expiration or automatic marker cleanup was introduced. A later storage improvement should move this boundary toward repository-level idempotency, including material-progress effects.
- This does not implement live cross-tab timer synchronization: the owner-scoped active snapshot remains last-writer-wins. It prevents repeated save of a recovered session; it is not general multi-tab scheduling coordination.
- Elapsed segments clamp backward wall-clock movement to zero, preventing negative persisted duration. Time lost or gained through manual clock changes cannot be reconstructed; this is not a monotonic cross-reload clock.
- Focused verification: `DEV_LAN_HOST=127.0.0.1 node node_modules/vitest/vitest.mjs --config vite.config.mjs run src/components/StudySessionView.unplanned.test.tsx src/lib/studySessionStorage.test.ts src/lib/actualTracking.test.ts`: 81 tests passed. `npm run typecheck:app -- --pretty false`: exit 0. Exact source hashes and final commit are handed to the integration owner; combined verify remains their responsibility.
