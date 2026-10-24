# Authentication entry pending-operation admission

Status: local implementation and focused checks complete; native acceptance blocked; not published
Owner: PC UI lane, Issue #483 umbrella
Base: ef8d5ad9388eafb55dffba128291e81842eaa80d
Branch: fix/auth-entry-pending-admission

## Evidence and alternatives
AuthScreen dispatches every submit/reset/Google click while earlier promises are
pending. useAuthSessionState also dispatches each repository call. There is no
busy feedback or admission barrier. Delayed registration can also switch modes
and clear passwords after the user already changes the form.

Alternatives considered: an existing lower-layer lock (falsified by direct
source inspection), provider-side deduplication (does not protect UI intent and
is not established), or entry-owned synchronous pending admission (chosen;
smallest scope and directly verifiable with deferred callbacks). No provider,
authentication policy, credential, persistence or root-session changes.

Open/closed issue and PR searches and all remote branches checked. Existing
login-starfield scope is merged; no active entry-admission owner found. Material
#741, Timer, Home/AI/Report, #751/#759/#382 and Jev remain outside this work.

Initial plan (completed below): reproduce repeated and competing operations
with deferred component callbacks, add entry-local admission/busy state and
retry recovery, then focused checks. Browser/provider behavior remains unverified.

## Local checkpoint

The original component failed all five new deferred-operation regressions:
repeated password/Google/reset dispatch, registration mode drift, and an
unexpected rejection escaping the form. Existing 16 component cases passed.
The candidate uses an entry-local synchronous ref plus rendered pending state,
keeps the submitted form/mode disabled until settlement, catches unexpected
callback rejection, and allows retry. Unmounted handlers cannot dispatch again. Layout-effect retirement was chosen after independent review: a replacement-layout-effect regression fails with passive cleanup and passes with synchronous commit-time retirement.
The auth provider/session hook, saved state and notice action remain unchanged.

Verification on the candidate:
- 57 tests / 4 related files pass: AuthScreen (23), auth session (10), profile
  lifetime (20), entry CSS (4).
- Fresh non-incremental app TypeScript check and one production build pass.
- Existing authentication harness adds deferred callbacks only with explicit
  authDeferred=1; normal scenarios keep resolved synthetic callbacks.
- New native cases cover 390px/1280px Enter, repeated requestSubmit, busy controls,
  rejection/retry, preserved email and later mode switching. JSX transform and
  native spec syntax pass.
- A local 15-case Chromium selection was attempted with retries=0. Every case
  stopped at browser launch (socket() failed: Operation not permitted), before
  application assertions. No alternate launcher or permission bypass attempted.
  Actual rendering/native input are UNVERIFIED, not 15 product failures.
- Full verify/Worker suite, CI, real provider, preview and deployment have not
  run. Related green is implementation feedback only; full verification and
  native acceptance are required before publishing a reviewable release.

Independent source review found no blocker after the layout-lifetime correction.
No GitHub write, main modification or merge. Next: final full verification before
publication and native acceptance in an authorized browser-capable environment.
Do not retry or bypass the local socket permission restriction.
