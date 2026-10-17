# Desktop ordinary-timer intrinsic face

Status: publication and bounded native verification approved on 2026-10-17; before-image defect confirmed, corrected native rendering pending.

## Confirmed finding

An existing Chromium screenshot supplies evidence that was missing from the
earlier timer audit: at **1280×844, root text 200%**, the ordinary `00:00:00`
clock extends past the right edge of its circular ring. The inner background
also expands independently of the fixed ring. This is the saved
`separate-actions-1280-200.png` image in artifact **12099425329**, run
**39025722871**, checkout **676e9ebc** / PR head **22db200e**.

The test's purpose was separation of class inspection and unplanned study
actions. It did not assert clock containment, so its screenshot can expose this
defect without a timer-geometry test failure. The image catches the entry fade;
that uniform pane animation does not explain the clock expanding relative to
its own ring. It is not a final-state DOM measurement or a post-fix screenshot.

Timer CSS, component, time model, typography and font inputs are unchanged
between that source, the previous local audits and the current main tree.

## Current base and ownership

- Branch: `fix/desktop-timer-intrinsic-face`.
- Local base: `628e3df6839d92668d3de727ed3239ef5df0f827`.
- Its complete tree `ee6e0ec5156df5a5838a24c9af0bddb6d30920d3` equals official
  main `8261300b3f681150127c726169708efd93a4a68a`, confirmed by the ownership
  coordinator at 17:39 UTC on 2026-10-17. This is not a claim that the local
  branch has the merge commit as its parent.
- PR #707 retains the separate Study/Report motion scope; no new timer
  typography/geometry owner was found. The candidate changes no motion hooks.
- Existing unpublished `a698419b` and `3eb49b1b` remain clean and untouched.

## Root cause and narrow candidate

The tall layout fixes the outer ring to `min(260px, 30dvh, 100%)`, while the
clock font can enlarge and the inner Grid keeps its intrinsic content width.
Shrinking text would lose requested enlargement. Hiding overflow would discard
time digits. Replacing every timer with the short rectangular layout would
change unrelated mobile and Pomodoro presentation.

Instead, only ordinary timers at width ≥1024px and height ≥801px let the outer
ring use the same intrinsic content width. The old size remains a minimum;
available pane width remains a maximum. The clock remains one line. Font size,
elapsed/remaining calculations, Grid row separation, circle styling, and
meaningful vertical scrolling are retained. This applies to both planned and
unplanned ordinary clocks; Pomodoro and the ≤800px shallow layout are unchanged.

Native layout must still confirm percentage-size/aspect-ratio resolution,
circle-edge containment and enlarged planned-badge positioning. Source checks
are not a substitute for that result. Measure inner/outer rectangles including
padding, verify the outer width/height ratio, and preserve keyboard access to
Start/Finish after any vertical growth.

## Evidence and remaining matrix

| Surface | Existing evidence | Still unverified |
| --- | --- | --- |
| Ordinary, shallow desktop | Saved 1280×800 start/running images; existing compact tests | Exact 1280×720 image and new candidate carryover rendering |
| Ordinary, tall desktop | Saved 1280×844/200% image visibly escapes the ring | Post-fix rendering; 1280×900, 1440×900, 1920×1080 at standard/pixel 100%/200% |
| Planned ordinary | `3eb49b1b`: three state cases for pause/return/overrun and mode separation; separate normal-flow Grid rows | Native nonzero/zero remaining badge at enlarged text and curved-face containment |
| Pomodoro | Saved 1280×800 start image; 1280×900 custom-settings image is **settings, not a running clock** | Tall 1440/1920 running phase clock, enlarged text and full phase/controls geometry |

The six native acceptance definitions in `a698419b` already cover the ordinary
tall clock before start and after 3,661 seconds, with loaded standard/pixel fonts
and 100%/200% text. The release supplement below preserves those case identities
and strengthens geometry checks. QA owns one collection of the final combined
source; completed checks are not repeated without changed inputs. Publication
and bounded native verification were approved
on 2026-10-17. The sole publisher owns external writes and CI execution.

### Native release supplement

The release supplement retains the original 30-case source body and all six
`a698419b` case identities in `study-session-compact.spec.mjs`. It additionally
records computed ring padding and checks inner-face containment inside that
padding plus the outer circle's width/height equality (1 CSS-pixel tolerance).
These are soft assertions so failed geometry and pixels remain available for
all text scales and clock states. One additional planned ordinary case at
1440×900/pixel/light checks the same geometry before start, after 61 seconds
(remaining 00:58:59), and after 3,661 seconds (remaining 00:00:00), each at
100%/200%. It records the remaining badge and its text fragments, requires its
rectangle below the elapsed clock and inside the inner face, and preserves
Start/Resume/Finish keyboard reachability. This is the direct planned consumer
of the same changed CSS, not a Pomodoro redesign. Range fragments remain layout bounds rather
than raster-ink or circular-edge proof; visual inspection is still required.

