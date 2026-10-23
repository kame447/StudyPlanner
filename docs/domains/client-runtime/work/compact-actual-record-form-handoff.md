# Compact actual record form

Status: local cumulative verification passed; browser/release acceptance pending
Owner: UI umbrella [Issue #483](https://github.com/kame447/StudyPlanner/issues/483)
Branch: `ui/compact-actual-record-form`
Base: `98f3c324b5320d38294905c858ce1d2310209312`
PR: none; publication and merge are not authorized for this task yet.

## Scope and ownership

The supplied iPhone screenshot shows repeated plan information, equally prominent cards, and three full-width time fields. This task owns the linked actual editor's presentation only. It preserves save, date relinking, validation, pending admission, failure recovery, deletion/Undo, and tracking actions. It does not change the planner data hook, standalone actual editor, or event color resolution.

Pre-flight checked current open and closed record/compact UI PRs, remote branches, Issue #483 and its latest comments. Earlier #597 and #604 are already adopted and do not implement this scope. No same-scope active owner was found. The concurrent color task owns `.month-event-timeline-bar`; this task owns linked actual form selectors.

## Design decision

- Shrinking every font/control would reduce touch readability and keep the repeated information. Rejected.
- Hiding required date/content fields behind disclosure would change the workflow and obscure validation. Rejected.
- Remove repeated presentation, lighten the plan summary, and group start/end responsively while retaining editable fields. Selected; verify through component behavior and browser geometry.

## Acceptance and next action

- One readable plan summary and one save button; selected matching state remains accessible.
- Date, start, end, note and applicable alternate-content/progress/relink fields remain available.
- Start/end share a row where they fit; narrow/enlarged text reflows without horizontal overflow; interactive controls retain at least 44px targets.
- Existing failed-save retry, duplicate/pending rejection, close/back, date relink and deletion behavior remains.
- Focused tests, type/build/full verification as coordinated by the integration owner; native browser checks on 320–430px mobile, tablet/desktop, themes, long text and enlarged fonts through the existing CI workflows.

Next: finish the scoped layout regressions and focused verification. Local browser launch is already known to fail with sandbox EPERM; do not repeat or bypass that restriction. Browser/visual behavior is unverified until an authorized existing CI run or permitted browser supplies evidence.

## Added Todo scope

The user supplied a second screenshot of Todo editing with the same vertically scattered fields and visible background text. Ownership was checked against current Todo PRs and remote branches; #600 and #534 are already adopted, and no active editor-density implementation exists. Keep this in the same small UI release unit, excluding Todo command/admission behavior and its scheduling dialog.

Group type/duration and deadline date/time, retain title/subject/memo, preserve blank-date disabling and save/cancel semantics, and use the existing opaque themed app background. A third explicit request moves the completed-section chevron immediately after the label (`完了 ›`), retaining default collapse, count, keyboard interaction, and 44px header target. Native screenshots were inspected before implementation.

## Resumed 2026-10-13 20:17 UTC

The interrupted branch and all dirty files are preserved at base `98f3c324`. Re-read the Issue #483 record/comments, current open and matching closed PRs, and all 113 remote branches. No other density owner or matching active PR exists. PR #541 owns day timetable occurrence behavior and remains outside this presentation-only work. Color work owns separate selectors; `modals.css` is not changed here.

All four supplied images were inspected directly. Additional timetable scope removes only the two requested redundant explanations. Period labels, `期間未設定`, A-week anchor explanation, and errors are retained.

Existing candidate: new `compact-record-forms.css` handles responsive groups, opaque theme background, minimum 44px control heights, and at least 16px editable text. Completed Todo disclosure changes only presentation order. Unit/component regressions and existing native-browser tests will be extended without new infrastructure. No browser pass is claimed; the known sandbox launch denial must not be retried or bypassed. No upstream publication, main write, merge, or deployment is authorized.

## Focused verification milestone

2026-10-13 20:21 UTC: seven component/integration files, 82 tests passed, exit 0. Command: `DEV_LAN_HOST=127.0.0.1 node node_modules/vitest/vitest.mjs --config vite.config.mjs --configLoader native run src/components/ActualEditorCard.compact.test.tsx src/components/TodoView.compactEdit.test.tsx src/components/TodoView.completedSection.test.tsx src/components/TodoView.pendingOperations.test.tsx src/components/LinkedActualRecovery.integration.test.tsx src/components/ActualAdmission.firebase.integration.test.tsx src/components/TimetableView.editorLifetime.test.tsx --maxWorkers 2 --minWorkers 1`. Log: `/tmp/compact-forms-focused-current.log`. Includes actual failure/retry/admission, Todo pending commands and edit/cancel, completed disclosure state/count, and timetable editor lifetime.

Scoped background now explicitly belongs to the linked-record sheet; standalone record styling is preserved. Pixel appearance keeps its existing opaque pixel-paper paint. Header Back/Close and form controls preserve at least 44px targets.

Native checks use the existing Playwright runner and CI. Collection only: Chromium 13 cases (7 density scenarios plus 6 existing disclosure cases), four-browser matrix 28 density cases. Scenarios include 320/390/430px, tablet/desktop, light/dark, pixel paint, and 200% text with long titles. Assertions cover geometry/readability, label-chevron order, editing, cancel, and persistence. Collection is not execution. Browser geometry, iOS input rendering, and screenshots remain unverified.

Next: preserve the standalone commit, merge the color owner's verified cumulative SHA by ordinary local merge, then run one combined full `npm run verify` in the assigned serial slot. Record exact source and installed-package identity before and after. No remote publication until the parent obtains permission.

Standalone presentation commit: `ef3b03048e0d61b9a984f92cec2bf21f769d4e27`. Final static review then found that enlarged text at a desktop breakpoint could put date/start on one row and end alone. Start/end now share an explicit responsive field group; the date wraps independently. The affected actual editor/recovery/admission set passes 13/13 after this refinement (`/tmp/compact-forms-time-pair.log`). Browser rendering remains unverified.

## Independent review and cumulative candidate

Read-only review found two issues before the full run: an inherited mobile column direction could turn the header's 12rem flex basis into unwanted vertical space; the native same-row assertion ignored classic-scrollbar gutters at 320px. Both were corrected: the scoped header explicitly uses a row, the native test bounds header height, and responsive pairs are checked against available width with ordered stacking when needed. No save/admission/relink/delete/Undo semantics changed.

Ordinary local merges include the color owner's cumulative `147b1446c4911446770e006fcd8e6f56a65572bd` and latest main `782f3559b40efaaa9fa3b176b63cbe8407b04e9e` (#617). Both merged without conflicts; latest main AI changes are preserved. The pre-review-correction merge is `71f0a13f33574a4c40377d74796b11042b3843d5`. Final code is being verified as one cumulative content snapshot.

Local collection uses installed Playwright 1.62.1; CI's existing workflow uses 1.64.0. The distinction is recorded because collection alone proves neither browser compatibility nor rendering.

## Exact cumulative full verification

2026-10-13 20:30 UTC: `5bd00641d773f58291e9daf6d49524a8e4576c88` / tree `a1787895580e26856fe151009ad761483ac43ca8` passed the normal `npm run verify`, exit 0. Environment: Node v24.19.0, `DEV_LAN_HOST=127.0.0.1`, and a worktree-local `WRANGLER_LOG_PATH`. Fresh non-incremental app and Worker types, regenerated Worker runtime types, **8,194 tests / 864 files**, and production build (4.89s) succeeded. 54 skipped / 1 todo / 11 skipped files are not counted as passes. No lint script is configured. Existing large-chunk build warnings remain; bundle-budget and browser gates are separate and were not run locally.

Before/after identity audit: all **2,497 tracked source entries and 19,329 installed dependency entries** match, exit 0. Installed dependency root is the shared `studyplanner-inquiry-publication-20261013/node_modules`; ignored Vite and Unit0 generated cache paths are explicitly listed in the receipt. Logs, exact HEAD/tree, and before/after manifests are under this worktree's `artifacts/compact-forms-verification/`.

The new main's existing compatibility test created 218 untracked files in `.cache/j1-old-worker` by archiving immutable `070d25cbe14796aebb8168ac5425c93e3506df1c`. These are generated verification outputs, not changed product inputs. They were preserved under `artifacts/compact-forms-verification/generated-j1-old-worker/` after the run, without deleting source or altering tests.

The only changes after the green code snapshot are this verification record and movement of generated output. Publication, CI browser geometry/screenshots, actual iPhone/PWA behavior, and deployment remain unverified/not performed. The next integration owner will merge the separately verified viewport and login candidates and verify that new combined content; this task does not claim them.
