# Client Runtime

Status: canonical domain index
Updated: 2026-10-09

This domain owns client-first execution, local/runtime capability boundaries, synchronization authority and the conditions under which work may move from server-mediated execution toward the client.

Canonical requirements:

- [Client-first execution requirements](spec/client-first-execution-requirements.md)

Supporting architecture:

- [Timetable owner identity](architecture/timetable-owner-identity.md) owns account-qualified canonical term IDs and bounded legacy-reference repair

- [Actual action admission](architecture/actual-action-admission.md) owns cross-surface record/material admission, immutable edit evidence, and committed reservations

- [Local planner storage access](architecture/local-planner-storage-access.md) owns the bounded local-fallback command/compensation queue and its explicit concurrency limits

- [Planner read projection recovery](architecture/planner-read-projection-recovery.md) owns local read freshness, retry and consumer leases; it does not redefine the parent requirements or their rollout status

Execution tracking:

- [Administrator module failure recovery](work/admin-lazy-load-recovery-handoff.md) — Issue #542; retain normal return and explicit reload after lazy module delivery fails.

- [Targeted Actual source preparation](work/actual-source-targeted-read-handoff.md) — Issue #542; select the persisted linked source without scanning all canonical schedules, preserving provenance and complete-history boundaries.

- [Targeted Actual save preparation](work/actual-save-targeted-read-handoff.md) — Issue #542; exact runtime/unit recovery, reconstructed real-SDK regression evidence and combined integration gates.

- [Overlapping streak history confirmation](work/streak-inflight-history-handoff.md) — Issue #542; identical unsettled read sharing with preserved mutation/refresh boundaries and controlled SDK-call counts.
- [Same-document administrator entry](work/admin-entry-navigation-handoff.md) — Issue #542; avoid the My Page entry reload while preserving the existing unsaved-chat leave warning and owner/access boundaries.

- [Month view startup loading](work/month-startup-loading-handoff.md) — Issue #542; defer month code while retaining navigation and add requests during delivery.

- [Contact page startup loading](work/contact-startup-loading-handoff.md) — Issue #542; optional contact form/photo code leaves the initial module graph while return navigation stays synchronous; local measurement and native acceptance are separate.

- [Study streak preload after Home](work/streak-after-home-preload-handoff.md) — Issue #483; optional detail-module warming behind the existing readiness boundary.

- [Bounded optional view preloading](work/bounded-view-preload-handoff.md) — Issues #483/#542; reuse settled preload slots under the existing eight-loader cap, with MonthView registration and measured tradeoffs kept separate.

- [Timetable OCR save lifetime](work/timetable-ocr-save-lifetime-handoff.md) — Issue #437; preserve submitted drafts and editor ownership across pending saves.

- [Acknowledged announcement receipt reads](work/20261015-announcement-receipt-reads.md) — Issue #542; owner-scoped read reduction with mock measurements and publication held.

- Issue #164
- [Normal Plan deletion and linked Todo admission](work/20261013-linked-todo-plan-delete.md) — Issue #437; compound-delete reservation and persisted race regression
- [Todo target admission](work/20261013-todo-target-admission.md) — Issue #437; local deleted-target and in-flight command protection, with remote/browser acceptance separate
- [Deferred DayNote startup scope](work/20261009-day-note-startup-scope.md) — Issue #542; scoped verification snapshot, preserving full-read and DayNote recovery contracts
- [Firestore read load and startup investigation](work/20261008-firestore-read-load-and-startup.md) — Issue #542; verified local candidate, separated mock/Emulator/cost evidence, with browser acceptance and the separately tracked first-save Rules repair still open

The requirements document is the specification; the Issue is the work-state owner. Do not duplicate the full requirements under a generic task directory.

Other active client-runtime work:

- [Actual first-save permissions](work/actual-create-permission-handoff.md): correct the missing-document existence query while retaining owner-only Rules; local Emulator reproduction and verification, publication pending.

- [Study-record editor date validation](work/actual-editor-date-validation-handoff.md): block blank/invalid dates before saving normal and standalone study records; local persistence proof and native-browser acceptance are tracked separately.

- [Durable weekly-planning turns](work/ai-durable-turns-handoff.md): accepted whole-turn execution after browser suspension, invocation-local shared runtime, and GET-only recovery; production resource activation remains separately gated.
- [Compact record and Todo forms](work/compact-actual-record-form-handoff.md): UI Issue #483; linked-record/Todo density, completed disclosure order, and timetable helper copy; local verification and browser/release boundaries tracked separately.
- [Login entry and quiet starfield](work/login-starfield-handoff.md): UI Issue #483; login-first admission, accessible mode switching and a shared dark canvas; native logo/rendering acceptance remains separately tracked.

- [Passive startup delivery timing](work/startup-delivery-timing-handoff.md): Issue #542; local-only pre-Splash diagnostics, with installed-device cause and publication still separate.

- [Pomodoro session settings](work/pomodoro-session-settings-handoff.md): per-session 25/5 or 50/10, optional finite sets, and mode transitions; local validation complete, browser/remote and new bundle-size acceptance still open.
- [AI navigation and diagnostic visibility](work/ai-navigation-diagnostics-handoff.md): owner-scoped retained presentation and operator-only diagnostic UI; local/browser/release evidence is tracked separately.

- [Laplance product-name migration](work/laplance-rebrand-handoff.md): 2026-10 brand rename; preserved infrastructure identifiers and user-approved startup media replacement.
- [Initial startup canvas](work/startup-initial-canvas-handoff.md): pre-React dark canvas matching the approved startup video; local implementation and separate browser/release acceptance.
- [Complete the Laplans startup video](work/laplans-video-completion-handoff.md): the successor to merged PR #545, under Issue #483; readiness-gated skip and full playback by default.
- [Laplans startup video](work/laplans-video-splash-handoff.md): isolated local presentation change under UI Issue #483; verification evidence and remaining browser/release gates are tracked in this one handoff.

Client-first does not imply client-authoritative shared state. Authentication, owner isolation, reconciliation, cross-device consistency and server-side security boundaries remain explicit requirements.

- [Admin mobile navigation and announcement actions](work/admin-mobile-navigation-handoff.md): visible return, same-document navigation and direct draft/publication actions; local follow-up awaiting publication approval.

- [Administrator console style loading](work/admin-console-style-loading-handoff.md): Issue #542; local-only deferral of administrator-specific CSS, preserving shared shell cascade and all media/theme behavior.
