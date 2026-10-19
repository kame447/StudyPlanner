# Remove the shared preview-key screen

Status: implementation handoff snapshot; publication and final verification are tracked by the corresponding pull request.
Updated: 2026-10-09

## Scope and ownership

- Branch: `ui/remove-preview-access-gate`
- Current base: `dfcfd30072d347369804fe146edebfba982a1ab8`
- Historical candidate base: `32623e36f1ebf06058a16f6233514144dee467b3`
- Existing open/closed Issues, PRs and branches were searched for the shared preview key and access gate. No active implementation owns this removal. The existing local branch is reused; no duplicate implementation is created.
- The user requested removal of the photographed shared preview-key screen. This candidate removes that browser-only screen/state and exposes the existing registration/login form after the intro.
- The old gate compared a build-time value with browser storage. It did not create an authenticated session and had no Worker/API consumers. Deployment settings and stored old keys are not modified.

## Access boundary

Visitors who have the URL can reach the existing registration and login form without a shared key. A new visitor can register, verify their email, complete existing consent, and then use the ordinary features permitted to that account. This does not admit anonymous callers to authenticated APIs or expose another user's records.

Firebase authentication and email verification, root-owned privacy consent, per-user data isolation, Worker token checks and quotas, billing, and administration boundaries are unchanged. The diff does not touch their source, Worker configuration, Firestore Rules, production settings, or AI implementation/specification.

## Changes

- Remove the client-only gate module, form, App state and AuthScreen props/conditional.
- Keep ordinary registration/login/password-reset/Google callback wiring, legal links and startup presentation unchanged.
- Remove retired test mocks and harness gate props; document the now-unused environment setting.
- Add two App regressions with an old configured key but no saved grant. On the base both failed; on the candidate they pass. Signed-out users still see only authentication; signed-in users reach their normal Home. No old gate storage reads/writes occur.
- Add 390/1280px root/App browser regressions for intro completion/skip, ordinary authentication, old stored-key reloads and signed-out Home exclusion.

## Historical verification on base 32623e36

- Focused authentication/consent/profile-lifetime/owner/App scope: 11 files, 142 tests passed.
- Fresh app and Worker typechecks passed as the first stage of `npm run verify`.
- Full local `DEV_LAN_HOST=127.0.0.1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 npm run verify` returned 1: 6,398 passed, 3 failed by the existing 5-second timeout, 45 skipped and 1 todo; 774 files passed, 3 failed, 10 skipped. It did not reach its build stage. This is not a green full verification.
- The three unchanged failing suites were legacy production-import isolation, pathological diagnostic document limits, and the exhaustive session-minutes execution-policy range. They reported 6.91s, 6.48s and approximately 6.05s respectively. No assertion was weakened and none of those sources/tests was edited.
- With explicit `--maxWorkers=1 --minWorkers=1 --no-file-parallelism`, all 9 tests in those three files passed on the candidate: approximately 2.72s, 1.80s and 0.37s for the formerly failing cases. The same command on unchanged exact base main also passed all 9: 2.49s, 1.68s and 0.43s. These results are consistent with runner-load sensitivity, not proof of the original resource cause.
- The initial full run overlapped this task's Chrome/WebKit runs. The runner reported 9 available/logical CPUs. No CPU-saturation sample was captured at the failures. Single-worker diagnostic/control runs occurred after this task's browser work stopped. A repeated enormous local full run is intentionally deferred to the authorized release's exact-head CI; the first failure remains recorded.
- New entry browser regressions: Chrome and WebKit, 390/1280px, 4 passed. Existing auth callback/keyboard regressions: 8 passed. Supplemental capture checks: 4 passed, verifying correct selected-tab state and transition-completed screenshots. The supplemental checks are not added to the 12 distinct regression executions.
- The first browser attempt could not connect because its server was launched in a separate isolated execution session. Starting server and tests together resolved that infrastructure error, without production/test changes. Failed evidence was retained.
- Registration/login screenshots were inspected. Mobile content scrolls normally, without horizontal overflow or overlapping controls; desktop controls and legal links remain visible. A WebKit screenshot initially captured the 180ms tab color transition; the selected state and final image were separately confirmed.
- Separate production build passed in 14.09s; all 8 bundle guards passed. JavaScript: 2,251,250 raw / 606,213 gzip bytes.
- All 1,888 frozen source/test/config inputs and 237 installed locked dependency versions matched at the end. Node 24.19.0, TypeScript 5.9.3, Vitest 3.2.7, Vite 6.4.3, Wrangler 4.143.1; browser harness Playwright 1.62.1, Chrome for Testing 155.0.8059.39, existing WebKit wrapper.
- No real registration, sign-in, production Firestore/AI call, deployment, main write or public access-setting change was performed.

The historical candidate was not a completed rollout; its full-run failure remains recorded.


## Latest-main integration checkpoint — 2026-10-09

The latest released theme, material-name, Day-display and development-toolchain changes were normally integrated. App retains its AppearanceProvider and useAppAppearance wiring; only the obsolete key import/state and admission condition were removed. Independent read-only review confirmed that authentication, consent, data ownership and API limits retain their current responsibilities.

- Runtime snapshot `e5f70e5e4e83b12c7a236ef6bd95dfed8cb8bc93`: 176 focused tests /16 files passed, fresh non-incremental app/Worker types passed, production build and every current asset guard passed. The installed app dependencies now match the current lockfile (Wrangler4.147.0), not the historical candidate toolchain.
- Browser-test-only follow-up `1985b801e8a4183875e86acfb6437ecb0b8f3061` gives the two new entry cases initial viewport/screen dimensions and asserts actual document/visual/media widths. Existing behavior assertions, video cases and timeouts are retained. Application/type/build inputs are unchanged by this follow-up.
- Fresh standard/pixel Chrome/WebKit entry QA is in progress on that fixed source. No new browser-success result is claimed at this source checkpoint.
- The old three full-suite timeouts are not treated as resolved by focused tests. Complete exact published-head CI, including emulator, browser/visual/quality and asset gates, is required before merge. Post-main deployment and ordinary anonymous entry acceptance remain required.
