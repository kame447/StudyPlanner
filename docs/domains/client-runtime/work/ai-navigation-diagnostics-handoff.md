# AI navigation and diagnostic visibility

Status: PR #611 published; browser contract correction prepared locally, exact-head revalidation pending.

- Branch: `fix/ai-navigation-diagnostics-20261013`
- Integration base: `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9` (advanced from `e44f4b4154608a4ebd41399b8f41d6f6dce7431c`; the four upstream approval files are untouched).
- [PR #611](https://github.com/kame447/StudyPlanner/pull/611), published head `9f2fe3efef9e5a1c4faa93b1f6ba516344cc76d1`, matches local `51790c2f7262c179f8241bb5c9baa775ea148889` tree `c6ea34d7aeaf3a95066c4ea3e5723debaba1ba6c`. No new Issue; related historical PRs #537 and #558 are merged. Keep the branch while review is open.
- Scope: first-entry code loading, owner-scoped AI presentation lifetime and ordinary-user diagnostic visibility. AI interpretation/controller/approval/persistence contracts and #488 remain untouched. Contact content has a separate owner.

## Findings and changes

A failing real-App regression confirmed that navigation remounted the AI presentation, losing its draft/attachment and repeating starter-catalog reads. AI was also absent from optional post-startup preloading. Repeated chat initialization or network chunk downloads were not established: chat initialization is idempotent and React.lazy caches the module. Production-device latency remains unmeasured.

The visited AI presentation now survives ordinary navigation for the current owner and is discarded on sign-out/account replacement. It uses the current planner-owned catalog snapshot. Inactive UI releases viewport listeners, preview scroll locks and the microphone, dismisses nested confirmations and revokes unadmitted OCR/code waits. Already-admitted turns can finish for their existing owner/chat; late callbacks cannot submit another turn or revive a consumed attachment. Return scroll follows a new answer only when the reader had been following the conversation end.

Optional AI code preload retains the existing startup gate. Cold entry uses a local AI status; return navigation retains the same composer. The shell and view share one explicit active-owner/route/settings condition, replacing CSS inference from hidden descendants without adding another state source.

Support no longer contains timing controls. Query-enabled production timing UI requires current verified administrator status; development keeps explicit query diagnostics. Normal URLs perform no new identity/admin lookup. Anonymous bounded measurement remains independent of panel access; no authorization policy, credentials or Rules changed.

## Final local verification

The final active-shell snapshot passed `npm run verify` on 2026-10-13: fresh non-incremental app/Worker checks, 833 test files passed / 11 skipped, 7,664 tests passed / 54 skipped / 1 todo, and production build. Before/after identity receipts match all 2,402 source inputs, 19,305 installed files (362 package manifests), generated Worker types, tools and selected environment inputs. Node was v24.19.0. Subsequent checkpoint editing is documentation-only; runtime/test hashes are checked against this snapshot before commit.

- Verified source/test manifest SHA-256: `1bafb65c9c2e37fbc6d4dc3562a204b6c163463a37374bf63415eb469495bfd5` (sorted compact JSON of path → content SHA-256).
- Independent review has no remaining blocking finding, including owner disposal, pending-provider completion, fallback viewport, sidebar dismissal and admin identity changes. Its focused checks passed, including the final shell-class transition tests.
- The unchanged asset guard passes every CSS, individual-JavaScript and appearance limit. Largest CSS is 424,972 bytes against 425,000; total CSS is 492,741 against 493,000.
- Aggregate JavaScript remains over the existing limits: raw 2,344,547 / limit 2,265,000; gzip 631,648 / limit 610,000. Main05c78 CI run 38357434643, artifact 11794085377 already reports 2,342,881 / 631,147. PR #611 CI artifact 11795621250 reproduces the same candidate totals under Node22: remote-to-remote deltas are +1,666 / +501 bytes. Installed-byte equality between CI runs is not established. Largest CSS is 22 bytes below that baseline; total CSS is 62 bytes above it. Thresholds are unchanged.
- An earlier frozen candidate passed full verification but added a largest-CSS failure. The explicit active-shell state fixed the fragile layout inference; the final source received a new full verification. Earlier proof is not substituted for the final result.
- Published-tree browser evidence: Chromium passed all 24 targeted cases; WebKit-mobile passed all 13 AI/diagnostic cases, with 209 passed / 3 skipped overall and no flaky result. CI checked merge-test commit `5c665959c7004aa4ecc919a154697076d828bfaf`, whose tree exactly matches the published/local candidate. All desktop browser projects, visual comparison (4 cases) and browser quality (5 cases) passed. Rendered Chromium/WebKit AI composer and ordinary Support images were inspected. Keyboard/pinch geometry uses simulated VisualViewport inputs, not a physical iOS keyboard. Owner-switch/admin-revocation and microphone lifecycle coverage remains component/integration-level, not native device/auth testing.
- Full Chromium regression passed 578 cases and failed one legacy assertion requiring AI DOM removal after navigating Home. Its trace, screenshot and accessible snapshot show the correct Home with the retained AI hidden. The test-only correction replaces that obsolete unmount contract with hidden/inaccessible/no-layout-box checks, released shell geometry, settings history, restored Home bounds and unobstructed real clicks. No runtime source changed. The frozen correction passed fresh local `npm run verify` (7,664 passed / 54 skipped / 1 todo, app/Worker types and build); before/after source/installed/tool/environment identities match, and every emitted bundle asset/size is identical to the earlier candidate. Syntax and three-case collection pass; the changed browser assertion still requires the new exact-head CI run.

Raw logs and complete before/after manifests are retained outside the publication diff. No dependency, build configuration or budget limit changed.

## Remaining exit criteria

1. Owner decision on the inherited aggregate-JavaScript budget failure; do not describe the whole quality gate as green.
2. Publish the minimal test-contract correction to the same PR, then follow the new exact-head browser CI to a terminal result. Local browser execution remains blocked by Chromium socket EPERM and missing WebKit libraries.
3. Review and integrate only after the applicable checks are terminal. PR publication/browser verification is approved; merge/deployment is not included.
