# Home inline add menu

Status: draft PR #601 has corrected visual/cross-browser checks passing. The test-only pre-click scroll correction passed final local verification and awaits another exact-head browser run under Issue #483.

- Branch: `ui/home-inline-add`
- Base / initial HEAD: `819d5bac3791b0d0aac2a6b1fd977fe73256edf6`
- PR: [#601](https://github.com/kame447/StudyPlanner/pull/601), published by the integration owner after user approval. Initial remote HEAD `a9ebebf0f550075b849a0783204c4044be91eae7`, tree `5f86bbdc2021c1f1ad5508043272f0542205ad95`.
- Ownership: the Home inline add menu is isolated from the separate study-start layout work. Existing Issue #483 and its comments, open Home PRs, and remote branch names were inspected on 2026-10-13; the prior chooser change in PR #501 is complete and no active same-scope owner was found.
- Scope: replace the bottom chooser with a plus/X toggle and event/study actions inside the current Today Schedule add-row bounds; preserve existing forms, callbacks, current-day defaults, navigation and owner lifetime.
- Next: finish the initial browser run, verify the combined local corrections, publish the corrected same-PR content through the integration owner, and follow its CI to terminal. Aggregate JavaScript budget remains a separate inherited gate.
- Definition of done: repeated open/close/select, Escape/focus and navigation reset, both destinations/current date, narrow phone/tablet/desktop and theme layout verified; relevant tests/types, final full verify, applicable browser/visual gates and integration evidence must be reported separately.
- Verification: prior corrected local/remote full checks passed at `1e704d57` / remote `39d7c7c`, with 7,230 tests. Corrected visual 4/4 and cross-browser matrix pass; Chromium has 541 passes and one pre-click scroll-coordinate test failure. Final test-only correction full verification passed at `818940eb`; its new remote browser run is pending. No UI-completion claim.

## Earlier candidate checkpoint — 2026-10-13

The chooser now lives inside Today Schedule. The selected kind and displayed date go directly to the original Home form session. Escape, outside pointer/focus dismissal, retained-toggle focus restoration, date rollover and owner/navigation remounts are covered. Closed menus mount no extra actions or document listeners. No persistence callback or form implementation changed.

Focused verification: six files / 52 tests passed, including existing clock and Home application-session boundaries. Development app/Worker typecheck and production build passed; the Worker generator reported a nonfatal log-directory write warning. Changed browser specs pass syntax checks. The final full verification is next after independent source/harness review. Node 24.19.0; 235 installed package identities match package-lock, 101 absent platform-optional packages, no mismatches.

Independent review verified repeated selection/menu-focus cycles, live callback replacement, date reset, Escape/Tab, and listener cleanup. Its destination-focus harness used a simulated dialog boundary; this is not evidence that the unchanged real forms restore focus. It identified and resolved the initial 20px-only click strip and the all-empty browser seed. Central close width is 44px. Review leaves actual browser geometry as required evidence, including comparison against baseline at a tall relaxed viewport.

Browser verification is blocked before assertions: installed Chromium cannot open a required socket (EPERM), including an escalated attempt. The supported cloud browser only allows HTTP/HTTPS and cannot reach the isolated shell preview; a separate same-shell health probe succeeded but another invocation could not connect. No URL-policy or security bypass was attempted. The preview process was stopped. Authored narrow/theme browser tests remain unexecuted, and remote CI/publication remain with the integration owner.


## Responsive sizing correction — 2026-10-13

The earlier candidate `c3455f3a` / tree `1ec75d79d7e7a95c8a384652cf1fdd62c9e8d667` passed `npm run verify`: fresh app/Worker types, 813 files / 7,230 passed tests, 45 skipped / 1 todo, build 5.46 seconds. This is earlier evidence, not proof for the final CSS.

Independent review found a real regression in a permitted tall relaxation state: zero wrapper padding could reduce a populated row from 62 to 48px. Nine existing responsive padding expressions now share `--home-add-pad`; normal rows retain identical padding and full-height inline buttons receive it internally. No row sizing expression, media condition or cascade order changed. Intrinsic enlarged-text reflow remains supported. Source-level comparison restores all 20 row heights across 10 forced states; this is not browser geometry evidence.

Focused tests remain 52 passed. Browser regression now compares against the original one-button row under the same inherited layout, covers empty and populated tall relaxed states, and explicitly waits for the pixel font. Thirteen Home-add browser cases plus existing affected settings/content/compact flows are authored and syntax-checked, but unexecuted.

The separate bundle guard retains the base's existing aggregate JavaScript raw/gzip failures. The existing exact-base build and installed toolchain were identity-checked for attribution: clean base `819d5bac`, 2,366 tracked files, all 47 recorded output hashes unchanged, and matching installed package/tool/runtime identities. A temporary CSS-byte overage introduced by the verbose padding spelling was eliminated by one concise shared property and equivalent logical padding; all CSS guards pass without changing limits. The final full run and exact budget numbers are recorded below.


## Earlier published-candidate local verification — 2026-10-13

- Verified code commit: `5f3997a0c4a054d28ea45258ed0f15764171d58d`
- Verified tree: `66776c54456a268bcdda82fbb890c4838c1cf455`
- Command: `DEV_LAN_HOST=127.0.0.1 CLOUDFLARE_CF_FETCH_ENABLED=false VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 npm run verify`, with `WRANGLER_LOG_PATH` set to the workspace evidence directory.
- Exit 0: fresh non-incremental app/Worker typechecks, 813 passed files / 7,230 passed tests, 10 skipped files / 45 skipped tests / 1 todo, production build 4.96 seconds. No lint script is configured.
- Exact before/after identity: all 2,369 tracked input hashes, 235 installed package identities, compiler/runner tools, Node 24.19.0 and executable match. No source, dependency or generated test input changed during the run.
- Separate bundle guard: exit 1 solely for the already-failing aggregate JavaScript raw/gzip limits. Final JS 2,340,967 raw / 630,444 gzip bytes versus verified base 2,340,326 / 630,385; delta +641 / +59 bytes. CSS total 492,509 and largest 424,824 raw bytes; all CSS, largest-JS and optional appearance guards pass. Thresholds are unchanged.
- Independent review: behavior/focus lifecycle and responsive-expression review passed; all nine original padding expressions/media/selectors/order preserved, 20 static sizing cases restored. No unresolved source-review blocker.
- Browser boundary: 13 Home-add cases plus affected compact/content/settings consumers are syntax-checked, not executed. Actual desktop/mobile/theme layout, screenshots and the expected saved-destination browser paths still require a permitted browser or CI.
- This checkpoint update after the verified commit changes Markdown only. It does not change the verified runtime/test/build inputs or require another full run under the repository's documentation-only rule.

Issue #483 is reused; `ui/home-inline-add` is the single local implementation branch. The integration owner published draft PR #601 with user approval. No main modification, merge, deployment or branch deletion is authorized by that publication. Keep the branch until browser/release work is accepted or explicitly abandoned.


## Initial CI diagnosis and local correction — 2026-10-13

The initial remote candidate was tested as merge `376d8537ce622ee470c9c1a3a55ccd52c0f08222` against base `819d5bac`. [Core CI](https://github.com/kame447/StudyPlanner/actions/runs/38340667959/job/115110693774) passed fresh types, tests, Firestore rules, build and diff checks. [Visual CI](https://github.com/kame447/StudyPlanner/actions/runs/38340667982/job/115110693931) passed mobile light/dark but failed desktop light/dark.

- Production defect: replacing the add button with a div changed which sibling `:last-of-type` matched. The last plan lost its bottom separator and shifted lower content. The local correction uses `:last-child` in the two legacy end-of-row rules, preserving the original behavior when an add control follows. New populated-row browser checks require the 1px separator and actual row `::before` connector before and after opening. The later stylesheet suppresses the older dot `::after`; it is not claimed as a visible connector.
- Harness mismatch: three desktop browser projects failed only the settings test's transferred Escape assertion. The previous chooser supported Escape, but the unchanged study form does not. The corrected test checks inline-menu Escape/focus directly, preserves the hidden settings Escape/Tab and retained portal assertions, then closes the form through its existing Close button. Destination forms and their focus behavior are unchanged; real form-focus restoration is not claimed.
- Visual attribution: hero text/student differences already exist in exact-base source, but this does not mean the base visual gate fails. The same-base Todo-only PR #600 passes all four visual cases. Initial PR #601 diff pixels in the hero region alone are 3,049 light / 2,708 dark, below the unchanged 3,888-pixel allowance; lower layout shifts increase totals to 5,877 / 7,725. Keep all golden images and thresholds unchanged and verify the corrected candidate.

The initial [Browser Regression](https://github.com/kame447/StudyPlanner/actions/runs/38340667992/job/115110693654) ended with 536 passed / 6 failed. All 11 new geometry/theme/tall cases passed in real Chromium. The remaining failures were three known settings expectations, two save-flow measurements with unchanged width/height/x but unsettled y after Home navigation, and the focus-policy source guard lacking the new button statements. Mobile WebKit ended with 204 passed and the same three settings failures.

The navigation tests now wait through the existing visual-settle helper before measuring and retain exact bounding-box equality. The source guard permits only the two explicit non-input button-focus statements; an injected additional focus statement still fails. The eleven geometry screenshots now use persisted paths for the existing compact artifact uploader. Initial 390px/1280px open-menu screenshots were visually inspected and labels fit the row. Complete save-flow execution and corrected populated separators remain pending the next CI run.

The batched correction has focused 6 files / 52 tests passing, all three changed browser specs parse, and the exact source-policy assertion passes in a static harness. Corrected full verification and remote browser rendering are next.


## Corrected local verification — 2026-10-13

- Verified commit `1e704d578b918c76955cfe78ba68eea3d3edc7ed`, tree `ed68aa0984350633e53208cdfe77d8c0c6c78620`.
- Same final verification command as above: fresh non-incremental app and Worker types, full unit/integration suite and production build, exit 0. Results: 813 files / 7,230 tests passed, 10 files / 45 tests skipped, 1 todo; production build 4.93 seconds. No lint script is configured.
- All 2,369 input hashes, 235 installed package identities, tool hashes, Node 24.19.0 and executable are identical before/after. The verified worktree is clean.
- Separate bundle guard retains only the inherited aggregate JavaScript failures: 2,340,967 raw / 630,454 gzip bytes. CSS total 492,505 and largest 424,820 raw bytes pass unchanged thresholds.
- Root source review approved the two selector corrections and narrow browser-contract fixes. Exact focus-policy assertion passes; an added unapproved focus statement is rejected. Thirteen screenshots now use supported artifact paths.
- This subsequent checkpoint is documentation-only. Corrected remote CI, visual comparison and the two complete destination save paths must still pass on the next published head; the initial 11 geometry successes do not replace that evidence.


## Exact browser scroll diagnosis — 2026-10-13

Remote `39d7c7c9538d372e94deb014ac62478dd73ac067` matches local tree `88c3591ad3871bade9e92eff87f159e38d22ea74`. [Visual matrix](https://github.com/kame447/StudyPlanner/actions/runs/38343227052) passes all four original goldens and every cross-browser project. [Browser Regression](https://github.com/kame447/StudyPlanner/actions/runs/38343227061/job/115118669367) reports 541 passed / 1 failed: 390px event/study saves and reload pass, as do all eleven geometry cases and the repaired settings/focus contracts. All thirteen saved screenshots were inspected; labels fit, with the 300px study label wrapping inside its button.

The sole 1280px failure is caused by comparing coordinates before versus after Playwright reveals a partially clipped button. Preserved trace call `ppqp@16631` proves the schedule list's scrollTop changes 0→3 during the pre-click action snapshot, while the plus is still closed. The row's y becomes 400.171875 from 403.171875 before the click handler runs; height/width/x and every Home relaxation variable remain identical. Body/dashboard scroll offsets stay zero. This is not evidence of menu-induced layout movement.

The test-only correction performs the temporary original-row audit, explicitly scrolls the target into view, and waits for stable geometry before capturing the closed box. Exact full bounding-box equality remains unchanged, and ancestor scroll offsets must also remain equal through menu opening. The populated before/after geometry and offsets are attached as JSON. Application source, CSS, destination forms, screenshots and thresholds are unchanged by this correction. Final local verification and both complete browser save paths on its new head remain pending.


## Scroll-precondition final local verification — 2026-10-13

Commit `818940eb528e19b4b2b437813f89e68cf7314e9f` / tree `9a47eac39d5114b095bc537ce300ef474d7a112e` passes the final `npm run verify` command above, exit 0: fresh app/Worker types, 813 files / 7,230 tests passed, 10 files / 45 tests skipped, 1 todo, production build 5.31 seconds. All 2,369 source input hashes and 235 installed package identities, tool hashes and runtime are identical before/after; the verified worktree is clean.

The final bundle is byte-count identical to the prior corrected build: JS 2,340,967 raw / 630,454 gzip, CSS 492,505 total / 424,820 largest. Only inherited aggregate JavaScript limits fail. This checkpoint is documentation-only after that full run. The next published head still requires successful execution of both save/reload flows, exact position and scroll-offset assertions, and all thirteen screenshot cases.
