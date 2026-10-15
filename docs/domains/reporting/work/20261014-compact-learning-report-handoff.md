# Compact learning report

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
