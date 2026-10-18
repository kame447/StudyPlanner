# Continuous radial action selection

Status: local implementation; publication and native acceptance pending.
Base: `522004730f57f726c95b25c412cdaba672128bc3`.
Branch: `fix/radial-continuous-flick` (local only).

## Requested interaction

Hold a schedule item for the existing 170 ms threshold without lifting the finger,
move toward one of the six existing ring actions, and release to select it once.
The original hold owns that gesture. It cannot simultaneously drag the schedule
item or scroll the background. Returning to the held origin or drawn ring centre
cancels selection; releasing beyond the ring also does nothing. Cancel, a second
pointer, blur, page hiding, and Escape release ownership safely.

The existing Move action still arms the next drag and retains its date/time dialog
fallback. Quick taps, pre-threshold scrolling, mouse dragging, context menus and
keyboard actions remain available. The old hold-then-drag contract is intentionally
replaced for Day/Week schedule cards, not for the AI preview's independent drag.

## Design choice and boundaries

Three alternatives were considered: opening only on release cannot satisfy the
same-finger request; letting drag and the menu race would make the action depend
on listener/timer ordering; giving the ring explicit gesture ownership lets the
existing Move action preserve drag without ambiguous simultaneous operations.
The shared press hook therefore retires pending timeline drag sessions at reveal,
retains the pointer/touch identity, and consumes the owned movement/release before
the card handlers. A mutable, session-local callback bridge connects the mounted
ring to its originating press without remounting on every move.

Direction is measured against the rendered, viewport-clamped ring. Both the
original finger position and the drawn centre have a 24 px dead zone, so a shifted
ring cannot select merely because it opened near an edge. Six 60-degree sectors
follow the existing action ordering. Outside radius + button diameter + 40 px is
unselected. No data, persistence, action admission, owner or authorization policy
changes are made.

Selection uses a visible outline and colour. A 10 ms `navigator.vibrate` request
is made only when entering a different enabled sector, when the API exists.
Unsupported or throwing APIs do not block selection. Physical vibration is not
proven by a return value. Safari/iOS lack this API; PWA installation does not give
this implementation a native haptics bridge. No hidden switch workaround is used.

## Verification checkpoint

- Existing-main Day/Week real hook/menu integration: four new expectations fail.
- Candidate integration: eight pass, including release-once, Move then drag,
  cancellation, and unrelated-input events through real Day/Week capture handlers.
- Final related twelve files: 275 tests pass. The initial four red expectations
  remain separate historical evidence; additional identity/cancellation coverage
  was added after that red run.
- New geometry tests cover six sectors, boundaries, clamped centres and cancellation.
- Native radial/scroll definitions are updated for the new contract. Their scroll
  samples, positive swipe recovery, persistence, duration, Undo and reload checks
  remain; the AI preview case is unchanged. Collection is not browser execution.
- Final fresh App typecheck passes; production build passes in 13.22 seconds.
- Four existing native specs collect 37 definitions (7 + 17 + 4 + 9); no browser
  execution has been performed. Independent source review is being finalized.
- Real browser gesture/visual acceptance and physical device haptics remain unverified.

## Next step

Finish independent source/test review, freeze exact local input hashes and related
checks, then request the separately authorized publication/native validation step.
Do not describe the local candidate as delivered or as an iPhone vibration fix.

## Sources

- [Original radial work](https://github.com/kame447/StudyPlanner/issues/777)
- [Previous gesture contract](https://github.com/kame447/StudyPlanner/pull/783)
- [Remaining actual iPhone validation](https://github.com/kame447/StudyPlanner/issues/780)
- [Vibration API limitations](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate)

## Post-publication click-boundary correction

PR #785 source `2487984a` passed Core after the rollback fixture was updated for
held release. Its first native run still failed four Day interaction cases on
both attempts: Move Undo, Move end, record-sheet close, and ending a cancelled
armed drag. Each final click completed, but its following five-second state
assertion failed. The section-wide 700 ms compatibility-click guard intercepted
these new controls as well as the original event card.

The Day/Week guard now suppresses only clicks that resolve to a current schedule
card. The original card's compatibility click remains suppressed; explicit
controls outside cards can work immediately. Swipe suppression, gesture ownership,
release/cancel timing, action callbacks, persistence, owner checks and rollback
are unchanged. Five real consumer tests deliver ancestor capture before button
callbacks, including immediate Undo. The first four reproduce red on the prior
source; all thirteen integration tests pass after the boundary correction.

A separate source-only focus check failed because a 200-character regex could no
longer span added menu attributes. JSX parsing now binds the unique focus ref to
its actual button and menuitem role. The exact allowed first-focus statement now
includes the existing non-gesture guard; unconditional focus remains rejected.
The entire static callback and in-memory negative probes were checked without
starting a browser.

Final local verification: 297 tests in thirteen related files, fresh App types,
and production build (13.15 seconds) pass. All tracked inputs were identical
before and after these checks; this checkpoint was added afterwards. The prior
native failures are retained. Corrected browser behavior and complete native
journeys still require the ordinary CI results; no timeout, viewport, recording,
assertion, or persistence expectation was relaxed.

### Follow-up Core guard-order correction

The combined-source Core run `39159571807` retained one failure in the existing
calendar swipe unit test: the new target lookup referenced the browser `Element`
global even when no schedule-action click suppression was active. The existing
DOM-free swipe fixture reproduces that failure without editing its expectations.
The two capture guards now check the suppression interval first, then resolve the
card only when needed. This preserves the original card guard and immediate
control actions while avoiding unnecessary DOM access on ordinary clicks.

The corrected combined main source passes 300 tests in fourteen related files,
fresh App type checking, and a production build (12.91 seconds). No test or native
spec was changed by this follow-up. Both unsuccessful CI revisions remain
recorded; final browser/Core acceptance belongs to the corrected public source.
