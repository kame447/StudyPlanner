# Study streak calendar readability

Status: active; local implementation only. Publication and merge are not approved for this follow-up.

## Request and ownership

The user requested a slightly smaller calendar and readable lower text after reviewing the merged auto-rest screen. The supplied image confirms that calendar rows stretch through all spare screen height, while the legend and ticket progress use 12px text.

- Branch: `fix/study-streak-readable-calendar`
- Base: main `1b828e77254351c2c799ff6e0b605e9fc25daacf`
- Existing related work: merged #647/#653; small UI umbrella #483. No open streak-specific PR or additional remote streak branch claims this follow-up.
- UI owns `StudyStreakView.tsx`, its test, `study-streak.css`, its focused style test and the existing streak native spec. Support FAQ edits are owned by the separate support task.

## Change

Bound the calendar's preferred height by its week count instead of growing into every spare pixel; retain shrinking for short phones, six complete weeks, 44px controls and the large-text scrolling fallback. Raise the legend to 14px and live ticket progress to 16px. Move the permanent automatic-use explanation to Support FAQ; retain the live next-ticket progress, loading/error/retry and history-correction status on screen.

The FAQ owner received the existing contract: seven real study days earn a ticket; tickets automatically protect eligible missed days before today; protected days do not count as study/progress; no manual advance use, cap or expiry. This UI change does not alter calculation, persistence, data reads or motion.

## Verification and next step

- Focused UI/style checks: 24 passed in five files; the existing mobile WebKit suite discovers all five streak cases. Evidence is saved in `/workspace/shared/laplans-streak-readability-evidence/` with the source fingerprint.
- Combined verification caught a test-only TypeScript narrowing error in the new progress assertion. Selecting the actual `span` test instance fixes it without changing product behavior; the final 24 focused checks and fresh `typecheck:app:full` both pass.
- The fixed combined FAQ/UI snapshot `073cf35b1aed76bd79081710ad75e239f8b3c1c8` / tree `590ddafb93a4206638cb600b35ff603d5cf933ea` passed the regular `npm run verify` with Cloudflare metadata fetching disabled: fresh app/Worker checks, 8,655 tests in 915 files, 54 existing skips/1 todo, and build 5.57s. All seven paths from local parent `05254d90` match the integrated snapshot. Source 2,270 and installed dependency 19,328 fingerprints match before/after; no duplicate branch full was run. Exact receipt: `/workspace/shared/laplans-support-streak-integration-verification/final/receipt.json` (verify log SHA256 `cf0f9507907bd538e783099f9454471f1b6193379ac37f2733879fabadda2e12`).
- Bundle-budget checking remains failed in seven categories already present on the latest main, with largest JavaScript gzip 261,436 bytes against 260,000. Thresholds are unchanged; this remains a separate capacity issue, not a passed check.
- Existing native cases now check bounded rows and readable fonts in addition to one-screen layout, six-week months, automatic protection and large-text fallback. Discovery is not execution proof.
- Local browser launch remains unavailable under the previously verified sandbox restriction; do not claim new rendered/native results from the prior main checks.
- The separate post-main checks for the already merged #653 completed on main `1b828e77`: Browser 696, mobile WebKit 289 plus 3 existing skips, visual 4, all successful. Its six images match the previously viewed PR images. Those results do not verify this new readability change.

The local implementation, focused/full checks and read-only ownership review are complete. Publication requires separate approval; new native execution, rendered-image review and physical-device checks remain unverified.
