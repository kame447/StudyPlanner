# Passive pre-Splash delivery timing

Status: final stacked local verification passed; publication authorized, native CI pending.
Owner: Issue #542; the broader installed-PWA cause remains unproven.
Branch: `diagnostics/startup-delivery-timing`.
Base / initial HEAD: main `84b69b9b6a0810071e530509c5230fcc4a81d6bf`.

## Scope and ownership

Extend the existing explicitly enabled, administrator-authorized startup panel
with passive Navigation/Resource Timing. No extra request, Firestore operation,
external telemetry, persistence, account data or displayed/retained URLs. Preserve
the required five-second video, ready-only user skip and every readiness gate.
The concurrent inquiry navigation change owns App/root/public navigation and is
disjoint from this instrumentation. No new Issue/PR or remote branch existed at the original local checkpoint. This existing local branch remains the sole implementation owner.
Existing #479 is closed; #542 remains the investigation owner. The existing
startup diagnostic publication PR is merged and has no active replacement in
this scope (Issue comments, PRs and branches checked before implementation).

## Decision and falsifiers

1. Change caching or split startup assets: the static delivery audit found a
   substantial initial graph, but neither establishes its contribution on the
   user's device. An early Splash with a late profile/intro gate would falsify
   that priority; such runtime changes have a much broader blast radius.
2. Add early inline scripts or observers: could give new marks before React but
   changes HTML/startup scheduling and introduces another lifetime. Existing
   browser entries already preserve delivery boundaries; unsupported entries
   are a reason to report unknown, not to invent fallback timing.
3. Read buffered standard entries only inside the existing authorized panel:
   selected. Map the current six built initial JS/CSS assets to fixed roles,
   discard URLs, and compare response completion to the existing Splash effect.
   Missing/ambiguous entries make that inference unavailable. The residual is
   unobserved evaluation/scheduling/rendering and other work, never measured CPU.

## Local completion criteria

The bounded privacy projection/panel, focused timing/privacy/access regressions,
fresh typechecks/full unit suite/production build, exact diff and build mapping
checks are complete for this isolated candidate; evidence is recorded below.
No local native-browser retry: the existing environment blocker is established.
Native-browser/layout and installed-device performance remain unverified until
an authorized supported environment is available. The original local-only authorization ended at this deliverable; the later
publication/main authorization and acceptance steps are recorded below.

## Final local verification (2026-10-13 UTC)

- Implemented the passive numeric/fixed-role projection and authorized panel child.
  The existing phase recorder, role checks, root/App, media, styles, read gates,
  auth subscriptions and Firestore behavior are unchanged.
- Focused final: 110 tests / 8 files passed, including privacy/unavailable/duplicate
  entries, no side effects, no read without opt-in or administrator permission,
  account replacement/revocation, and existing root/video/readiness behavior.
- Final `npm run verify`: exit 0; fresh non-incremental app and Worker typechecks,
  7,908 passed / 54 skipped / 1 todo, 848 passed / 11 skipped test files; production
  build 5.30 seconds. Skips/todo are not successes. Node 24.19.0, Vitest 3.2.7,
  max2/min1 forks, existing runner and timeouts unchanged.
- Worker generation used the official validated cache: full config/lock and
  installed workerd 1.20261001.1/Wrangler identity plus complete generated-file
  bytes matched the verified main-equivalent source first. Fresh compilation is
  separate from that generated-input reuse.
- Final before/after fingerprints match for 2,451 tracked/untracked source inputs,
  19,294 installed dependency files and generated Worker types. Dependencies were
  copied into this worktree before final verification; no package/lock changes.
- Actual built HTML independently confirms exactly the six initial JS/CSS roles.
  CSS bytes and initial vendor chunks are unchanged. No extra initial resource
  request is introduced; the existing entry script includes the projection/UI.
- The separate bundle gate still fails the four known baseline limits (aggregate
  raw/gzip JS and total/largest raw CSS). Limits are unchanged; this is not an
  all-gates pass. Same Node/zlib level-9 comparison against the clean verified
  main-equivalent build: JS +3,630 raw / +1,366 aggregate gzip bytes; largest
  entry +3,630 raw / +1,389 gzip. All CSS metrics are identical.
- Parent's independent runtime review found no obvious blocker; it specifically
  reviewed maximum response completion rather than summed overlapping requests,
  inferred labeling, duplicates, zero bytes, URL exclusion and administrator
  lifetime. Native browser/layout and installed-device measurements were not run:
  the established local native-browser blocker was not retried.

Two initial test-harness defects were corrected before the successful final run:
a mechanical assertion incorrectly forbade the permitted development panel from
reading timing, and a Vitest table passed arrays as positional tuples rather than
one navigation-entry collection. Fresh typechecking caught the latter. Assertions
were corrected to the existing access/unknown-data contract, not weakened to hide
production failures. The final focused/full run includes both corrections.

## Original local acceptance boundary

