# Material long-text containment and desktop reachability

## Next diagnostic preparation — 2026-10-19

Status: isolated capture comparison authorized on 2026-10-19; implementation
continues on `test/wpe-recording-diagnostic-local`, based on main
`527adbd96074c40a9d18c2fb5b0954939f3b63e7` (tree `e5ecab2e`). The previous
reviewed config checkpoint is `e7a0021f`. Publication and one manual diagnostic
block are authorized; main changes, merge, additional blocks and production
changes are outside this scope. The original specs, observers and ordinary
regression commands remain unchanged. Issue #776 remains the investigation
owner; #741 and #797 being merged does not prove a latency repair.

The latest accepted #797 source ran the four original month cases successfully.
Its mobile 1280px case took 15.571s; an earlier instrumented source took 29.886s.
These are different runs and application inputs, not an A/B improvement. In the
separate material shard on tested source `3e7b6024`, both Cancel200 attempts
failed later in the original contract. Their observed Cancel trials did finish:
stable checks 5530.695/5465.537ms, native second-frame gaps 3809/3788ms, sampled
cgroup CPU about 3.91/3.92 cores. Sparse post-focus rectangles agreed. Node loop
maxima 26.116/22.987ms and zero recorded memory-pressure/throttle deltas do not
explain those multi-second intervals; they also do not identify rendering versus
application JavaScript versus recording. Three early timers cover only 304/306ms.

### Candidate comparison

1. Large-area compositing remains plausible, but the DOM does not identify one
   shared CSS culprit. Month sheets/editors use fixed full-screen overlays with
   backdrop blur, including a body portal for the editor. The ordinary material
   structure editor uses a solid modal overlay/card; pixel appearance adds page
   gradients and layered card frames. Removing several effects would conflate
   variables and change rendering. The completed footer-filter ABBA already
   retained roughly 4.0–4.4s stable waits and exposed first-open warmup. It did not
   establish filter causality and must not be repeated as the next experiment.
2. Application JavaScript/render work is possible. The observed Cancel trial is
   before its state-changing click, and inspected projections are memoized; no
   continuous application render loop has been demonstrated. Process CPU is not
   a JS profile, and early timers cannot exclude later long or repeated tasks.
   Chromium CDP profiling does not profile this WPE target. Long-task observer
   capability has not been established on the exact WPE runtime.
3. Continuous browser capture is the smallest reversible independent diagnostic
   treatment. Pinned Playwright 1.64 records video and trace images during passing
   attempts too; retention happens afterward. Both consumers share one Screencast
   stream, so video-off alone leaves capture active and is an insufficient test
   of screenshot-readback cost. The next comparison switches demand for that
   stream off, without changing the page's visual production inputs.

### One factor, two capture consumers

`playwright.wpe-capture-diagnostic.config.mjs` selects only the existing
`webkit-mobile` 1920×1080, 200% detail/Cancel case. It does not copy or shorten the
scenario. The original full focus/trial, Cancel, live-state, full reload, geometry
and explicit PNG assertions still run under the same 30s deadline and retry 1.
DPR 3, browser binary, native clock, locale, reduced motion and source stay fixed.

Run exactly one counterbalanced block, in this order:

| Slot | Video demand | Trace continuous images |
| --- | --- | --- |
| capture-on-1 | retain-on-failure | true |
| capture-off-2 | off | false |
| capture-off-3 | off | false |
| capture-on-4 | retain-on-failure | true |

The causal factor is **continuous browser screenshot capture**. Two fields must
change because two consumers keep the same stream alive. This is not a pure
FFmpeg experiment and cannot distinguish readback, encoding, compositor or their
interaction with page rendering. In BOTH diagnostic arms, trace mode is `on`
with DOM snapshots and source capture retained. That common retention choice
allows successful treatment runs to be audited; it is not the ordinary release
trace-retention policy. Trace/observer overhead remains and may alter scheduling.
Explicit application screenshots remain enabled in both arms. No launch flags,
alternate binary, timeout extension, force click or browser-socket workaround is
part of this preparation.

After a single build of the frozen input, the intended command for each listed
slot is the same, with only the slot value changed:

```sh
CI=1 LAPLANS_CAPTURE_DIAGNOSTIC_SLOT=capture-on-1 \
  node tests/e2e/node_modules/@playwright/test/cli.js test \
  --config=tests/e2e/playwright.wpe-capture-diagnostic.config.mjs \
  --project=webkit-mobile
```

