# Compact learning report

## Native repair checkpoint — 2026-10-15 10:12 UTC

- Continue existing PR #686 / `fix/report-compact-readability`; no replacement branch or PR. Isolated detached worktree is based on local `33193ba17c4029a93e5938e1998d08a8d774211d`, the exact tree of published `99345ed2361de407809c4d329fa44007a0038956` (`fa611d3f848b09bb313eecc6978fcf04e087567f`).
- Initial Chromium run38714154205:747passed/2failed. Pixel320/390 enlarged-value cases failed identically on initial/retry. The current expected containment must not be relaxed.
- Actual artifact metrics show DotGothic16 text ranges35px high at24px font while line-height1.2 gives28.796875px lines, with4px top overshoot. The bundled font's hhea/Win envelope is1.448em. Normal12px ranges similarly exceed their14.39px line boxes. This is a production typography defect, not an unstable timing assertion.
- Repair scope: enlarge only the report numeric line box to cover the font envelope; keep shared intrinsic rows, fixed proportional plot, normal first-screen behavior and unchanged month layout. Preserve containment assertions and capture diagnostics before asserting. Review and relevant local tests precede a single authorized update by the writer. Corrected native rendering remains unverified.
- Minimal candidate: non-month line-height1.2→1.6 with font-metric rationale. At12px, the normal fixture's maximum two lines occupy38.4px inside the existing43.2px reservation. At200%, shared rows may grow; bars retain their equal explicit plot height. No clipping, padding workaround, timeout increase, or assertion relaxation.
- Native evidence now includes WebKit's identical initial/retry failures at both widths: text is3.1015625px above the area, compared with Chromium4px. WebKit's overall35-minute cancellation has no final JSON; its observed report6pass/2fail is not an overall run success.
- Added a source-level font-envelope regression: unmodified CSS fails1test, corrected CSS plus report/pixel/model tests passes28tests/4files. Fresh app types pass; production build passes5.49s. Chromium/mobile-WebKit collect8cases each with installed Playwright1.62.1; runtime CI1.64 remains pending.
- Independent actual-diff review found no blocking issue. Existing native containment assertions are unchanged; line-height-versus-glyph-height and successive-line non-overlap assertions were added, and original metrics/screenshots are saved before assertion failure. Exact corrected native execution and visual acceptance are still required before completion.

## Active readability follow-up — 2026-10-15

- Owner: `audit_report_single_screen`; integration/publication: `publish_approved_ui_fixes`.
- Local branch `fix/report-compact-readability`, fixed base `bf53bc24cd72f5ce1bca9b10bc966e4d26f5a484`.
- Preflight: existing umbrella #483 and latest comments, all open PRs, report-related closed/open PRs, all 163 remote branches checked. Original #664 is merged; no active overlapping report-layout work. #683/previous #678 concern aggregation boundaries, not this layout. No new remote Issue/PR or GitHub write.
- Original IMG_2503 and existing native screenshots show the primary overview now fits 320×667 and390×844. Two remaining readability defects are confirmed: the default material option is clipped at320px; the maximum weekly bar overlaps its value text.
- Scope: shorten only the default all-material label and reserve non-overlapping readable chart-value space inside the existing chart height. Keep disclosure, metrics, aggregation, filtering and accessibility semantics.
- Next: focused regressions, fresh app types, exact diff, and add narrow native assertions/screenshots to the existing report suite. Integration owner owns the combined CI/native run and visual acceptance. Do not claim these two defects fixed until final-content native evidence is inspected.
- Completion: readable default filter at320px, no label/bar or adjacent-label collision in day/week at320/390px, first-screen containment retained in both appearances, unchanged data/controls/disclosure behavior. Physical device verification remains unclaimed.

### Local candidate and independent review

