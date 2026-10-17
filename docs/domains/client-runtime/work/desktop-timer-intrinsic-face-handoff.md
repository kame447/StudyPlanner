# Desktop ordinary-timer intrinsic face

Status: timer-only PR #754 is being integrated with main `393b7aa4` after its
Study/Report motion merge. The earlier bounded native results remain historical;
independent composition review found no source blocker. Fresh final-base native
acceptance remains pending; the material-detail release is separate and unaccepted.

## Recovered integration checkpoint, 2026-10-17 21:06 UTC

- The execution server disconnected at about 20:17 UTC. On its return at
  21:02 UTC, the prior `laplans-*` working trees and local evidence files were
  absent. This is an evidence-loss incident; missing review originals have not
  been recreated or claimed as recovered.
- A single fresh official checkout recovered published PR #754 source
  `ebc34e4f8d9a6737d1dac587e8688b88162f48ec`, tree
  `3abf01df53d10ad7512d0e87d0a9f53749a68987`. Its five changed paths were
  byte-identical on recovery. The merge with official main
  `393b7aa458a69463367f937a7e89c8561e61a380` (tree `9aa4edd5`) had no conflict.
- Main now calls ring settle on Start/Pause/Resume and content step motion on
  timer/settings/record changes. Timer CSS and the existing effect runner are
  unchanged, but these direct component changes invalidate unconditional reuse
  of the old final-base acceptance. All 30 new-main paths are preserved.
- The desktop geometry helper now waits for the ring's real animation to end
  before measurement and records zero active ring animations. This keeps its
  static-circle proof separate from the existing motion tests; it does not
  disable production motion or change the clock, timeouts, actions or bounds.
- A fresh lockfile install, four related test files (83 tests), non-incremental
  app typecheck, and production build passed on the recovered integration.
  Vite completed in 5.34s; 2,105 recorded build inputs were unchanged throughout.
  No full suite or browser was run locally.
- QA recovered the original native archives by verified GitHub artifact digest:
  six first-attempt passes belong to `ebc34e4f`; 49 belong to `d8ad9133`.
  They are historical results, not new-main executions. The new bounded plan is
  15 fresh cases: seven desktop geometry, four timer-motion, two No14 save/edit/
  reload, and two enlarged-settings focus/scroll cases. The other 46 identities
  are listed as historical carryover in the final selection receipt. QA collected
  the exact 15 definitions once (13 Chromium + 2 mobile WebKit), bound 1,990
  executable inputs, and found no duplicate identities. The seven desktop
  geometry cases cover standard/pixel appearance in light, not two themes.
- Independent review bound the five changed paths, all 30 external-main paths,
  2,895 protected main blobs and the build evidence with no source blocker.
- Next: publish the exact reviewed candidate through the sole authorized writer,
  run the bounded native selection and inspect new timer images before merge.
  Failures return to diagnosis; material work is excluded.

## Finding and correction

An earlier Chromium image at 1280×844 / 200% root text showed the ordinary clock
and inner background expanding beyond the fixed circular ring (artifact
12099425329, run39025722871, checkout676e9ebc). The timer inputs were unchanged
when the defect was investigated. This was an observed image defect, not a
failure of that older test's unrelated action-separation assertion.

Only ordinary timers at width ≥1024px and height ≥801px now let the ring use its
intrinsic content width. The previous size stays a minimum and available width
stays a maximum. Clock text stays on one line. Font size, timing, remaining-time
calculation, circle styling, and meaningful vertical scrolling are retained.
Planned and unplanned ordinary clocks share this selector. The ≤800px shallow
layout, narrower screens and Pomodoro rules are unchanged.

## Previous published timer-only composition (historical)

- Branch: `fix/desktop-timer-release`.
- Official base: `69991c17a25d12c80c736f9723cac6b62d0bc43e`, tree
  `49c67c15c9f7f4a582fb0d691384c6640d533632`; read back at 20:04 UTC on
  2026-10-17 and fetched by exact SHA from the official repository.
- Runtime CSS and source regression are exact accepted `f5e7010f` bytes.
- Native timer spec is exact accepted `c153199d` bytes. Its original 30-case
  body is preserved; the six original `a698419b` identities plus one planned
  case remain unchanged.