Use the same native Linux WPE container/host and one worker, sequentially with
fresh processes/contexts for every slot. Preserve each nonzero exit and both
attempts; a failed first command must not silently omit the remaining planned
arms. Do not rerun a slot to get a preferred outcome. Separate artifact paths
prevent later arms from overwriting prior results. A single block is bounded
diagnostic evidence, not a statistical reliability or speedup claim.

### Required readback and stopping rule

- Bind source tree, original spec/helper/config hashes, production build and
  installed runner/WebKit identity before interpreting comparisons. Missing or
  changed inputs invalidate equivalence.
- Confirm the executed configuration and trace context: treatment has no
  recordVideo, video artifact or screencast-frame records; control has capture
  demand and actual frame records. Action logs, DOM snapshots and original
  explicit PNGs must remain. Missing trace is unknown, not proof of no capture.
- Compare first attempts separately from retries: native frame gaps, ordinary
  trial/stable intervals, WPE ticks, cgroup deltas, Node delay, sampled rectangles,
  and the full original behavioral outcome. Keep failed/missing endpoints.
- Concordant shorter frame and stable waits in both treatment slots, with
  preserved outcomes and reproduced slow controls, would support capture-path
  cost. A shorter whole-case duration alone is insufficient. Slow treatments
  despite confirmed capture absence disconfirm capture as the dominant cause.
- If controls do not reproduce, inputs drift, counters/frames are missing or
  treatment changes behavior, stop as inconclusive. Do not proceed to a broader
  CSS change or a new experiment automatically. Positive evidence would justify
  a separately reviewed rendering/capture investigation, not reducing normal
  acceptance recording or calling the product fixed.

### One-shot execution route preparation (2026-10-20)

The existing diagnostic branch `test/wpe-recording-diagnostic-local` at
`0c0f0071a83ebf2755a9b1689bbad007497b1f86` is being continued, not replaced.
Manual dispatch is unavailable through the current connector; cloud CLI and
browser are unauthenticated. No diagnostic run exists as of this checkpoint.
A temporary exact-branch push workflow is prepared for review, not published.
Its exact parent-SHA, non-forced/non-deletion and first-attempt guards admit only
one normal successor commit. Its unique workflow name avoids the automatic QA
summary, and existing push workflows do not select this branch. The original
manual workflow and acceptance configuration remain unchanged. The existing
15-minute, four-slot, public-repository, no-secret/API, archive-size and retention
limits remain. Remove the temporary workflow after the terminal result using a
normal same-branch commit; the changed parent makes cleanup ineligible to rerun.
Next: independent review of the exact diff and guards, then publication only
when authorized; read back the resulting run and interpret the original ABBA
artifacts under the stopping rule above. Never mark the product fixed from this
isolated diagnostic or silently start a second block.

### Isolated execution checkpoint

The existing UI Regression Matrix now has a default-off Boolean
`wpe_capture_diagnostic` manual input. When selected, only its diagnostic job
runs; the ordinary job predicates are preserved behind an exclusion guard. The
diagnostic has its own non-cancelling concurrency group, the unchanged native
WPE container/user and one worker. It rejects workflow reruns, a private/wrong
repository, any ref except `refs/heads/test/wpe-recording-diagnostic-local`,
spec overrides and context-reuse/debug flags. It uses no secrets,
AI API, new cache or paid runner. No new workflow is introduced.

The job installs/builds once and invokes the original full case in four fresh
processes, in the fixed ABBA order above. Collection first requires one identical
logical test per slot, 30s/retry1 and no result attempts. Source tree and built
file hashes must stay identical before/after every arm. The partial block record
is saved before browser work and after each exit. A nonzero original case exit
does not skip the next arm and cannot turn the diagnostic job green; input drift
stops as incomplete. Original outcomes and each attempt remain in their own
reports, traces and logs. No wrapper changes the case timeout or replays a slot.

The diagnostic job has a15-minute cap. The existing automatic QA summary has a
5-minute cap and no matching PR to update. Planned active wall time is6–12minutes
excluding the queue, with at most20 allocated standard runner-minutes. The four
cases can consume up to240seconds of case-body deadlines including retries;
setup, teardown, trace finalization and packaging are additional. Hitting the
job cap yields incomplete evidence, not permission to retry or extend it.