- Default material option is now `全教材`; its stable filter value and individual material labels are unchanged.
- Value text and proportional bars use separate rows. Day/week share the outer grid rows through subgrid, so the tallest wrapped value grows every column together. The plot height remains equal, including zero days, with a32px minimum. Month layout is unchanged; values are12px at normal root size.
- Initial review caught the first candidate's fixed three-line value row overflowing at200% text. Replaced that fixed row with intrinsic growth and added dense100/200% day/week text-top, heading-separation, equal-scale, horizontal-fit, and normal first-screen assertions. Independent re-review found no blocking static issue in the corrected diff.
- Regression RED:2fail/22pass against unmodified source (old option label; missing plot separation). GREEN: ReportView7 + learningReport17 + pixel3 =27pass. Fresh non-incremental app types passed. Final CSS build passed in5.71s. The corrected CSS/native-only follow-up did not change the TypeScript inputs covered by the27tests/types.
- Native syntax and collection passed for8cases each in Chromium and mobile WebKit using the installed local Playwright1.62.1. The actual CI runner uses1.64.0; no native execution or post-fix screenshot acceptance is claimed. Existing source screenshots establish only the pre-fix defects and prior1-screen behavior.
- Reused dependencies at `/workspace/scratch/3b7e1f5c90f6/studyplanner-durable-ai-turns-20261014/node_modules`, Node24.19.0/Vitest3.2.7; lock SHA256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`. No install or dependency change by this task. Full verify, Worker checks, exact native/visual and publication remain with the integration owner and required user authorization.

## Ownership and scope
- UI request 15, existing umbrella #483. Implementation branch: `fix/compact-learning-report-20261014`; base `70953efd`.
- Existing PR #200 owns the original report and #559 the pixel-control paint. Open report PR search returned no overlapping active implementation. No new remote Issue/PR or GitHub write was made by this worker.
- Integration owner: `integrate_authorized_ui_fixes`. Publication owner remains `publish_approved_ui_fixes`.
- Reference IMG_2503.png was materialized from the supplied Library identity and visually inspected. Large cards and three stacked control rows push the chart below the first screen.

## Decision and implementation
Three options considered: smaller typography (rejected for readability), fewer summary metrics (rejected for information loss), compact layout with secondary details disclosed on request (selected).

All four totals and the selected-period trend/total remain outside the disclosure. Scope and material controls share a row. Plan supplements, full material/subject breakdown and existing insight move into one closed native details element. Keyboard activation uses browser-native summary behavior. Empty periods retain controls and planned-time details. Calculations, saved Actuals, home progress semantics and report helper source are unchanged.

Mobile uses two summary columns, desktop four. The chart height responds to viewport height. No fixed viewport clipping is introduced; long values and enlarged text can wrap and scroll. Normal and pixel modes share layout. Scope tab touch height increases to 44px; no font is reduced versus the old matching breakpoint.

## Focused verification
- `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/ReportView.test.tsx src/lib/learningReport.test.ts src/styles/appearance-pixel.test.ts`: 15 passed (2 structure/state, 10 calculations, 3 pixel paint), exit 0.
- `node --check tests/e2e/learning-report-surface.spec.mjs` and `git diff --check`: passed.
- Dependency directory: reused installed tree from `/workspace/shared/laplans-four-feature-integration-20261014/node_modules`; no installation/dependency changes.
- Initial unconfigured Vitest failed before collection because sandbox network-interface enumeration was unavailable. Explicit existing DEV_LAN_HOST configuration resolved startup; this was a tooling failure, not a test failure.
- A preceding exec transport disconnection returned no execution result; a clean worktree was verified after recovery before applying the patch. No uncertain write was blindly repeated.

## Remaining integration gates
Existing learning-report browser spec now exercises normal/pixel at 320×667, 390×844 and 1280×800; day/week/month chart and detail-toggle bounds above navigation; keyboard disclosure; 200% text enlargement and detail reachability. Existing report filter, summaries, back navigation and horizontal containment checks remain.

These native assertions are authored but unexecuted. Local browser startup/full verify were explicitly excluded for this implementation worker. Integration must run exact combined-tree full verification and the native spec, inspect attached viewport images, and resolve actual layout failures before describing the screen as visually verified or complete. Include this spec in mobile-WebKit selection if the existing matrix does not select it. Physical device/browser-UI safe-area validation is not claimed.
