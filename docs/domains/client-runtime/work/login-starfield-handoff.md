# Login presentation and starfield

Status: active
Owner: UI umbrella Issue #483
Branch: `ui/login-starfield`
Base / initial HEAD: `98f3c324b5320d38294905c858ce1d2310209312`
Updated: 2026-10-13

## Scope
Replace the nested-card, signup-first authentication presentation with a compact login-first form on one dark canvas. Match the logo's dark surroundings without exposing the bitmap's rectangular navy edge, and add a sparse, slow, code-native starfield. Keep registration, verification-mail transition, reset, Google sign-in, notices and existing auth boundaries.

## Ownership and evidence
The supplied iPhone screenshot and current AuthScreen confirm signup is currently selected and narrow layout stacks the two mode buttons. Current open PRs, historical login PRs, all remote branches, local branches, and Issue #483 comments were inspected before implementation; no active login-redesign task was found. Reuse #483; no remote branch/PR has been created. Work is isolated from startup, recovery and other authentication screens.

## Acceptance and next step
- Login selected on first render; no forced input focus or mobile keyboard.
- A compact mode switch remains keyboard accessible on narrow screens.
- Logo and full-page background have no abrupt rectangular color boundary.
- Stars are decorative, low-cost and pause when hidden; reduced motion is static.
- Auth behavior regressions, app/Worker type checks, build and relevant browser specifications.
- Browser rendering is not claimed locally: this environment has a verified browser EPERM restriction. Publication and remote browser acceptance are coordinated by the parent and are not authorized in this task.

Next: implement presentation and focused regressions, then report exact verified commit and remaining remote/native browser gates.

## Local candidate checkpoint

The implementation removes both nested auth cards and duplicated mode descriptions. Login is selected initially; signup remains available with the same callback and verification result transition. The approved icon bytes are unchanged; a scoped CSS radial mask blends its varied navy edges into the `#060914` canvas. Login/registration use a shared two-column tab bar with roving tab stop and Arrow/Home/End navigation, but never focus an input on mount. Autofill hints are explicit, with `current-password` for login and `new-password` for signup.

Stars use only two CSS transform layers (23 static points total), with no media, canvas loop, timers, dependencies or extra network requests. The animation pauses while hidden, is static for reduced motion, and has an explicit pause/resume button. Local dark input/notice tokens maintain contrast independently of the saved light/dark palette, including late-loaded pixel appearance.

Verification on the candidate:
- 130 focused tests passed across 9 files: auth component and motion behavior, CSS contract/contrast, auth session lifetime, profile recovery, standalone admission, and startup video.
- Focused strict TypeScript check passed for the two changed components and their new tests/style contract. This is not the full app/Worker check.
- Browser definitions collect: 13 auth Chromium cases / 52 auth cases across Chromium, Firefox, desktop WebKit and mobile WebKit; all affected browser files collect 51 Chromium cases. Collection is not native/browser success.
- Existing startup, cold-start observation, and input-focus browser expectations were changed to login-first admission while retaining registration coverage.
- Full suite, fresh app/Worker types and production build are assigned to the parent's final cumulative integration stage, not repeated in this standalone worktree.
- No browser launch was attempted because the environment's EPERM restriction is already verified. Native rendered logo/background, viewport and animation acceptance remains open. No remote push, PR, main change or deployment has occurred.

Evidence directory: `login-starfield-evidence-20261013` alongside the isolated local worktree. Next: parent independent review and final cumulative verification; publish/browser acceptance requires parent authorization.

Independent parent review requested preservation of heading navigation. The current mode now remains as an accessible h1, visually clipped to avoid duplicate copy; component and native browser definitions assert its name in both modes. Logo-edge rendering and intact artwork still require real screenshot review after authorized publication.