Exactly one complete archive is admitted for upload after measuring its size:
1GiB maximum with1MiB reserved for the upload ZIP envelope, retained7days.
Symlinks, oversize or missing evidence fail admission; no truncated substitute is
uploaded. Public standard runner compute is free under the checked GitHub
billing terms; even fully billed1GiB for7days at USD0.25/GiB-month is at most
USD0.0625 using a28-day month, within the authorized USD0.10 ceiling. Recheck
repository visibility and price/runner conditions before dispatch. Do not change
billing settings or add a cache. Pricing reference:
https://docs.github.com/en/billing/concepts/product-billing/github-actions.

Local focused evidence:8 existing config probes and8 new orchestration probes
pass; four new collection-only reports each select the original Cancel200
identity. YAML parsing and21 source checks, including48 mode combinations,
preserve ordinary paths and bound the opt-in path. These are not executed or
skipped browser cases. The orchestration probes include a real child-process
mock: four distinct PIDs, original argument list, first-arm failure retained,
remaining arms executed once, partial checkpoints and repeat-block refusal.

Fresh app/Worker typechecks passed locally. The ordinary `npm run verify`
stopped before unit execution because existing Vite LAN-address discovery raised
`uv_interface_addresses` errno1; the full suite is unverified. Wrangler also
reported a nonfatal local log-directory write failure while still generating
runtime types. No OS restriction or browser socket was bypassed. A separate
production build passed in14.57s using the existing supported
`DEV_LAN_HOST=127.0.0.1` manual setting; this is not a full-verify pass. Independent
final review, publication and the one native block remain pending at this
checkpoint. The native job retains its ordinary build environment.

## Current ordinary-PR observation — 2026-10-19

The ordinary run on public `d6815f4b` / actual `af1ddf01` completed all 116
selected definitions: 113 first-attempt passes and three failed 1920px mobile
WebKit cases (Save 100%, Cancel 200%, Save 200%, both attempts timed out). The
previously failing Cancel 100% passed on this source. This does not establish a
causal speed improvement or complete the wide acceptance. The selected set has
no skip/flaky cases; a separate Day cancellation 1280px case was flaky in the
same downloaded mobile shard and is tracked independently.

The six traces show successful real Save and same-App reopening with new values,
or successful Cancel and unchanged complete preferences, before full-document
reload. The final reopened editor verification did not complete before the
30-second test deadline. A reporter step closed during teardown is not evidence
that its browser assertion passed. Current data, state and actionability reviews
agree that neither data loss nor a specific product performance cause is shown.
Cancel focus/trial waits about 5.5s with unchanged before/after editor scroll and
no repeated `not stable` log; the Save field has one unstable-position retry.

The next change adds bounded observation to that existing mobile 1920×1080,
DPR3, dynamic 200%, detail/Cancel test only. It surrounds its unchanged normal
Cancel focus/trial/geometry operation with two preserved native rAF samples,
three native 100ms timers and non-overlapping 250ms read-only resource samples.
It reuses the reviewed WPE observer implementation. Missing counters, detached
nodes or partial native callbacks remain missing/partial; observation errors
cannot skip or replay the original UI action or replace its failure. Partial
JSON is attached before optional executable identity hashing. No environment
or command-line dump, credential/network capture or new dependency is added.

The current single-seed setup, all navigation and Save/Cancel/live/full-reload
assertions, two PNG captures, normal trial checks, 30s timeout, retries, video,
trace and device settings remain unchanged. The original 116 identities are
retained. New observer callbacks add layout reads, counter I/O and event-loop
monitoring, so timings will be instrumented observations, not proof of an
unmodified speed gain. Native registration finishes before focus/trial starts; the
two frame samples need not overlap the utility stable wait. Compare recorded
registration and action-start timestamps before attributing those samples. The permitted counter traversal can miss a child forked
by another native thread; absent process data cannot establish an idle browser.

Competing explanations remain high-resolution WPE render/capture work, runner
resource contention and application layout/main-thread work. The native timer,
rAF, Node-loop and CPU/pressure timelines are intended to distinguish these;
none is established by the existing traces. The original App52eb WPE diagnostic
branch remains unexecuted and unchanged. This is instrumentation of the current
ordinary PR, not a replacement workflow or an assertion-relaxing diagnostic.

