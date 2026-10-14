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

- Ordinary introduction/usage notes were removed from nine screen components (settings, memory settings, bookshelf, timetable display, timer assistance, profile and Home). The existing support destination has four groups and 16 native disclosures. It adds no data read, subscription, external link, timer or persistence path.
- Kept at the action point: week-start interpretation/save-unit effect; reduced-motion behavior; image input formats; search-provider attribution; selected book structure/save effects; input validation; retry/unknown-result states; recurrence/delete/reset/forget confirmation; actionable empty states and accessible names. Removed timetable descriptions no longer leave dangling `aria-describedby` references.
- FAQ now distinguishes app notices/unread acknowledgements from unsupported push/reminders, PNG/JPEG timetable OCR from unsupported PDF input, and owner data from browser-local display/bookshelf preferences. Ticket guidance was checked against `studyStreak.ts`: actual learning days within a continuous protected chain, not arbitrary lifetime days. Unnecessary implementation words were removed instead of relocating them.
- Independent read-only safety review found no remaining blocker after correcting the ticket and OCR descriptions. No production behavior was changed to fit the help text.
- Focused checks: 12 files / 79 tests, Home 2 files / 11 tests; final small amendment 3 files / 21 tests. These scopes overlap and are not added together. App typecheck succeeded. Prior failure receipts preserve one stale removed-copy assertion and two incorrect new-test selectors; a test callback return-type issue was also corrected. No timeout, threshold or behavior assertion was weakened.
- Existing settings browser scenario was extended for FAQ keyboard/tap expansion, 44px/16px readability, overflow and existing return behavior. Native syntax/discovery succeeded for 1280/390/320px (3 cases); execution and actual rendered images remain pending.
- Evidence directory: `/workspace/shared/laplans-support-guidance-verification/`. Exact combined full verification is next, using the separate streak branch `4a6e93ac` and the existing offline Worker type-generation setting `CLOUDFLARE_CF_FETCH_ENABLED=false`.

## Exact combined local acceptance — 2026-10-14 15:44 UTC

- FAQ implementation: `c88f5412a6275b9ff61e5cb1def75b2074e87290`, tree `1323603f08f28091645978ccddd1eca477423658`. Streak implementation including its type-safe test follow-up: `05254d90e24a46164b5d7c0188cdc0aab3962ddc`. Normal merges retain both original histories, without overlapping paths or product edits in integration.
- Verified combined HEAD `073cf35b1aed76bd79081710ad75e239f8b3c1c8`, tree `590ddafb93a4206638cb600b35ff603d5cf933ea`, base main `1b828e77254351c2c799ff6e0b605e9fc25daacf`. Every original scope file matched its combined counterpart. This exact combined run is the full-verification proof for both independent source branches; no duplicate standalone full run was made.
- Command: `DEV_LAN_HOST=127.0.0.1 CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=2 npm run verify`. Exit 0; fresh app/Worker types, 915 passed files / 8,655 passed tests, production build 5.57s. Eleven skipped files / 54 skipped tests / one todo are separate, not successes.
- Non-Markdown source 2,270 files and installed dependencies 19,328 files match byte-for-byte before/after. Node 24.19.0, React 18.3.1, TypeScript 5.9.3, Vitest 3.2.7, Vite 6.4.3, Wrangler 4.147.0, Firebase 12.12.0. Generated old-Worker test cache was preserved outside the worktree. Runtime type SHA-256: `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79`.
- First integration `13d16d7f` stopped at a new streak-test TypeScript error. Its owner changed only the test's typed element lookup; the production sources were unchanged. The complete corrected run above, not the stopped attempt, is the accepted proof.
- Independent content/safety and streak-retention reviews found no remaining blocker. Native discovery: three settings widths and five streak cases; browser execution, rendered images and physical iOS are still unverified.
- Bundle check remains failure in the seven already-over-budget categories: JS raw total 2,485,722 / 2,265,000, gzip total 678,367 / 610,000, largest gzip 261,436 / 260,000; CSS raw total 521,394 / 493,000, gzip total 90,428 / 85,000, largest raw 435,169 / 425,000, largest gzip 71,137 / 70,000 bytes. No threshold or chunking workaround was introduced. Functional full success does not mean the capacity gate passed; capacity remains separately deferred by user direction.
- Durable receipts, exact input manifests, full log, native discovery and bundle data: `/workspace/shared/laplans-support-streak-integration-verification/final/receipt.json` and adjacent files. Later checkpoint-only commits do not change the verified non-Markdown input identity.

Next: wait for publication approval, then exact-head native/visual checks and any approved main/post-merge verification. No upstream publication or main mutation has been performed for this change.

## Separate confirmed follow-up

The timetable upload button still says `画像/PDF` and its picker accepts PDF, while the existing payload/Worker accept only PNG/JPEG. The FAQ is now truthful, but the button/picker mismatch was identified after the exact combined run had started and is intentionally not changed in this snapshot. A future small UI correction should align those affordances without adding PDF processing or weakening validation.
