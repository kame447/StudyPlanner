# UI reliability release integration

Status: local integration evidence; current PR, CI and deployment state is tracked in PR #550
Owner: existing UI umbrella Issue #483; startup recovery relates to #542
Branch: fix/ui-reliability-recovery
Base: main 4d86de5f44b6e65309fa1f3f307dad10a4441d96

The user approved publishing and merging this bounded release after the full release checks. The integration owner owns this branch; original local candidate branches and prior receipts remain intact. Existing open/closed PRs, Issues and branches were inspected before creation; none represents this combined release. No new Issue is needed.

## Included logical patches

1. Same-context start/stop startup measurement entry, source candidate cb21dfddca791e479bb4aaf9f79f104f59c6f0cf.
2. Pending Todo operation isolation and disabled subject inputs during save, source candidate 8c8f8ea89b06cb9ece1564d1edc01fb0b50a6b6d.
3. Long Home title disclosure and enlarged-text reflow, including independently audited obsolete date CSS removal, source candidate 7e14c09c302ecf6bbf087fd9f3d2ed36abb2fe64.
4. Fifteen-second consumer-side preference-read recovery, manual retry and no writes after an unconfirmed read, source candidate 8fdfbe97d26ffd4e40f3894037d13a0bee785222.

The final source/test patches were applied once each without historical merge commits. Each logical patch is a separate commit. Historical per-candidate local evidence is not combined-head release proof.

## Boundaries

No dot-theme redesign, planning semantic/runtime change, #488 harness change, dependency/configuration update, auth/Rules/billing change or manual Worker deployment. The preference hook lives in the weekly-planning directory but owns settings loading; its timeout does not cancel Firestore traffic or claim a startup speed improvement. Actual installed-iPhone PWA performance is unmeasured.

## Required completion

- Review exact combined diff and independent owner/readiness/pending/scroll interactions.
- Fresh focused tests, non-incremental app and Worker types, production build, unchanged bundle guards and relevant local browser behavior.
- Publish one coherent draft PR and verify exact remote tree identity.
- Full CI unit/integration, Rules, browser, cross-browser, visual and quality gates on the published content.
- Re-fetch main and PR reviews, mark ready, merge with expected-head protection only after all required checks pass.
- Verify resulting main checks, automatic Pages deployment and served public asset identity. Keep #483 and the broader #542 open.

## Combined validation checkpoint

- Source HEAD `8dd1a7a9ad4d4f535f13381febf95e2260099929`, tree `217ec82751c893f10b17b4b5c78f15154aa1c8b0`.
- Independent review found that the new title portal remained visible and intercepted Tab after Browser Forward reopened settings. A new regression failed against the previous build, then passed at 390/1280px after adding the title portal to the existing retained-screen visibility contract. Tab/Escape, Back restoration, close/focus return and unchanged plan data are checked. The shared focus hook is unchanged. Independent browser review confirmed the correction and found no remaining blocker.
- Final focused suite: 311 passed in 32 files, exit 0. Fresh app typecheck after the correction: exit 0. Fresh Worker runtime generation/typecheck passed before this Home-only correction; every Worker input, dependency and config remains byte-identical, so this is reused proof, not a second execution.
- Final production build: exit 0. All eight unchanged bundle limits pass. JavaScript total raw/gzip: 2,252,693 / 606,634 bytes. CSS total raw/gzip: 484,771 / 81,519 bytes; largest raw/gzip: 424,243 / 68,854 bytes. No limit was relaxed.
- Node 24.19.0, npm 11.9.0, installed locked package versions verified (237); TypeScript 5.9.3, Vite 6.4.3, Vitest 3.2.7. CI independently uses the repository's Node 22.23.0 setting and clean lock install. The local browser uses Playwright 1.62.1 and Chrome Headless Shell 155.0.8059.39 with synthetic data and external traffic blocked.
- The initial browser run was intentionally interrupted when review found the history defect. It is not a successful complete run. Final browser selection: 106 passed, zero failed/skipped/flaky, exit 0. All selected test bodies are byte-identical to the repository tests; an external-blocking local fixture and installed headless executable were used without changing assertions, retries, timeouts or the application startup video. Optional Playwright video capture was off because ffmpeg is unavailable. Representative phone/desktop and 200% text screenshots were visually inspected. Full repository CI remains pending.

All 1,886 non-document tracked inputs and 237 installed-package manifest hashes remained identical through final verification. The only differences from the first integration pass are the reviewed title-dialog history correction and its regression tests. The final selected browser run attempted no external requests.

## Published checkpoint and cross-browser selection

Draft [PR #550](https://github.com/kame447/StudyPlanner/pull/550) was published with remote source head `e070e3cb9c984cf198522420d5f43529cd4ab0e1`, exactly matching local final tree `26b8ec4ab74ac318db53536e4aac7c7fe1e3caee`. Its Pages preview succeeded, and CI, UI Quality and Admin workflows succeeded; Browser and Matrix were still running when this checkpoint was updated.

The initial cross-browser matrix explicitly selected existing specs and did not include the three new reliability specs. Their local direct browser evidence above is Chromium only. At the user's requested device-coverage checkpoint, the three specs were added only to the existing WebKit mobile test selection: Home title/enlarged-text/history (13), preference recovery (4), and diagnostic controls (4). Collection confirms all 21 added cases; the mobile project now selects 155 cases in 12 files. No application/test-body/AI-specific selection, timeouts, retries, skips or assertions were changed. Real Safari, iPhone/iPad hardware, Android/Galaxy hardware and installed-PWA performance remain separate from browser-engine emulation.

The new published head must pass the complete release workflow again. Earlier-head CI results remain history, not a substitute for that final state. Source/build/Chromium input evidence is unchanged by the selection-only edit; WebKit execution is pending. Current publication, CI, merge and deployment state belongs in PR #550 rather than rewriting this historical receipt after each external transition.