Local checks: 20 focused offline callback/error-priority/selection probes pass;
syntax and exact original-body reverse transformation are checked. No local
browser was started. New ordinary CI and observation validity are pending.
The current main8a8e composition preserves its Worker dependency update and
month editor helper. Application/build/config inputs are unchanged relative to
that reviewed composition; the ordinary CI will validate the published source.

## Resumed validation — 2026-10-19

PR #741 remains draft. The current local preparation normally merges public
`52ebec9f` with main `227410c6`, then its documentation-only successor
`bddcaf7a`, keeping current shared CSS cleanup, startup,
gesture, persistence, mobile sharding and official container setup. The only
conflict was the native material spec; its original 30 logical cases plus the
current main save-rejection case are retained. The independently reviewed
single-seed fixture from `c5d0aa7e` replaces only the duplicate initial bootstrap;
its complete post-opening actions, screenshots, bounds, Save/Cancel/live/reload
assertions and 30-second settings remain unchanged.

Prior results are not current-source acceptance: original four wide-WebKit cases
failed; single-seed source had 28 first-attempt passes, one flaky case and three
failures. Filter ABBA did not demonstrate a speed improvement. The existing
WPE observation branch remains unexecuted (official run count zero); its official
manual dispatch is unavailable to the current unauthenticated browser/connector.
No new workflow or local browser workaround is introduced.

Current local checks: 26 related tests across five files passed; the actual
old/new fixture callbacks through the current Local adapter passed all eight
structural-equivalence and negative-control probes. Fresh app types and the
production build (16.70s) passed. The initial standalone probe bundle failed
because bundling TypeScript into ESM introduced dynamic require; keeping the
installed TypeScript module external fixed the probe harness without changing
its assertions or product inputs. Full Core and native results are pending.

Independent source/main-union review is complete. The documentation-only
successor retains every tested executable input. Next: the existing PR's ordinary CI.
Completion requires the related original native identities to pass cleanly
on the published source, plus visual/action/reload readback. Neither a source
merge nor a passed unit test establishes a native latency fix.

## Historical source-candidate checkpoint — 2026-10-17

Status: local source candidate; new native rendering is unverified. Publication is not approved.

## Finding and boundary

The accepted material creation frame remains **720px / 92dvh**. Prior 1280px
screenshots showed that frame working; they did not cover 1440px, 1920px,
short desktop windows or long unbroken text. This work does not change its size.

Detail titles, subjects, current chapter text, activity notes/plan titles and
the contents editor's material name accept complete user values. Their clipped
parent panels had no unbroken-word wrapping rule. A 260-character ASCII token
in the actual bundled DotGothic16 font has a 2704px advance at the existing
20.8px heading size, or 5408px at 200% root text. Even the entire 1920px viewport
is narrower. This is source/font arithmetic, not a new rendered measurement.

Alternatives considered:

- Resize the creation/modal frame: conflicts with the adopted frame and does
  not address a detail page's unbroken text.
- Assume an inherited wrap rule or truncate the value: the inspected cascade
  has no applicable rule; truncation would remove the requested full text.
- Allow wrapping on those five text targets: selected. One grouped declaration
  retains the complete text and lets existing page/editor scrolling own height.

The new declaration applies at all widths. Deliberately compact contents-row
ellipsis stays unchanged; the full title remains editable. Inputs, shared modal
styles, typography sizes, motion, storage and auth code are unchanged.
PR706 remains the separate cover-motion owner; its detail delta adds only two
cover attributes and does not overlap this CSS rule.

## Exact local scope

- Branch `fix/material-long-text-containment`.
- Base `628e3df6839d92668d3de727ed3239ef5df0f827`, tree
  `ee6e0ec5156df5a5838a24c9af0bddb6d30920d3`, equal to official main
  `8261300b3f681150127c726169708efd93a4a68a` at the ownership check.
  The local parent is the source commit, not the later merge commit.
- Existing UI umbrella #483 is reused conceptually; no remote issue, branch or
  PR was created. The earlier materials inspection had no implementation branch.
- Product delta: nine CSS lines, one declaration on five explicit text targets.
- New native definitions are appended to the two existing bookshelf specs;
  every original byte and test identity is retained. No shared fixture/config
  changes, timeout changes or old assertion removals.

## Relevant verification

- Source regression on unchanged CSS: five missing-wrap failures, one retained
  editor/ellipsis contract pass. The first draft also had an incorrect selector
  in the unchanged-contract assertion; that test typo was corrected before the
  final red proof. Both logs are retained.