The local change is ready for review, not a deployed fix or proven speedup. No
remote push/PR/main change/merge or branch cleanup was performed. Publication,
exact-head native browser/CI and actual matched PWA/Safari samples remain separate
approval/acceptance steps under #542. The new brief-white-flash report has a
separate source-backed pre-React canvas candidate and is not folded into this
instrumentation commit.

## Publication preparation (2026-10-13)

The user approved PR publication, browser verification and main integration of
this administrator-only measurement addition. The existing branch and Issue #542
remain owners. The release sequence is inquiry navigation, initial dark canvas,
partial schedule-query reads, Home add motion, then this diagnostic change.
Integrate the final Home candidate once available and run one full verification
on that final combined content; do not recycle the original 7,908-test result as
proof of the later combination. The coordinating release owner handles merges.

Browser coverage is extended in the existing `startup-diagnostics.spec.mjs`,
already selected by Chromium and mobile WebKit, without a runner/workflow change:

- Ordinary production Support/query/reload cases also require zero navigation or
  resource timing reads while the panel is unauthorized.
- The existing development startup harness loads six inert same-origin JS/CSS
  fixtures with the current production role names. Actual browser navigation and
  resource entries are compared to the real rendered diagnostic panel at 390 and
  1280 pixels; a missing role remains unknown.
- A loaded query-bearing lookalike and private synthetic navigation marker must
  not appear in the panel. The panel remains within the viewport, has no delivery
  section horizontal overflow, and supplies screenshots for review.

The inert resources are synthetic browser API/format/privacy coverage, not a
production asset benchmark or actual installed-PWA comparison. Existing access
unit regressions still verify administrator verdict, owner replacement and
revocation; the development harness does not claim to authenticate an admin.
Syntax/diff checks and 38 focused tests passed after adding this spec. Collection
finds 6 Chromium and 6 mobile-WebKit cases using privately copied Playwright
1.62.1; this is collection only, not execution under CI Playwright 1.64.0. Native
CI, artifact inspection and final stacked verification are pending; no local native
browser retry is attempted.


## Final stack local verification

The verified Home predecessor `530b2779c8097a9f20d49c88fcae8cdf51f735e7`
(tree `4cabe52c2eab04eecb6e71b5b0cae51e9b40a981`) was merged normally into
this branch. It includes inquiry navigation, the initial canvas including the
reviewed Firefox inline-video-attribute test correction, partial schedule-query
reads, and the final Home interaction/focus changes. There were no merge conflicts.
Only this diagnostic change is intended as the final PR's distinct release unit.

The actual source-policy audit and its injected-input negative control passed.
The one fresh combined `npm run verify` passed on local
`65f8b57c995c0be1c02d7032b2a62f84131afa5f` / tree
`17c23d412f49783c19a8996027642a1ac9355cce`: 854 passed / 11 skipped files,
7,956 passed / 54 skipped tests / 1 todo, fresh app/Worker typechecks and build
5.59 seconds. All 2,472 source inputs, 19,294 installed runtime-dependency files
and generated Worker types matched before/after. Node 24.19.0, Vitest 3.2.7 and
max2/min1 forks; no configured lint script. Generated types used the validated
official cache separately from fresh compilation.

Published Home predecessor `c4581a72387e5506125a018b768f2f3334c0ed3b`
was fetched read-only and has exactly the same source tree as local `530b2779`.
The build still declares the six measured initial roles. Relative to that Home
build, JS grows 3,630 raw / 1,190 level-9 gzip bytes; CSS is identical. Four
existing budget violations remain with unchanged limits: JS total raw/gzip and
CSS total/largest raw. Candidate totals are JS 2,370,528 raw / 640,021 gzip and
CSS 494,367 raw / 83,986 gzip; largest CSS is 426,389 raw.

Only this verification checkpoint is updated after that full run; runtime,
unit tests, native spec, configuration, dependencies and generated inputs remain
unchanged. This is not an all-gates pass or actual PWA performance evidence.
After publication, native CI must run on the exact cumulative merge tree and the
three new delivery timing screenshots/observations must be inspected. The draft
may briefly target main to admit the existing branch-filtered workflows, then be
retargeted to the Home predecessor after tested-tree verification. No workflow
change or premature merge is part of that admission sequence.


### Reviewed native-only predecessor correction

Home's follow-up `e2b26973a0475094159e996dff5519a1fb12c2a6` was merged
normally. Remote predecessor `b0f062ff565ebb52688e8ed65615dfd124efdc38`
was fetched read-only and matches its tree `8c28f837146876225e607a5fd746846e4a937435`.
The delta from the prior Home parent is only its checkpoint and 13 lines of the
existing app-settings native spec: Escape now asserts the intended QuickEntry
dismissal/focus/retained-row contract, then reopens to preserve button-close
coverage. No production, unit, type, config, dependency or generated input differs
from the successful combined full snapshot. This native-only correction is
validated by syntax/collection and the new exact-tree native CI, rather than
rerunning the identical unit/build inputs. Browser execution is still pending
for this diagnostic candidate.
