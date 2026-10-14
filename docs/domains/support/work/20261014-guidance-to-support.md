# Move ordinary guidance into support

Status: active, local implementation only

## Ownership and acceptance

- User request, 2026-10-14: move the other permanent usage notes from the main app into support. Existing small-UI umbrella: #483. Earlier copy cleanups #529 and #604 are merged; no current PR represents this new FAQ migration.
- Base: `1b828e77254351c2c799ff6e0b605e9fc25daacf`. Branch: `ui/move-guidance-to-support`. No PR or upstream publication authorization.
- FAQ and copy-only changes in settings, bookshelf, timer assistance, profile and Home are owned here. The separate streak readability owner edits StudyStreakView; this branch receives its help content but does not edit that screen.
- Retain validation, failure/recovery state, input constraints, deletion/recurrence scope, consent/privacy, legal attribution, accessible names and non-obvious save effects at the action point. No persistence, history, timer, AI or authorization behavior changes.

## Decision and verification plan

Three options were compared: delete every note (unsafe loss of action context), move all notes without a readable destination (hard to find), or move only ordinary usage guidance into a few FAQ groups while keeping operational/safety context in place. The third option has the narrowest behavior risk and is directly checkable against the diff and existing interaction tests. Counter-evidence is any note needed to understand what an imminent action changes; those notes stay.

Add a support content/preservation regression and extend the existing settings native scenario, without another browser fixture or test infrastructure. Focused tests and typechecks run locally. Coordinate one final combined full verification with the streak/readability owner; physical iOS and native browser execution remain unverified until an authorized remote CI run. Local Chromium's previously established socket EPERM will not be retried.

## Local implementation checkpoint

- Ordinary introduction/usage notes were removed from 10 screen components (settings, memory settings, bookshelf, timetable display, timer assistance, profile and Home). The existing support destination has four groups and 16 native disclosures. It adds no data read, subscription, external link, timer or persistence path.
- Kept at the action point: week-start interpretation/save-unit effect; reduced-motion behavior; image input formats; search-provider attribution; selected book structure/save effects; input validation; retry/unknown-result states; recurrence/delete/reset/forget confirmation; actionable empty states and accessible names. Removed timetable descriptions no longer leave dangling `aria-describedby` references.
- FAQ now distinguishes app notices/unread acknowledgements from unsupported push/reminders, PNG/JPEG timetable OCR from unsupported PDF input, and owner data from browser-local display/bookshelf preferences. Ticket guidance was checked against `studyStreak.ts`: actual learning days within a continuous protected chain, not arbitrary lifetime days. Unnecessary implementation words were removed instead of relocating them.
- Independent read-only safety review found no remaining blocker after correcting the ticket and OCR descriptions. No production behavior was changed to fit the help text.
- Focused checks: 12 files / 79 tests, Home 2 files / 11 tests; final small amendment 3 files / 21 tests. These scopes overlap and are not added together. App typecheck succeeded. Prior failure receipts preserve one stale removed-copy assertion and two incorrect new-test selectors; a test callback return-type issue was also corrected. No timeout, threshold or behavior assertion was weakened.
- Existing settings browser scenario was extended for FAQ keyboard/tap expansion, 44px/16px readability, overflow and existing return behavior. Native syntax/discovery succeeded for 1280/390/320px (3 cases); execution and actual rendered images remain pending.
- Evidence directory: `/workspace/shared/laplans-support-guidance-verification/`. Exact combined full verification is next, using the separate streak branch `4a6e93ac` and the existing offline Worker type-generation setting `CLOUDFLARE_CF_FETCH_ENABLED=false`.