- Three related files / **13 source/component tests passed**.
- Fresh application TypeScript check passed; production build passed in 5.24s.
  Exactly one emitted grouped wrapping rule is verified in the built CSS.
- Installed Node/Vite/TypeScript/Vitest/Playwright identities and the successful
  physical npm inventory are bound in the evidence receipt. No dependency install.
- Native collection only: standard Chromium **29 → 36**, cross-project
  **44 → 54**, no missing or duplicate original identities. The cross definition
  set contains creation in desktop/mobile WebKit and detail in mobile WebKit;
  it is not a desktop Firefox or desktop WebKit detail execution claim.

New acceptance definitions cover creation at 1440×900, 1920×1080, 1280×600 and
long detail/editor text at those sizes plus 390×844. Each exercises 100%/200%
root text. Creation checks the unchanged frame, stationary footer, all expanded
fields and saved/reloaded name. Detail uses the loaded pixel font, full expected
values, horizontal text-fragment bounds, scrolling to controls, 24 contents rows,
keyboard save/cancel and persisted reopen/reload. Screenshots and geometry are
attached before containment assertions. The detail test allows vertical scrolling;
it does not claim all long content fits on one screen.

Root-text enlargement is not browser zoom. Fixed-pixel editor inputs can remain
16px; their actual font size and reachability are recorded rather than claimed
to double. The new cases use light theme. Raster ink, all dark/custom themes,
actual virtual keyboards and browser-specific timing remain outside new proof.

## Next gate

The new seven logical cases have **not run in a browser**. No after-image or
visual-fix claim is made. Authorized native execution must confirm wrapping and
control reachability, with the existing compact cases still admitted. If it
fails, diagnose product/cascade versus fixture/measurement before changing a
contract. Independent source/definition review is requested before any publication.

Evidence: `laplans-material-long-text-evidence-20261017` contains the exact patch,
red/green logs, font arithmetic, collection identities, emitted rule, toolchain
and protected-input hashes. No new material asset was generated or replaced.

## First native run and fixture correction — 2026-10-17

The approved bounded run `39057872767` checked application `d8ad9133`
(tree `03ff4c04`) through QA workflow `98a8a46f`. Standard Chromium completed
78 of 82 selected cases successfully. The four new long-detail cases all
stopped at the same expected-text assertion in the upcoming-plan tab: the old
fixture title was displayed instead of the intended long token. Their 200%
and editor Save/reload paths were not reached and remain unverified.

The fixture first opens the application, which migrates legacy plans into
the canonical schedule-event collection. Its subsequent long-text mutation
updated only the legacy plan. The actual repository correctly continued to
project the already-migrated record. This is a fixture-authority mismatch,
not evidence of a failed text-wrapping rule.

The correction updates the same owned, legacy-ID-matched canonical event's
title and plan subject/material name alongside the existing fixture changes.
It throws if that expected migrated plan is missing. No runtime code, CSS,
shared fixture, assertion, timeout, viewport, screenshot or test identity is
changed. The retained 720px/92dvh frame contract is unchanged.

A small source-level check executes the actual seed/mutation callbacks
extracted from this spec against the real local planner repository. The old
callback reproduced the stale title (one failure, two intentionally unselected
checks). The corrected callback passed all three checks: long text survives
fresh repository projection, unrelated records and the migration receipt are
preserved, and a missing owned target fails explicitly. These checks do not
replace native rendering. Evidence is in
`laplans-material-authority-fixture-evidence-20261017`.

Next: run the four corrected long-detail definitions in their existing
Chromium and mobile-WebKit projects, then inspect complete 100%/200% geometry,
editor actions and reload results. Earlier passes remain separately bound to
their execution source; this correction does not create a blanket new pass.

## Separate coarse-pointer text-size correction

The first cross-project run also had three mobile-WebKit creation-sheet
failures, distinct from the four mobile detail fixture failures. At all three
wide/short viewports, root text was 32px but input text remained 16px. Actual
images show enlarged labels/actions beside unchanged input/select text.
The global input-focus rule applies on narrow viewports or a coarse pointer
and fixes text controls to `16px !important`, overriding this sheet's `1rem`.
This is a pre-existing enlargement constraint exposed by the new acceptance,
not a font-loading failure or wrong viewport measurement.

