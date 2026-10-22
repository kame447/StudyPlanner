# Mobile retry-only recording

Status: local verification complete; normal native CI acceptance pending.

Branch: `fix/mobile-retry-recording`. Base: `82a948ae6dd9f39d6a445d3408b8b8d3ae2664a3`.
Scope: defer automatic video and trace capture to the first retry only in the bookshelf-surface spec when the normal CI mobile WebKit matrix explicitly opts in. Preserve local and other-project recording, screenshots, assertions, timeout, viewport/DPR, retry count, workers and the fail-on-flaky gate.

Node prerequisite: copy only the `.node-version` 22.23.4 pin from unmerged PR #833 so automatic PR CI uses patched Node. This is not the remaining runtime guard or Undici remediation in #833, and does not authorize merging either PR.

Next: publish the authorized separate PR after final review and follow all normal CI gates to terminal. An isolated diagnostic pass does not establish normal-CI reliability or a fixed application rendering cost.

## Recording boundary and tradeoffs

The Matrix execution step enables the policy only for `webkit-mobile`, and only the bookshelf-surface spec consumes it. Local runs, other projects, other spec files, planner-recovery and the separate zero-retry stability job keep existing capture. First failures retain screenshots, error context and JSON, but trace/video are recorded only on the first retry; a passing retry still fails the existing flaky gate. Explicit screenshots remain unchanged. Manual targeted Matrix dispatches use the same scoped policy.

An isolated video-off/trace-off diagnostic passed the three previously failing 1920px cases in 26.983, 25.020 and 28.087 seconds. This motivates the bounded recording-policy change, not a claim of proven application speed or long-term reliability; the remaining margin is narrow and worker reuse confounds part of the comparison.

Implementation feedback: four focused source-contract tests passed on patched Node22.23.4. Independent exact-diff review confirmed capture-only spec changes. Normal native CI is still pending.

Runner compatibility: Playwright 1.64 rejects trace/video options inside a describe because they are worker-scoped. An initial collection check caught this before publication. The policy now uses supported file-level test.use; this spec has no retry-zero overrides. No custom fixture or worker framework was added.

Compatibility verification: the installed Playwright 1.64.0 runner collected all 485 WebKit mobile cases with CI opt-in enabled (exit 0, no collection errors), retaining one retry, 30,000ms timeout and failOnFlakyTests=true. The same opt-out collection had identical test identities (including all 31 bookshelf cases). Four updated source-contract tests passed. This is collection evidence, not browser execution.

## Fresh final local verification

Runtime-content HEAD `de81d0cfaa8d3368ae64cc08c16003821b160bda`, tree `6dea96e36868e091f9e44e4d7bbe66697b707850`: `npm run verify` exited 0 on official checksum-verified Node 22.23.4 / npm 10.9.9. Fresh application and regenerated Worker type checks passed; 1,061 test files and 11,118 tests passed (67 skipped, 1 todo); production build passed in 14.89 seconds. Log SHA256: `d6fafe6d3d2409d3d56e042ed64d523f1a3a87f26690be3bca5d6d4fac88bdee`.

Application dependencies were installed from unchanged main manifests using npm ci; isolated Playwright 1.64.0 installation did not mutate those manifests. The only node_modules file modified after the initial inventory was Vitest's generated `.vite` results cache; no package source changed. The generated historical-worker fixture is excluded. Local tests used synthetic data with provider telemetry disabled. Main's installed Undici 7.29.1 remains unpatched here; #833 owns its separate mitigation. Local verification does not replace native browser, Firestore, budget or production gates.
