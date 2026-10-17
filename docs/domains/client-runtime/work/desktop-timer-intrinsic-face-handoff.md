# Desktop ordinary-timer intrinsic face

Status: timer-only release candidate on current main. The narrow timer correction
has passed bounded native checks and image review. Final-base app type/build
checks passed; composition review and navigation-specific verification remain
release gates.

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

## Timer-only composition

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
retained timer native-release evidence. Original PNG/metric hashes are included.
This is observed raster acceptance for the recorded cases, not a universal
mathematical circular-ink guarantee. Vertical scrolling is permitted; initial
single-screen fit, dark tall timers, browser zoom, three-digit hours and tall
Pomodoro are not newly certified.

## Current-main boundary and remaining gates

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
