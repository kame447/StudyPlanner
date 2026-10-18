# Overnight plan and actual entry

Status: locally implemented, reviewed and integrated with the six preceding fixes; native browser execution and publication remain. Base: `e9a234102d570878933e0034e182b08e31a3c833`. Local branch: `fix/overnight-quick-entry`. No remote branch or PR was created by this worker. Related audit: #382. Historical boundaries #516, #433, #654 / #655 were inspected; none owns this new ordinary-entry fix.

## Contract and scope

The user approved accepting ordinary entries such as 23:30–00:30. Keep the existing start date and clock fields, with one saved Plan/Actual identity. The canonical repository round trip already preserves this representation, and schedule occurrence projection already interprets an earlier end clock as the next day. No schema, migration, Firestore Rules or production-data write is introduced.

A dedicated interval helper strictly validates start clocks (00:00–23:59) and end clocks (00:00–23:59 or 24:00) before interpreting an earlier end as next day. Equal non-midnight clocks remain zero and invalid. Existing midnight end-role behavior is retained: 00:00–00:00 and 00:00–24:00 are 24 hours. Duration-entry controls still require a positive integer shorter than 24 hours.

Class-template-related Plans retain their same-day restriction, as do timetable templates, generic time fields, and month-event date/time validation. Timer measurement crossing midnight still requires its existing date adjustment and same-day save; this change only corrects the timer's displayed planned duration for an overnight Plan. Weekly AI placement and its approval policies are outside this change.

## Why the connected consumers change together

- Save and editor boundaries: accepting a quick-entry payload alone is insufficient when the actual hook rejects it. Ordinary Plan creation/edit/move and manual Actual saves now use the bounded interval contract. Standalone re-editing no longer truncates 60 minutes at midnight. Ordinary Plan time controls can retain the overnight duration while moving the start; generic callers retain their original same-day behavior.
- Aggregation and summaries: home, report normalization, month totals, material history, plan/record comparison, link suggestions, evaluation and planned-session duration must all count the same 60 minutes. Totals retain start-date attribution and count the saved identity once. Home progress by now uses the elapsed portion, and an upcoming overnight Plan is not mistaken for already finished.
- Day/week presentation: Actual blocks are clipped to each visible day without mutating the stored date/clocks. Midnight-ending records have no next-day tail. Plan projection keeps its existing spanning strip.
- Selection and recovery: a recurring Plan may have its previous tail and tonight's entry visible together. Preserve occurrence identity and original Actual date when selecting, editing or deleting. An immutable editor stays open with its draft when persistence returns a canonical Actual ID; reopening resolves the current record. Cancelled prior-day history remains history-only. Multi-day MonthEvents keep their existing viewed-day record date and occurrence-delete action. Owner boundaries are retained.

Alternatives considered: adding an explicit ending date would expand schema/editor/recurrence responsibilities; splitting one entry at midnight would change identity and material-progress semantics. The existing format plus a separate validated interval helper is the smallest compatible change. The global same-day `minutesBetween` helper is unchanged.

## Verification and remaining gates

The baseline real-hook/local-repository probe reproduced two failures (overnight Plan and Actual) with two passing same-day controls.

Final focused evidence on this worktree:

- 59 related files, 1,126 tests passed. This includes real local save/fresh-repository read/remount, month/year boundaries, midnight endings, recurrence, edits, invalid clocks, day/week clipping, start-day totals, selection, deletion, owner switching and existing recovery/admission boundaries.
- The sole subsequent runtime edit restores the pre-existing same-day timer-record validator; its 58 tests were rerun successfully.
- App TypeScript check passed on final content. Production build passed (5.47 seconds; existing chunk-size warning remains).
- Independent review added six targeted probes. All passed after correcting occurrence selection/deletion, cancelled history, multi-day MonthEvent boundaries and owner changes. Existing canonical-ID editor recovery was also repaired without weakening its test.
- Four real-App browser cases were added for Plan/Actual at 390/1280px, including storage, reload, next-day display and re-save from the Actual tail. Both Chromium and mobile WebKit select all four cases. Collection is not execution.
- Local browser execution stopped before any page action: Chromium failed with `process_singleton_posix.cc: socket() failed: Operation not permitted`. No retry workaround or safety restriction bypass was used. Native browser behavior, screenshots and authenticated production remain unverified and must be checked through the integration owner's normal CI route.

