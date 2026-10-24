# Timetable OCR save lifetime

Status: local implementation and focused acceptance complete; publication is not authorized
Owner: Issue #437, bounded OCR confirmation-dialog slice
Branch: `fix/timetable-ocr-save-lifetime`
Base: `729d212c982bb30f4db070f4b13b6e5beb4d9923`, tree `1b1c25eafc2356e573ffd3f829b38639ce169b7f`

## Scope and preflight

The OCR confirmation dialog still permits candidate edits/additions/removal while saving the earlier captured draft. Its backdrop also closes while the visible Close button is disabled. React state alone does not prevent same-turn double submission, and completion unconditionally closes the parent. The candidate correction is limited to the submitted dialog's admission, editable state and lifetime; no repository, schema, OCR inference, Rules or cross-client ordering change.

Latest AGENTS, main, Issue #437 and its comments, open/closed related PRs and OCR/timetable branches were read on 2026-10-15 around 20:21–20:24 UTC. PR #518 concerns the manual class editor; merged PR #519 concerns importing today's timetable as plans. Neither owns the OCR confirmation dialog. No active same-scope PR/branch was found. The root assigned this isolated scope; startup, calendar response, Firestore and motion ownership remain separate.

Compared alternatives: retain editable input and track revisions through a partially completed batch; move admission into a new repository transaction; or reuse the existing editor-mutation admission/lifetime boundary and freeze only the submitted draft. The last is smallest and preserves the existing visible Close-button contract. The backdrop must follow that same contract. Owner/term changes and unmount stop undispatched rows without rolling back an already-dispatched write.

## Implementation and verification

The existing `useEditorMutation` owns synchronous admission and mounted-session lifetime. The dialog now projects its accepted operation into the pending input/close lock. All field edits, candidate additions/removals, and backdrop dismissal follow that same operation immediately, including retained callbacks before React commits the pending render. The session is keyed by owner, term and filename. Each undispatched batch row checks the original operation; old success/error cannot affect a replacement dialog.

The baseline had seven failing component regressions and two passing controls. An initial test fixture used an all-ASCII class name that the existing OCR filter intentionally excludes; correcting the fixture and treating absent `disabled` as false produced the final baseline evidence. No production assertion or OCR interpretation was changed to accommodate that harness correction.

Final focused command:

`DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/hooks/usePlannerDataState.timetableOcrSaveLifetime.test.tsx src/components/TimetableOcrImportDialog.saveLifetime.test.tsx src/hooks/usePlannerDataState.timetableImportLifetime.test.tsx src/components/DayTimetableImportDialog.lifetime.test.tsx src/repositories/firebasePlannerRepository.timetableOwnership.test.tsx`

At 2026-10-15 20:30 UTC it exited 0: five files, 39 tests, no skips. This includes ten new component cases and five new real-hook/local-repository cases. Confirmed behavior: one admitted batch despite same-turn repeated submission; frozen submitted input; failure preserves draft; owner/term/file/unmount fences; no old error in a newer draft; exactly one period plus two intended classes both before and after a held durable response; partial failure retry retains confirmed canonical IDs; reload matches durable rows; unmount leaves already-persisted work intact without dispatching the next period/class or dismissing later UI. The existing Firebase ownership test's synthetic-failure warning is an expected assertion path, not a failed check.

`npm run typecheck:app:full` (non-incremental) passed on the final test content. `git diff --check` passed. Independent review found no blocking finding and suggested the filename and second-row interruption probes, which were added without a production change. There is no configured lint script.

Verification inputs: base HEAD/tree above; dirty production file plus the two named test files and this checkpoint only. Runtime SHA-256 `167d4ff8b3f0a5e6dd887b47b0982867fa813d2965e17164c759901aef11ede2`. Node v24.19.0/linux/x64, React and renderer 18.3.1, Vitest 3.2.7, TypeScript 5.9.3, Vite 6.4.3, Firebase 12.12.0. Existing installed dependencies were reused; no dependency/configuration changes. Exact file/log hashes and local commit are recorded in the integration receipt outside the source tree.

## Limits and next action

This is a bounded client-dialog correction under #437, not resolution of that entire Issue. A dispatched write is not canceled or rolled back. The batch is not atomic, and unknown write outcomes, multiple tabs/clients, changed backend ordering and the OCR file-request lifetime remain outside this slice. Retry validation covers a known failure before persistence, not ambiguous response loss.

No native browser/visual/device acceptance, Worker typecheck, production build, full suite, CI, upstream publication or main change was performed by this worker. The integration owner decides the combined acceptance and authorized publication. No Issue/PR was created and no branch was deleted; retain this sole local implementation branch while the candidate is active. The next action is review/integration of this exact diff, followed by the applicable UI and release checks.

## Authorized integration checkpoint — 2026-10-16

The owner approved publication and verified-in-order main integration. The existing implementation branch `fix/timetable-ocr-save-lifetime` is reused. This cumulative candidate preserves the earlier accepted batch changes and current main `729d212c`; only this unit's original patch and documentation indexing are added. Final exact-content verify, applicable CI/browser results, main integration and public asset verification are owned by the single release coordinator. Existing capacity-budget failures remain separately deferred without threshold changes. Physical-device behavior and production performance remain unverified.