The correction is limited to text-capable inputs and selects in the material
creation dialog's fields under that same media condition. It uses
`max(1rem, 16px) !important`: normal/reduced root text keeps the focus-zoom
floor; enlarged root text can reach 32px. The input selector repeats the global
six type exclusions and adds the local dialog/field prefix, so its specificity
actually wins. Checkbox, radio, range, color, file and hidden inputs are not
changed. The global policy, other editors, frame, interaction and all existing
native assertions remain unchanged.

One new source regression failed on the old rule, then eleven related style
checks passed. The exact CSS assertion checks matching exclusions, local scope,
media, importance and the floor/enlargement formula. This does not prove browser
rendering. QA maps both narrow standard and coarse-pointer creation consumers,
plus the eight corrected long-detail project cases, for bounded reacceptance.
Timer runtime/native inputs and previous timer image evidence are unaffected.

## Detail reachability measurement and independent scale scenarios

The correction run `39059512430` used application `cf4512af` / tree
`1b43714e`. All six selected creation cases passed on their first attempt,
including the three wide mobile-WebKit cases with input text enlarged to
32px. The eight detail cases passed the previously failing 100% activity-title
expectation, then stopped at a later reachability assertion or cumulative timeout.
They are not accepted yet.

The reachability helper treated every overflow ancestor as an ordinary box.
For the document root it combined a scroll-shifted bounding rectangle with
viewport-sized `clientHeight`. This is not the root overflow coordinate
system. A native 390px trace records root scrollTop 454 while the last editor
input is at viewport y385.047–431.047; the old source calculation incorrectly
limits that root clip to y390. The first diagnostics recorded only an empty
class name, so the new diagnostic also records each ancestor's tag, rectangle,
scroll offset and clipping frame. Only the document root uses a zero-origin
viewport frame. Body/editor clipping, viewport bounds, focus and trial-click
assertions are retained.