- Only these three executable files and this handoff/README link differ from
  current main. No material change, material fixture correction, or unmerged
  Study/Report motion PR #707 is included. Current main's changes are preserved.
- Publisher is the sole external writer. This release is separated from the
  still-unaccepted material-detail work.

## Accepted native and visual evidence

Application source `d8ad91330bdc55a918fd238758cc52511180bdd0`, tree
`03ff4c04b45697972c03bf6eb65f890533c99b8a`, was exercised in artifact12110805158.
The attachment revision `98a8a46f` identifies the QA workflow, not the app source.
The artifact's source record and input hashes bind the application separately.

- All **37 compact cases passed on their first attempt**, including all seven
  new desktop ordinary-clock cases. The combined run's four material failures
  do not become timer failures or a whole-run success.
- The six ordinary cases cover 1280×900, 1440×900 and 1920×1080, standard/pixel,
  100%/200% root text, before start and paused after the controlled browser clock advances the
  application timer by 3,661 seconds.
- The planned pixel case at 1440×900 covers ready, 61 elapsed seconds with
  `残り 00:58:59`, and 3,661 seconds with `残り 00:00:00`, each at both scales.
- All **30 geometry records and 30 PNG timer regions** were reviewed. Rings
  remained circular, inner faces respected the 8px ring padding, elapsed text
  stayed visible inside the face, and remaining badges did not overlap it.
  Ring diameter grew from 260px to about401–435px while enlarged fonts remained
  102.4px or112px. No font shrinkage or clipping was used.
- The native cases also require actual loaded fonts, one-line elapsed text,
  horizontal containment and keyboard-reachable Start/Resume/Finish controls.
  They do not claim that Finish saves; separate existing workflow tests cover
  persistence and reload.

The dedicated visual receipt is `native-visual-acceptance.json`, SHA256
`33e5db75dd4d69e92ab0eca2256dd2788e1b3fc986bc898ed8a3db728b116eb9`, in the
former timer native-release evidence. That local receipt is now missing; its
original hash is historical. Public native archives and PNG/metrics have been
recovered and independently rebound, without claiming that receipt was restored.
This is observed raster acceptance for the recorded cases, not a universal
mathematical circular-ink guarantee. Vertical scrolling is permitted; initial
single-screen fit, dark tall timers, browser zoom, three-digit hours and tall
Pomodoro are not newly certified.

## Previous #702-only main boundary (historical)

Main now includes #702 navigation motion and newer weekly-planning changes.
The current timer CSS, component, typography, font, native spec and configuration
match the accepted inputs. The #702 code changes the selected navigation circle;
the timer overlay and its direct Home start action do not contain or select that
circle. Its CSS delta targets navigation selectors, not the timer. This supports
carrying timer geometry evidence forward, but is not a claim that the whole app
is byte-identical. QA separately assesses shared navigation consumers and any
small fresh sentinel selection. Runtime review ran one fresh app type/build check for changed main dependencies
at 20:05:51–20:06:16 UTC on2026-10-17. Both exited0; Vite completed in5.05s.
The pre/post build-input check and raw logs are retained in
`laplans-timer-only-integration-checks-20261017`. No duplicate full suite was run.

Before release, bind the clean candidate/tree and all changed hashes, finish
independent composition review, and close
any navigation-specific gate identified by QA. Failed checks must be diagnosed
at the responsible layer rather than weakened or counted as success.

## Prior local/source verification

The new CSS regression first failed as expected (1 failed /2 passed); corrected
source passed5 tests across2 related style files and a fresh app type check.
Those identical inputs were not rerun solely to create this composition.
Fresh native-supplement source review at `c153199d` found no blocker. Its
separate receipt SHA256 is
`ff7152cee82987175fdd13d91b4f8b208d5043a9a812c532071ab362ff76e658`.
The dedicated intrinsic implementation review SHA256 is
`b438510af0b69e1a819297206ee111083bcdb1cbb75513d0ce5b5c0f92d36097`.

The older `a698419b` review file was overwritten during a later review and has
not been recovered. No restoration is claimed; the current release relies on
fresh dedicated review and actual native evidence instead.