Node 24.19.0, TypeScript 5.9.3, Vitest 3.2.7, React 18.3.1 and Vite 6.4.3. The shared installed dependency manifest was checked against this lockfile: 226 non-optional packages, zero version mismatches. Lock SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`. Local browser discovery used the existing Playwright 1.62.1 installation; CI remains pinned to its unchanged 1.64.0 setup.

Main was re-fetched before handoff: `96f0e8ca6e9a82e4b446b5358c9cf6a262d9c92e` adds independent weekly-planning #674 changes. This worktree has not merged that base; the integration owner must preserve them. `StudySessionView.tsx` also has an independent warning-copy change in the separate timer fix; the hunks do not overlap. Mobile browser selection must preserve other concurrently added specs.

Next: integrate the exact diff onto current main with the approved parallel fixes, run the required combined checks and native browser cases, inspect their screenshots, and follow publication/merge approval separately. No full-suite or final CI success is claimed here.

## Integration checkpoint (2026-10-15)

This section supersedes the original unmerged-base note above. Main was fixed at `db752a8a48241bdf69a0b4a8e71cb4462fbf9692`. The isolated candidate combines color `81d651bc` and timer/bookshelf/Todo `16598067` as prerequisite snapshot `036700b1e33525220568cc07b55483c65fcd2076` (tree `1fb474cb52698687103e2e47f9e85de2dc1bd34d`). No remote branch was created or moved.

- Integrated overnight commit `c5b8000864213c58d8e1afe283a07bd5949e01cb` and the independent one-file InquiryPhotoViewer test commit `76dfc4936df04f4c88ff4987e13e03d07b9d0b38`. Mobile WebKit selection is the union of Todo recovery and overnight cases; the retained-tab timer warning and non-study Actual classification from main remain intact.
- Fresh `npm run typecheck:full` (app and regenerated Worker runtime types) and `npm run build` both passed, exit 0. Production build took 6.81 seconds and retained only the existing chunk-size warning.
- The scoped combined check covered 83 files: 81 files/1,382 tests passed unchanged. Three assertions in the other two files used old contracts: a newly added major-event selection test omitted the canonical Actual ID, and two report tests considered every earlier end clock invalid. No production source was changed for these failures.
- `cb487d70589a607a454cdfe6a9e7cb2ecee6d9e2` (tree `116fef0f22171d4ae20612551a7a650417a7230f`) strengthens those tests: canonical selection identity, zero/malformed-clock rejection, and 60/1,380-minute overnight records attributed once to their start day. The final two-file rerun passed all 21 tests. Together this gives 1,403 passing related tests over 83 files on the final test/runtime content. Fresh non-incremental app TypeScript was then rerun successfully because test TypeScript changed. Worker inputs and production/build inputs stayed byte-identical.
- Chromium collection selects all four overnight browser cases. Mobile WebKit collection selects the same four plus both Todo-recovery cases. This proves selection only. Browser execution and screenshot inspection are still required in normal CI; the previously verified local socket restriction was not retried or bypassed.
- No manual full-suite rerun was performed: the latest user instruction requests affected tests rather than repeating all tests. This is scoped evidence, not a whole-suite claim.
- Environment: Node 24.19.0/npm 11.9.0 locally (CI `.node-version` remains 22.23.0), TypeScript 5.9.3, Vitest 3.2.7, React 18.3.1, Vite 6.4.3. All 226 installed non-optional dependency versions match the lockfile. Installed-manifest SHA-256 `49a74d9c28dd7d4cb498b7e0b5e24afe10c701778245a336b4621a65e86be961`; lock SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`.

Next: the designated publisher reconciles the exact approved base, publishes the independent logical changes, and runs/follows required native browser/CI gates. Keep the general test-quality audit #382 open. No production/browser success is claimed by this local checkpoint.


## Reaudit integration checkpoint — 2026-10-15

The integration owner is reapplying the logical overnight delta onto fixed Todo candidate `14b44a21a447a3046f3510811f929d3bfc102270`, which includes main `ce6ed765839432af58c17760c88041fd0d8a8ec0`. This detached candidate preserves the newer Todo persistence error handling and both Todo/overnight mobile regression selectors. The source worktrees and branches remain unchanged; no parallel remote branch or PR is created here.

The ordinary Plan/Actual invalid-clock warning now asks for valid start/end clocks instead of incorrectly prohibiting an earlier end clock. Strict equal/malformed-clock rejection and the same-day class/timer boundaries are unchanged. A linked editor regression and the real persistence-boundary assertions cover the warning. Actual progress-source preservation is being integrated separately; final combined related tests, fresh app/Worker types, build and exact-content receipt are pending. This local checkpoint does not certify full/native/CI acceptance or publication.