This follows [root overflow viewport propagation](https://drafts.csswg.org/css-overflow-3/#overflow-propagation)
and [root clientHeight](https://drafts.csswg.org/cssom-view/#dom-element-clientheight).
An extracted actual-callback probe reproduces the old false blocker and checks
the corrected calculation, including negatives for editor, body and viewport
clipping. It is a source-level probe, not new browser rendering.

The 1920px mobile trace completes the 100% editor save, reopen and cancel
sequence. Both attempts exhaust the shared 30-second budget during the later
200% activity-tab interaction. Trace timings show cumulative scrolling and
action-stability waits; screenshots alone do not explain the duration. The
two scales are now separate scenarios with the same timeout, viewport,
pointer actions, fixture and assertions. Each 200% scenario first measures
the actual loaded 100% font, then changes that same document to 200% and keeps
the greater-than-1.9 enlargement check. Both scales now finish with their own
save, reopen, cancel and page reload. The inter-scale restore write is no
longer needed.

The eight prior failed project-qualified identities have sixteen explicit
successors. Earlier clean creation/timer results remain historical input-bound
evidence. No product CSS, component, shared helper, configuration, timeout or
geometry threshold changes in this correction. Next: run those sixteen
successors and inspect the complete detail/editor/scroll/save results before
acceptance. Evidence: `laplans-material-detail-reachability-evidence-20261017`.

## 2026-10-17: remove duplicate action preparation in long-detail acceptance

- Exact preceding source: `0ce2b3c9` / tree `0e6524bf`; run `39060551709`.
  Chromium's eight split-scale cases passed on their first attempt. Mobile had
  four first-attempt passes, one flaky result and three cumulative 30s timeouts.
  All reported root-clipping false positives were resolved; this does not make
  the remaining timeouts acceptable.
- Seven retained failed traces show repeated explicit scroll preparation taking
  roughly 1–5.7s, in addition to the following normal trial-click checks. The
  wide mobile cases also spend time on navigation, tab clicks and editor reopen.
  Explicit PNG capture is only part of the total. Screencast metadata describes
  a DPR3 screen, but the actual encoded JPEG/video is 800px wide, not 5760px.
- Compared options: (1) a product scrolling/rendering defect, which would require
  specific motion/position evidence before changing CSS; (2) recording overhead,
  which needs a controlled comparison and is not established by image metadata;
  (3) duplicate test preparation. Choose (3) as the narrowest independently
  inspectable correction. A fresh native failure would falsify the claim that
  this change is sufficient; no speed or product-performance guarantee is made.
- The helper now focuses the real control and performs the same unforced trial
  click before measuring its final position. Playwright still checks stability,
  visibility, enabled state, scrolling and pointer hit-target reachability.
  All viewport, overflow-ancestor and focused-control assertions remain intact.
  Failed actions still attempt diagnostic attachment and rethrow the original
  failure, including when diagnostic capture itself fails.
- Product bytes, fixtures, test definitions, DPR, viewport, font, 30s timeout,
  retries, trace, video and explicit screenshots are unchanged. The change does
  not claim that a complete visible frame or actual pointer activation occurred
  where the test only used a trial click; Save/Cancel still use real Enter input.
- Local evidence: syntax/diff checks; nine source-extracted async sequencing and
  rejection probes; exact geometry callback/assertion and case-body comparison;
  1,768 runtime/support/build input hashes unchanged. The probe's initial empty
  cross-VM array comparison was corrected in the probe matcher only. A separate
  boundary script had an unused lambda syntax error and trailing-newline slice
  mismatch; both were corrected without changing the candidate assertions.
- Evidence: `/workspace/shared/laplans-material-control-actionability-evidence-20261017/`.
  New native execution remains required. No new application build is warranted
  by this test-only helper change; previous product build evidence remains tied
  to its recorded inputs. The editor's existing fixed input-text size at 200%
  remains a separate limitation, not an all-input text-resizing acceptance.

## Latest-main composition for the timer/material release

The release candidate `70a90774` was combined without conflicts with official
main `237500d9` (previous main `a39defd8`). The 24 external paths from #717/#718
are preserved exactly: planning reply-reference code/tests and its Worker
connection, plus five repository skill/document files. No external path was
rewritten to resolve this composition. Timer/material product, fixture, native
specification, font, shared modal/input style, bootstrap and Playwright settings
remain identical to the candidate.

The old 1,974-input native manifest is not wholly identical: eight existing
weekly-planning source/test inputs changed and five new source/test inputs were
added. Shared/Worker changes are also recorded separately. These functions serve
planning turns, and the new reply-reference calibration remains null; the tested
local timer/material journeys do not submit those turns. This is a source-based
consumer boundary, not new native execution on latest main.

Because the application imports changed, one fresh production build was run
with the existing lock and shared installation: pass, Vite 5.93s. A broader
2,101-input build manifest includes shared/Worker inputs, and all ten emitted
CSS assets remain byte-identical to the prior reviewed product build. No native
or typecheck was duplicated for this clean composition. The separate immutable
six-case run still belongs to its recorded `a2037ff1` source. Its result and the
source-bound carryover must be reviewed before publication/merge acceptance.

Evidence: `laplans-timer-material-latest-evidence-20261017`. Next: independent
composition review and the pending material-control native/visual acceptance.

## Separate detail/cancel and chapter-save acceptance contracts

The immutable six-case run on `a2037ff1` did not resolve wide mobile completion:
short-height Chromium and 390px mobile passed initially, while 1440px/100% was
flaky and the other three wide mobile cases timed out. Those outcomes remain
failed/flaky historical evidence. The helper sequencing change is retained for
its single actionability preparation, without a timing-improvement claim.

The new local candidate starts from `c2de23bc` (published `71365334` tree), with
latest-main composition preserved. It changes only this handoff and the final
material detail test family. The old 16 project-qualified definitions become
32 successors: four viewports × two text scales × two independent purposes ×
the existing Chromium/mobile-WebKit projects.

- A, detail/cancel: retain the six full-text fragment measurements, material
  title/subject/activity/current-chapter expectations, editor title and 24-item
  fixture. Retain the plan button's focus/trial/clip reachability. Edit chapter
  one without saving, activate Cancel with the same keyboard/focus/clip checks,
  require the complete stored preferences to equal the pre-edit value, and
  reload the actual App to verify the original first and last chapter values.
- B, save/reload: retain the editor title and 24-item fixture, last-field
  focus/trial/clip bounds, real fill, Save focus/trial/clip and keyboard
  activation, stored count/value assertions, immediate same-App editor reopening
  with the rendered saved value, and actual App reload followed by editor
  reopening and the same rendered last-chapter value.
- Both independently start at root 16px and, for 200%, change the same document
  to root 32px with the original >1.9 heading-font growth assertion. Viewport,
  DPR, loaded font, screenshots, reduced-motion, the 30-second per-test limit,
  retry/trace/video settings and all geometry helpers remain unchanged.

B retains both immediate same-document post-save reopening and the subsequent
persisted UI reopening after a real reload. These prove separate live-state and
durable-state boundaries; the first review draft incorrectly treated the latter
as sufficient and was corrected before acceptance. The uninterrupted combined
read→Save→reopen→Cancel→reload sequence is no longer the acceptance contract.
No prior bounds threshold or failure is suppressed. Plan action acceptance is
still focus/trial reachability, not a claim of plan creation.

Three explanations were considered: a production motion/scroll defect,
recording/rendering overhead, and cumulative work from independent user
contracts sharing one test deadline. Seven retained traces show completed
stable waits totaling 19.1–21.4 seconds, while snapshot collection is only
0.36–0.58 seconds. Most long stable waits have no unstable-position retry, and
some already occur in the normal initial fixture. This does not establish the
cause of slow rAF/layout responses or eliminate a product performance concern.
It supports separate, independently meaningful acceptance contracts without
changing product behavior or observability settings. Further native failure
would require renewed diagnosis rather than a timeout increase.

Source verification: one valid and eight negative contract-preservation probes;
unchanged helper/prior-spec prefix; relocated fixture/scaling, full-text,
editor-title, Save and reload blocks verified after whitespace/comment-only
normalization; all 2,101 recorded latest-build inputs byte-identical; syntax and
diff checks pass. The negative reload probe specifically removes B's final
actual reload, rather than an unrelated existing setup call. No browser, type
or application build was rerun locally. All 32 successors still require native
execution and rendered-image review. Evidence:
`laplans-material-detail-contracts-evidence-20261017`.


## Historical local-only PR #741 continuation after Timer release (2026-10-17)

The current public PR remains `fix/timer-material-readability` at
`5dfcb11f624c13775947e9fd2d14952b7e17ab3d` (tree `4870e76c`). This checkpoint
belongs to its local continuation `integration/pr741-material-main`; it is not
a replacement PR or a published update. The public head is preserved at local
`refs/backup/pr741-before-main-cleanup-20261017`, with its original patch and
tree inventory recorded before integration.

A normal two-parent merge integrates verified main
`8ccfa68089f62ebe0bdb7f1e62197a4fda6f6526` (tree `3f5c7a60`) into that PR
ancestry. Rebase was rejected because it rewrites published history; copying
material changes onto a fresh main branch was rejected because it drops the
existing PR ancestry. The latest main includes released Timer #754 and the
subsequent Browser sharding workflow. No external ref is changed.

The three merge conflicts are resolved explicitly: Timer's handoff and compact
native spec use the exact current-main versions, including the settled-motion
measurement guard; the shared index retains all main content plus its original
material link. All six dedicated material code/test files retain exact public
`5df` bytes. This handoff retains its complete original prefix. Every other
current-main blob, including external Bookshelf/motion owners and the new CI
selection workflow, is preserved. No diagnostic payload or temporary workflow
is added. The PR net diff is material-only: six code/test files, this handoff,
and the material index link.

The last material purpose run on immutable `5df` is still 28 first-attempt
passes, one flaky case and three wide-mobile timeouts across 32 cases. Native
frame-arrival delays were observed even without active motion. Two diagnostic
DPR orderings show a density-sensitive delay, but neither identifies a safe
production repair or proves completion of the long editor journey. Those
diagnostics do not lower the acceptance DPR, change timeouts, or convert the
failed/flaky cases to passes. No CI/browser rerun is authorized for this cleanup.
Historical results remain bound to their original source, not this composition.

Local verification: all 16 tests across the two material stylesheet contracts
and Detail/structure-editor boundaries passed. Both preserved native specs pass
syntax checks. One combined Vite build passed in 5.37 seconds; the emitted CSS
contains both the full-text wrapping and the local 16px-floor/1rem-growth rule.
The build used Node 24.19.0, npm 11.9.0, Vite 6.4.3 and the unchanged lock with
the already installed shared dependencies; no install occurred in this worktree.
The documented local DEV_LAN_HOST setting avoided LAN autodetection. Full tests,
types and native/CI execution were not repeated: app/Worker TypeScript and shared
configuration are exact main, while the material/native inputs are preserved.
Those scoped checks do not imply full verification or native acceptance.

Next: independent exact-input review of this local-only merge; keep PR #741
draft and obtain authorization before any external update. Evidence is recorded
in `laplans-material-main-cleanup-evidence-20261017`.
