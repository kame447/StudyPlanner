# Mobile WebKit paint and retry recording

Status: root-paint candidate under native integration verification; not merge-ready.

Branch: `fix/mobile-retry-recording`. Base: `82a948ae6dd9f39d6a445d3408b8b8d3ae2664a3`.
Scope: avoid the obscured root grid while retaining every visible pixel-grid gradient, plus the existing first-retry recording policy for the bookshelf-surface spec. Preserve original screenshots, assertions, timeout, viewport/DPR, retry count, workers and the fail-on-flaky gate.

Node prerequisite: copy only the `.node-version` 22.23.4 pin from unmerged PR #833 so automatic PR CI uses patched Node. This is not the remaining runtime guard or Undici remediation in #833, and does not authorize merging either PR.

Next: verify exact native pixels, repeated unchanged bookshelf/month acceptance and the unchanged bundle budgets on the final published candidate. An isolated pass does not establish normal-CI reliability or a fixed rendering cost.

## Root-paint continuation

Recording alone did not fix Issues #805/#776. The same-host capture ABAB run
`39759365546` timed out on all 12 first attempts, including capture-off arms.
The separate original-grid versus grid-none run `39828610723` showed a large
paint-cost difference, but its single fixed-order pair does not establish a
long-term flake rate. Grid removal was diagnostic, not an accepted visual change.
The subsequent finite/strip tile candidate failed exact fractional-geometry
RGBA comparison in run `39833530306` and is not adopted.

The new candidate leaves the original repeating gradients and their phase on
the body, shell and settings surfaces. It removes only the root grid behind the
opaque, viewport-filling body, preserving the root canvas color. The new native
pixel-grid-paint spec compares original/candidate/original-repeat RGBA in 128
combinations of 390/1920px, DPR 1.5/3, light/dark, 100/200% root text,
Home/settings, actual/fractional geometry and top/scrolled. Body opacity and
viewport coverage, loaded font and unchanged geometry are explicit admissions.
All comparisons require zero changed pixels; original acceptance remains intact.

Initial published candidate `135d5339f9d114291c2d1a826311958ec0cd6b12` has native
CI in progress. Its UI Quality run `39848525088` fails the unchanged budget at
CSS raw +41/gzip +3 bytes and JS total/largest gzip +16/+7 bytes. These are new
candidate violations, not baseline exceptions. A smaller root declaration has
eight focused tests, application and regenerated Worker typechecks, 613-case
mobile collection (including the original 31 bookshelf cases) and a successful
production build. Its unchanged checker still fails at CSS raw +3/gzip +5 and
JS total/largest gzip +7/+7 bytes; no threshold is changed. Native exact-pixel
and performance success are not yet claimed.

The month overnight observation admits standard appearance. The pixel-only
correction therefore cannot directly explain a month-case improvement; #776
remains a separate investigation even if an individual month run passes.

## Recording boundary and tradeoffs

The Matrix execution step enables the policy only for `webkit-mobile`, and only the bookshelf-surface spec consumes it. Local runs, other projects, other spec files, planner-recovery and the separate zero-retry stability job keep existing capture. First failures retain screenshots, error context and JSON, but trace/video are recorded only on the first retry; a passing retry still fails the existing flaky gate. Explicit screenshots remain unchanged. Manual targeted Matrix dispatches use the same scoped policy.

An isolated video-off/trace-off diagnostic passed the three previously failing 1920px cases in 26.983, 25.020 and 28.087 seconds. This motivates the bounded recording-policy change, not a claim of proven application speed or long-term reliability; the remaining margin is narrow and worker reuse confounds part of the comparison.

Implementation feedback: four focused source-contract tests passed on patched Node22.23.4. Independent exact-diff review confirmed capture-only spec changes. Normal native CI is still pending.

Runner compatibility: Playwright 1.64 rejects trace/video options inside a describe because they are worker-scoped. An initial collection check caught this before publication. The policy now uses supported file-level test.use; this spec has no retry-zero overrides. No custom fixture or worker framework was added.

Compatibility verification: the installed Playwright 1.64.0 runner collected all 485 WebKit mobile cases with CI opt-in enabled (exit 0, no collection errors), retaining one retry, 30,000ms timeout and failOnFlakyTests=true. The same opt-out collection had identical test identities (including all 31 bookshelf cases). Four updated source-contract tests passed. This is collection evidence, not browser execution.

## Historical recording-only local verification

Runtime-content HEAD `de81d0cfaa8d3368ae64cc08c16003821b160bda`, tree `6dea96e36868e091f9e44e4d7bbe66697b707850`: `npm run verify` exited 0 on official checksum-verified Node 22.23.4 / npm 10.9.9. Fresh application and regenerated Worker type checks passed; 1,061 test files and 11,118 tests passed (67 skipped, 1 todo); production build passed in 14.89 seconds. Log SHA256: `d6fafe6d3d2409d3d56e042ed64d523f1a3a87f26690be3bca5d6d4fac88bdee`.

Application dependencies were installed from unchanged main manifests using npm ci; isolated Playwright 1.64.0 installation did not mutate those manifests. The only node_modules file modified after the initial inventory was Vitest's generated `.vite` results cache; no package source changed. The generated historical-worker fixture is excluded. Local tests used synthetic data with provider telemetry disabled. Main's installed Undici 7.29.1 remains unpatched here; #833 owns its separate mitigation. Local verification does not replace native browser, Firestore, budget or production gates.
