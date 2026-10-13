# Home inline add menu

Status: local implementation, review and full verification passed; browser/release acceptance remains open under Issue #483

- Branch: `ui/home-inline-add`
- Base / initial HEAD: `819d5bac3791b0d0aac2a6b1fd977fe73256edf6`
- PR: none; publication belongs to the integration owner.
- Ownership: the Home inline add menu is isolated from the separate study-start layout work. Existing Issue #483 and its comments, open Home PRs, and remote branch names were inspected on 2026-10-13; the prior chooser change in PR #501 is complete and no active same-scope owner was found.
- Scope: replace the bottom chooser with a plus/X toggle and event/study actions inside the current Today Schedule add-row bounds; preserve existing forms, callbacks, current-day defaults, navigation and owner lifetime.
- Next: obtain browser/visual evidence and resolve the existing aggregate JavaScript budget release gate through the integration owner; publication still requires authorization.
- Definition of done: repeated open/close/select, Escape/focus and navigation reset, both destinations/current date, narrow phone/tablet/desktop and theme layout verified; relevant tests/types, final full verify, applicable browser/visual gates and integration evidence must be reported separately.
- Verification: focused 52 passed, independent review passed, and final full verification passed at `5f3997a0`. Actual browser/visual acceptance is unverified. No publication or UI-completion claim.

## Earlier candidate checkpoint — 2026-10-13

The chooser now lives inside Today Schedule. The selected kind and displayed date go directly to the original Home form session. Escape, outside pointer/focus dismissal, retained-toggle focus restoration, date rollover and owner/navigation remounts are covered. Closed menus mount no extra actions or document listeners. No persistence callback or form implementation changed.

Focused verification: six files / 52 tests passed, including existing clock and Home application-session boundaries. Development app/Worker typecheck and production build passed; the Worker generator reported a nonfatal log-directory write warning. Changed browser specs pass syntax checks. The final full verification is next after independent source/harness review. Node 24.19.0; 235 installed package identities match package-lock, 101 absent platform-optional packages, no mismatches.

Independent review verified repeated destination/focus cycles, live callback replacement, date reset, Escape/Tab, and listener cleanup. It identified and resolved the initial 20px-only click strip and the all-empty browser seed. Central close width is 44px. Review leaves actual browser geometry as required evidence, including comparison against baseline at a tall relaxed viewport.

Browser verification is blocked before assertions: installed Chromium cannot open a required socket (EPERM), including an escalated attempt. The supported cloud browser only allows HTTP/HTTPS and cannot reach the isolated shell preview; a separate same-shell health probe succeeded but another invocation could not connect. No URL-policy or security bypass was attempted. The preview process was stopped. Authored narrow/theme browser tests remain unexecuted, and remote CI/publication remain with the integration owner.


## Responsive sizing correction — 2026-10-13

The earlier candidate `c3455f3a` / tree `1ec75d79d7e7a95c8a384652cf1fdd62c9e8d667` passed `npm run verify`: fresh app/Worker types, 813 files / 7,230 passed tests, 45 skipped / 1 todo, build 5.46 seconds. This is earlier evidence, not proof for the final CSS.

Independent review found a real regression in a permitted tall relaxation state: zero wrapper padding could reduce a populated row from 62 to 48px. Nine existing responsive padding expressions now share `--home-add-pad`; normal rows retain identical padding and full-height inline buttons receive it internally. No row sizing expression, media condition or cascade order changed. Intrinsic enlarged-text reflow remains supported. Source-level comparison restores all 20 row heights across 10 forced states; this is not browser geometry evidence.

Focused tests remain 52 passed. Browser regression now compares against the original one-button row under the same inherited layout, covers empty and populated tall relaxed states, and explicitly waits for the pixel font. Thirteen Home-add browser cases plus existing affected settings/content/compact flows are authored and syntax-checked, but unexecuted.

The separate bundle guard retains the base's existing aggregate JavaScript raw/gzip failures. The existing exact-base build and installed toolchain were identity-checked for attribution: clean base `819d5bac`, 2,366 tracked files, all 47 recorded output hashes unchanged, and matching installed package/tool/runtime identities. A temporary CSS-byte overage introduced by the verbose padding spelling was eliminated by one concise shared property and equivalent logical padding; all CSS guards pass without changing limits. The final full run and exact budget numbers are recorded below.


## Final local verification — 2026-10-13

- Verified code commit: `5f3997a0c4a054d28ea45258ed0f15764171d58d`
- Verified tree: `66776c54456a268bcdda82fbb890c4838c1cf455`
- Command: `DEV_LAN_HOST=127.0.0.1 CLOUDFLARE_CF_FETCH_ENABLED=false VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 npm run verify`, with `WRANGLER_LOG_PATH` set to the workspace evidence directory.
- Exit 0: fresh non-incremental app/Worker typechecks, 813 passed files / 7,230 passed tests, 10 skipped files / 45 skipped tests / 1 todo, production build 4.96 seconds. No lint script is configured.
- Exact before/after identity: all 2,369 tracked input hashes, 235 installed package identities, compiler/runner tools, Node 24.19.0 and executable match. No source, dependency or generated test input changed during the run.
- Separate bundle guard: exit 1 solely for the already-failing aggregate JavaScript raw/gzip limits. Final JS 2,340,967 raw / 630,444 gzip bytes versus verified base 2,340,326 / 630,385; delta +641 / +59 bytes. CSS total 492,509 and largest 424,824 raw bytes; all CSS, largest-JS and optional appearance guards pass. Thresholds are unchanged.
- Independent review: behavior/focus lifecycle and responsive-expression review passed; all nine original padding expressions/media/selectors/order preserved, 20 static sizing cases restored. No unresolved source-review blocker.
- Browser boundary: 13 Home-add cases plus affected compact/content/settings consumers are syntax-checked, not executed. Actual desktop/mobile/theme layout, screenshots and the expected saved-destination browser paths still require a permitted browser or CI.
- This checkpoint update after the verified commit changes Markdown only. It does not change the verified runtime/test/build inputs or require another full run under the repository's documentation-only rule.

Issue #483 is reused; `ui/home-inline-add` is the single new local implementation branch. No new Issue or PR, no push, no main modification, no deployment and no branch deletion were performed. Keep the branch until browser/release work is accepted or explicitly abandoned.