The implementation remains exact `f5e7010f`; no typography, timer state or mode
behavior changed in this supplement. The integration owner uses official main
`a39defd865ff86eb1aba9c5329718057543deb47`, whose five weekly-planning changes
do not overlap these timer inputs (ownership readback 2026-10-17 18:12 UTC).

The original `a698419b` independent-review file was overwritten during a later
review and has not been recovered. This release relies on fresh source review
of the integrated native spec, plus the dedicated intrinsic implementation
review copy. No restoration of the missing historical receipt is claimed.

## Local verification

- New CSS contract regression: baseline **1 failed / 2 passed**; after change,
  **5 passed across 2 related style files**.
- Fresh app TypeScript check: pass. No full suite or build was run.
- Source/CSS inspection preserves existing font enlargement and compact/Pomodoro
  declarations. No browser launch, external write, new screenshot or production
  query was performed.
- Durable evidence: `laplans-desktop-timer-intrinsic-evidence-20261017`, including
  original image identity, source hashes, raw local logs and final receipt.
- Independent source review found no blocker in the narrow CSS scope and
  independently confirmed the old screenshot's overflow. Its acceptance is
  limited to source correctness; the corrected rendering remains a gate.

Exit condition for a product-fix claim: authorized native rendering must show
the clock, inner face and outer ring contained at the six already-defined
desktop font/size cases, with planned-badge and compact behavior checked at the
affected boundary. Until then this is a locally verified source candidate,
not a rendered fix or release-ready change.

## Approved timer/material integration checkpoint — 2026-10-17

Publication and bounded native acceptance for these two surfaces were approved;
external writes remain assigned to the sole release owner. The local integration
branch is `fix/timer-material-responsive`, based on official main
`a39defd865ff86eb1aba9c5329718057543deb47` (tree `67e6a7ec`).
Main was fetched from the explicit upstream URL and checked again at 18:15 UTC.
Its five #740 weekly-test changes are retained without modification.

The integration combines timer implementation `f5e7010f`, materials `710a9a64`,
and fresh-reviewed timer native supplement `c153199d`. The only overlap was
the domain README, resolved by retaining both work-record links and all earlier
entries. Shared shell, Splash, motion, state, repository persistence and browser
configuration remain unchanged. The earlier missing timer review receipt is
not reused; the supplement is reviewed as current source.

One fresh non-incremental app typecheck and one production build passed on the
combined CSS/source inputs (build 6.17 seconds). Later native-spec/doc additions
have no build-input delta; 1,850 tracked application/public/build-input hashes
bind that reuse. Both scoped rules are present in the emitted CSS. Installed
Node 24.19.0, npm 11.9.0, Vite 6.4.3, TypeScript 5.9.3 and Vitest 3.2.7, actual
shared dependency location and successful physical inventory are recorded.
No dependency install occurred. The documented `DEV_LAN_HOST=127.0.0.1` input
was used; no browser or local socket launch was retried.

Prior owner focused evidence is carried only by exact inputs: timer five style
checks and material thirteen source/component checks. No combined full suite,
Worker check or duplicate owner test/build run is claimed. The two changed
product files are CSS; no runtime TypeScript or Worker boundary changed.

Next: the QA owner collects the bounded consumer definitions once; the sole
publisher executes them on the exact final tree. Review actual ordinary-clock
100%/200% circles and planned badges, long material detail/editor wrapping,
short-height/mobile scrolling and keyboard Save/reload. Source/type/build
success is not rendered acceptance. Preserve failures and before-assertion
geometry/images; repair their demonstrated cause before a completion claim.

Evidence is bound in `laplans-timer-material-integration-evidence-20261017`.
The material-specific acceptance and retained 720px/92dvh contract are described
in [Material long-text containment](material-long-text-containment-handoff.md).

QA collection checkpoint: 148 bounded project-qualified definitions collected
once (82 standard Chromium, 66 existing cross-project definitions). The timer
spec retains 30 original cases plus six enlarged-clock cases and one planned
badge case. Collection is not browser execution; next gate is the publisher's
exact-tree native run and saved-image review. No second collection is needed
for this documentation-only checkpoint.
