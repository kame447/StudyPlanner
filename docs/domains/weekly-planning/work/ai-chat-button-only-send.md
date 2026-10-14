# AI chat: explicit send button

Status: active, local implementation; publication requires separate approval
Updated: 2026-10-14

## Ownership and scope

- Branch: `fix/ai-chat-button-only-send`
- Base: `e306e1a9` (`main`, after PR #655)
- No existing Issue/PR/branch represents this composer-only request. Existing open PRs and closed newline/send-related PRs were checked before implementation.
- The AI chat textarea must keep normal Enter/newline and IME editing. Only activating the Send button submits a message; Ctrl/Cmd+Enter must not submit.
- No semantic interpretation, external model, persistence protocol, or legacy QuickEntry conversation behavior changes.

## Verification and completion

The 2026-10-14 user direction selects relevant tests rather than repeating the entire suite. The affected boundary is the composer input and its existing submission lifecycle. Verify native keyboard/newline behavior, multiline payload, IME events, explicit Send, duplicate click protection, pending/cancel, and failure recovery. Existing browser fixtures that used Enter as a Send shortcut must use the button while preserving their assertions.

## Local implementation checkpoint

- Removed the Enter keydown handler and its unused type import from the AI chat textarea. The existing Send button remains the sole composer submission entry point.
- Updated affected real-AI-view browser fixtures to click Send. The separate legacy QuickEntry weekly modal keeps its existing keyboard behavior.
- Added component regressions for Enter variants/IME, exact internal newlines, explicit Send, repeated clicks while preparation is pending, and recovery after preparation failure.
- Extended the existing native keyboard spec to 390px and 1280px. Its synthetic IME events are only an event-boundary check, not a physical Japanese IME check.
- Added this keyboard spec to the existing `webkit-mobile` project's `testMatch`, so the iPhone-emulated browser gate exercises the same 8 cases. This changes test selection only; it does not rerun unrelated local suites or change production behavior.

Verified on base `e306e1a9` plus the local diff:

- `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/AiPlanningView.moduleRecovery.test.tsx src/components/AiPlanningView.imageOwnership.test.tsx src/components/AiPlanningView.persistence.test.tsx`: 3 files, 74 tests passed. This covers composer/preflight, send/cancel/owner lifetime, and chat persistence; it is not a full suite result.
- Regression sensitivity: temporarily restoring the original composer implementation makes the new Enter test fail because `preventDefault` is called. The fixed file was restored and all 74 related tests passed again.
- `npm run typecheck:app`: passed. This checks the JSX/type surface and the new component tests; Worker types/runtime are unchanged.
- `DEV_LAN_HOST=127.0.0.1 npm run build`: passed, with the existing large-chunk warning. This checks the production bundle containing the changed AI view.
- Changed browser specs pass `node --check`. Keyboard/concurrency/failure-recovery discovery finds 11 tests.
- Cross-browser configuration passes `node --check`; `playwright test --config=tests/e2e/playwright.cross-browser.config.mjs --project=webkit-mobile --list tests/e2e/weekly-keyboard.spec.mjs` discovers all 8 keyboard cases under `webkit-mobile`. This is discovery, not execution.
- Native browser execution remains unverified: the cached Playwright package has no matching downloaded browser; the installed `/usr/bin/chromium` fails with `socket() failed: Operation not permitted`. Do not repeat local launch attempts; run relevant browser CI after publication approval.

The initial test-config startup hit `uv_interface_addresses` in network-interface discovery. Setting the existing `DEV_LAN_HOST=127.0.0.1` override allowed the unchanged test configuration to run; no source workaround was added.

Evidence identity: Node 24.19.0, npm 11.9.0, React/React DOM/test renderer 18.3.1, Vitest 3.2.7, Vite 6.4.3, TypeScript 5.9.3. Installed dependencies are reused from the matching-lockfile streak worktree. Package-lock SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`; installed dependency manifest SHA-256 `6964e32dd8cfa9e3912b31f4b53858df2c99d7f2cd45f15bc0c069190de37940`. The actual versions above were read from installed packages. Browser discovery used Playwright 1.62.1, not the CI version 1.64.0.

Verified production file SHA-256: `e04ef306c6429e090f0c25145df00977683710dc819468082b25fcbc58e6468f`.
Verified component regression file SHA-256: `a068281ed117e500b8d83d770f97615358a93145b9c9915ad22831bba948c6c4`.

Next: obtain publication approval, reconcile latest main, and run keyboard/concurrency/failure-recovery browser CI plus the existing affected AI-view fixtures. Native browser verification requires an available browser executor; synthetic events do not prove a real Japanese IME or physical mobile keyboard.

Completion requires a reviewed exact diff and passing applicable focused checks. Publishing/merging and native browser evidence are not implied by local implementation.
