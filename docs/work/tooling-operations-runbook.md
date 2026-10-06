# Repository tooling operations runbook

Status: current repository-wide operational guide
Updated: 2026-10-05

This document stores durable operational knowledge about repository tooling, GitHub/CI integration failures, recurring tool limitations, and verified workarounds.

It is not a feature roadmap, an incident log, or a dump of transient errors. Add an entry only when the behavior is likely to recur, is costly to rediscover, or has a non-obvious safe workaround.

## How to use this runbook

Before repeatedly retrying a failing repository/GitHub/CI tool path:

1. Read `AGENTS.md`, especially the repeat-action guard and GitHub workflow policy.
2. Search this runbook for the failing operation/error signature.
3. Re-fetch mutable repository/PR/workflow state before acting.
4. Prefer the smallest verified workaround that preserves normal GitHub audit/history semantics.
5. After resolving a new recurring failure, add or update one entry here instead of leaving the knowledge only in chat or an old Issue comment.

## Entry format

Each durable entry should record:

- Operation / symptom
- Known error signature
- Root cause or strongest current explanation
- Safe workaround
- Required permissions / preconditions
- What not to do
- Verification / cleanup
- Last verified date

Do not record credentials, secret values, access tokens, private user data, or raw sensitive logs here.

---

## Cloudflare remote dev: Jev smoke transport failures

Verified on 2026-09-26 with Wrangler 4.140.0 and Worker compatibility date 2026-04-10.

The temporary preview upload succeeded, but direct Python HTTP readiness requests returned 403. Using Wrangler's returned `worker.fetch()` interface reached the preview and confirmed the Secret binding without reading its value. The precise source of the earlier 403 was not established; do not attribute it to the OpenRouter key or weaken production origin/auth guards. Use `scripts/jev-cloud-smoke.mjs`, which owns server startup, requests and cleanup through the same Wrangler instance.

The next failure was an immediate redirect-related TypeError from the Worker's outbound fetch, normalized by the adapter as `unavailable/network`. The configured runtime rejected `redirect: 'error'`. Use `redirect: 'manual'` and reject non-2xx responses without following Location. This preserves credential isolation; switching to automatic redirects is not an acceptable fix. Redirect regression tests cover 301/302/303/307/308.

Prerequisites are an existing authenticated Wrangler session and `OPENROUTER_API_KEY` registered as a Secret on the selected Worker. The optional smoke uses a short-lived authenticated remote dev script and a fixed synthetic authorization input; it does not publish production code or change routing. Never export the Secret or print raw provider responses, exception messages or headers. The harness stops the development server and removes temporary files on completion. Verify an actual validated decision and usage, not just preview upload HTTP 200; record gate abstention separately from successful transport. See README for the invocation.

## Wrangler production dry-run completes but the process does not exit

Verified on 2026-09-26 with Wrangler 4.140.0 (`npx --yes wrangler@4.140.0 deploy --dry-run --config workers/ai-proxy/wrangler.jsonc`).

Symptom: the output reaches `Total Upload`, the binding table and `--dry-run: exiting now.`, but the Node process stays alive with an open HTTPS connection to a Cloudflare address. The same run exited 0 about 40 minutes earlier on the same machine, and an older commit reproduced the hang afterwards, so it is environmental/post-exit network behaviour, not a code regression. `WRANGLER_SEND_METRICS=false` alone did not prevent it in this occurrence.

Workaround: bound the run (for example `perl -e 'alarm 240; exec @ARGV' npx ...`) and treat the build evidence as the complete output (upload size and expected bindings such as `JEV_MODE=off` / `JEV_CANARY_PERCENT=0`). Record that the exit code was not obtained; do not report it as exit 0. An alarm kills only the `npx` parent, so terminate leftover `wrangler deploy --dry-run` child processes afterwards. Confirm a regression suspicion by running the same command on the previous known-good commit in a temporary worktree before changing code.

## GitHub PR Ready-for-review transition can fail through the connector

Operation / symptom:

- A draft PR is otherwise merge-ready, but the connected GitHub `mark pull request ready for review` operation fails before the PR becomes Ready.

Known error signature observed on 2026-08-29:

- GraphQL response/schema incompatibility involving `Repository.fullDatabaseId`.

Important distinction:

- This is not known to be a normal GitHub PR limitation and should not be assumed to happen on every PR.
- It is a connector/integration failure mode that can recur when the connector's GraphQL response shape drifts from GitHub's current schema.
- Always try the normal Ready operation first. Use the fallback only after the failure is confirmed and the PR remains `draft=true`.

Verified fallback:

1. Confirm the exact target PR number, exact PR head SHA, and current main SHA.
2. Confirm the normal Ready mutation failed and re-fetch the PR to prove it is still draft.
3. Prefer an existing authenticated GitHub path if one is already available.
4. If no such path exists, a temporary one-shot GitHub Actions workflow may be used as a repository-local fallback.
5. The workflow must target only the intended PR and use the minimum practical permissions.
6. For the observed Ready mutation, `pull-requests: write` alone was insufficient. The successful one-shot workflow required both:
   - `pull-requests: write`
   - `contents: write`
7. Run the Ready transition with GitHub CLI/GraphQL from that workflow.
8. Re-fetch the PR and require `draft=false` before any merge attempt.
9. Delete the one-shot workflow immediately after it succeeds.
10. Verify the cleanup commit contains no unintended product changes before continuing.

Observed failed fallback:

- `pull-requests: write` with `contents: read` was insufficient for `markPullRequestReadyForReview` and the job failed.

What not to do:

- Do not create a replacement PR solely to escape Draft state.
- Do not merge by directly rewriting/updating `main` in a way that loses the PR merged audit trail.
- Do not leave the temporary elevated-permission workflow in the repository after the one-shot operation.
- Do not repeatedly call the same broken Ready mutation with identical conditions after the repeat-action guard is triggered.

Verification / cleanup:

- PR reports `draft=false`.
- exact head SHA is unchanged.
- temporary workflow is removed.
- current main/diff is re-fetched because concurrent merges may have happened while the fallback was running.
- normal merge gates are re-evaluated before squash/merge.

Last verified: 2026-08-29, PR #234.

---

## Post-merge integration checks can reveal failures that individual PR checks missed

Operation / symptom:

- Two independently green PRs merge close together, then a main-branch quality gate fails only after their combined changes are present.

Observed example on 2026-08-29:

- PR #221 and PR #234 each passed UI Quality independently.
- After both were on main, aggregate raw CSS exceeded the repository budget by about 2.5 KiB, while gzip, largest CSS asset, and all JavaScript budgets remained within limits.

Safe response:

1. Treat the main-branch failure as real integration evidence; do not dismiss it because both PRs were individually green.
2. Read the exact failed job logs and classify whether the failure is a production defect, stale contract/budget, harness issue, or infrastructure failure.
3. If the guard itself is stale, recalibrate only the specific stale threshold and preserve the other independent guards.
4. Put the repair through a focused PR and verify the exact head before merge.
5. Re-check post-merge main state when the failing gate is part of the repository's definition of done.

What not to do:

- Do not delete valid UI rules solely to satisfy a stale aggregate threshold.
- Do not broadly raise all bundle budgets when one metric alone is stale.
- Do not convert a post-merge failure into a success report without diagnosis and correction.

Last verified: 2026-08-29, PR #240.

---

## Test intelligence must preserve the application dependency baseline

- Last verified: 2026-10-03
- Symptom: coverage/mutation jobs pass manifest checks but run against different installed dependencies
- Evidence: Test Intelligence run `36275383359` coverage used Vitest 3.2.4 although its commit locked 3.2.7; adding the provider changed 116 packages. The mutation install pinned TypeScript 5.6.3 while the lock specified 5.9.3
- Cause: `--package-lock=false` ignores the existing lock during resolution, not only when writing. Manifest hashes alone do not describe the executed dependency graph
- Coverage procedure: obtain the Vitest version from `package-lock.json`, install the matching provider with `--no-save` while retaining lockfile reading, then check both manifests and the previously installed locked package versions
- Mutation procedure: `npm run test:mutation:weekly-planning` uses `scripts/ci/run-locked-mutation-tests.mjs`. Stryker is pinned; Vitest and TypeScript versions come from the application lock. All tools are explicitly installed into an empty temporary prefix, and the original application installation stays unchanged
- Security overrides must also reach the temporary mutation installation. The launcher writes the application's overrides into its private prefix manifest, then verifies the Tinypool package actually resolved from each Vitest installation, not just a hoisted copy. A missing, shadowed, external, or version-mismatched pool aborts before Stryker runs. The bounded Tinypool 2.1.2 override retains Vitest 3.2.7; keep its compatibility and remaining moderate advisory tracked in [Issue #477](https://github.com/kame447/StudyPlanner/issues/477) and [Issue #328](https://github.com/kame447/StudyPlanner/issues/328).
- Do not replace that prefix installation with bare `npm exec --package=...`: npm may omit a requested package already available in the application, leaving the isolated tool's peer dependency resolved to another version. This reproduced TypeScript 7.0.2 in the tool cache despite a requested/application version of 5.9.3, causing `ts.parseConfigFileTextToJson is not a function`
- Guard: `scripts/ci/locked-test-toolchain.mjs` records installed lock entries after `npm ci`, rejects an inconsistent/incomplete baseline, and rejects disappearance/version drift after adding tools. Optional packages for other platforms may be absent. The guard does not claim to audit every byte of newly installed tools or prove supply-chain safety
- Cleanup: the launcher removes only its own temporary tool directory, including on failure; project Stryker reports and failure evidence remain. Never delete reports to hide a failing run
- Discovery: normal Vitest excludes the root `.stryker-tmp/**` directory. Otherwise a later local run can execute copied tests from a Stryker sandbox a second time. This does not exclude the real test sources inside a Stryker run whose working directory is the sandbox
- Quality: line coverage is executed-code evidence, not proof that assertions detect faults. Read survivors/no-coverage cases, use deliberate fault injection and intermediate-state assertions, and distinguish source-string architecture checks, mock contracts, real browser behavior, real runtime integration, and paid model evaluation
- Compatibility: retain the Vitest/Stryker constraints in Issue #328. Do not change runner generations or lower mutation thresholds to get green
- References: [Issue #382](https://github.com/kame447/StudyPlanner/issues/382), [npm install documentation](https://docs.npmjs.com/cli/v11/commands/npm-install/)

## Maintenance rule for new tooling knowledge

Add a new entry when at least one of these is true:

- the same class of failure has happened more than once;
- rediscovering the workaround required significant investigation;
- the safe workaround is non-obvious or permission-sensitive;
- a tool reports misleading/incomplete state that can cause unsafe repository writes;
- an external integration has a stable limitation that changes how agents should operate.

Prefer updating an existing entry when the new evidence is the same failure class. Keep historical one-off noise in Issues/PRs/Actions rather than growing this file without bound.


## Worker tooling security and remote-evaluation version pins

- Updated: 2026-10-03; owning Issue #379
- Wrangler 4.140.0 contains undici 7.29.0 twice: a Miniflare dependency and an embedded CLI bundle. Overriding only the installed Miniflare dependency can clear npm audit while leaving the vulnerable embedded copy
- Pin Wrangler 4.143.1, the first published Wrangler release that updates both copies to undici 7.29.1: https://github.com/cloudflare/workers-sdk/releases/tag/wrangler@4.143.1
- Keep the five remote-evaluation launcher pins and current README command aligned with the exact package.json version. Unexpected PATH executables must still be rejected; do not replace the guard with an unrestricted range
- Verify clean installation, the installed transport and embedded CLI provenance, Worker type generation and strict checking, and a local deployment dry run. A dry run does not deploy
- Local tooling checks and an import check for unstable_dev do not establish remote-provider evaluation quality. No paid/live Jev evaluation or holdout consumption is implied by this update. Earlier 4.140.0 execution records remain historical evidence, not current launch instructions
- Do not lower the dependency audit threshold, omit dev dependencies, or disable certificate verification to hide a tooling vulnerability


## Temporary Firestore Node transport security pin

- Last verified: 2026-10-03; owner: [Issue #387](https://github.com/kame447/StudyPlanner/issues/387)
- Firebase 12.12.0 / Firestore 4.14.0 declares grpc-js ~1.9.0, which resolves an affected release for [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j). The advisory concerns specific gRPC server certificate-authorization use; no matching application authorization path was identified. This is not evidence of an intrusion or a universal reachability guarantee
- The temporary npm override is limited to Firestore 4.14.0 and exact grpc-js 1.13.6, an official patched release. It is outside the upstream ~1.9.0 range, so the real Node Firestore SDK + Auth/Firestore emulator regression is a compatibility gate. Browser builds or mocked tests alone do not establish compatibility
- The browser SDK uses WebChannel and the Worker uses REST; the Node emulator script exercises the gRPC client. Keep those verification boundaries distinct
- Remove the bridge when a reviewed Firebase release supplies a patched transport itself. A future Firestore version must not silently inherit an old forced pin; the ordinary CI high-severity audit detects a vulnerable replacement
- Keep audit thresholds and certificate/auth settings unchanged. The scheduled audit remains useful when new advisories appear without a source change; ordinary PR/main CI also audits dependency changes before merge


## Optional Wrangler update checks can interrupt offline verification

- Last verified: 2026-10-03 UTC; owner: [Issue #383](https://github.com/kame447/StudyPlanner/issues/383#issuecomment-5971926527)
- Symptom: `npm run verify` is interrupted by a network-policy block on `registry.npmjs.org` around Worker type generation, even though the application dependencies are already installed. One observed run had already written the runtime type file before interruption. Treat an interrupted run as incomplete, not as a test failure or a green verification
- Confirm the actual attempted endpoint and installed tool version before choosing a workaround. In inspected Wrangler 4.143.1, `printWranglerBanner` starts an optional npm latest-version check; suppressing telemetry alone does not suppress that check. Do not assume every type-generation/network failure has this cause
- For this verified signature, use Wrangler's existing `WRANGLER_HIDE_BANNER=true` command environment setting. In a POSIX shell: `WRANGLER_HIDE_BANNER=true npm run verify`. This returns before the banner's update check; it does not skip type generation, TypeScript checks, tests, build, dependency audit, or certificate validation. Re-check the behavior when upgrading Wrangler
- This workaround needs no new network permissions, credential, package installation, or repository configuration change. Do not request broader network access or disable TLS checks merely to obtain an optional update notice
- Runtime-type reuse is a separate mechanism: Wrangler validates an existing generated header against the installed workerd version, compatibility date and sorted compatibility flags. If reusing a generated file from another local worktree, verify those inputs, the complete relevant config and file bytes first; then run the normal generator/check command. Never fabricate a header or copy an unverified type file to force a cache hit. If inputs differ or confidence is missing, regenerate through an allowed path
- Do not reuse TypeScript's incremental compilation result as a final approval. `npm run verify` still performs fresh non-incremental app and Worker checks. Record the exact source tree, installed dependency identity, generated-input identity, command environment and exit result
- Verification evidence: the combined #391/#392 candidate tree `8b35b05986bb2df4ea1f9cc4652fd1dcc6ba6db0` completed fresh verification with the banner setting: 3,678 passed, 45 skipped, 3 todo, and production build passed. Earlier interrupted attempts were not counted as successes. This is an environment-specific reliability workaround, not a production speedup measurement or a reason to reduce required verification
- Cleanup: the example scopes the setting to one command; no repository/package/permission cleanup is required. Preserve failure and success logs. If setting it in a persistent shell/session instead, restore the previous value afterward

### npm's own optional update notifier

On 2026-10-05, verification for Issue #464 reached passing fresh app/Worker checks and 5,415 tests, then was interrupted at build startup by a blocked `registry.npmjs.org` request despite `WRANGLER_HIDE_BANNER=true`. The log also contained npm's own upgrade notices. Installed npm 11.9.0's `lib/cli/update-notifier.js` separately calls `pacote.manifest` unless `update-notifier` is disabled. An interrupted aggregate run is not green.

With already-installed, verified dependencies, rerun the normal aggregate command with command-scoped `npm_config_update_notifier=false npm_config_offline=true` in addition to the existing Wrangler settings. This omits optional npm update discovery; it does not install/update packages, grant network access, skip verification, or alter TLS. The retry completed fresh app/Worker checks, all 5,415 tests, production build and bundle budgets. Keep ordinary connected CI installs and security audits unchanged. Do not use this workaround to hide a missing required dependency or another network failure.


## Deferred JavaScript module receives the Pages HTML fallback

Verified on 2026-10-05 for Issue #443. A current entry/runtime can serve JavaScript correctly while a previous or absent hashed runtime path returns HTTP 200 `text/html` containing the SPA entry document. Safari may report `text/html is not a valid JavaScript MIME type`; the screenshot alone does not identify which URL failed. Compare the actual current entry/dependency paths and a known previous path, response content type and body before blaming the AI provider or changing deployment configuration.

An open tab retains its original module graph even when HTML uses `must-revalidate`. A code-only retry can recover a transient load failure but cannot restore a deleted URL. Do not inject a newly discovered runtime into an old graph: the runtime can import the entry module and duplicate application roots/singletons. Do not use unconditional reload or automatic AI/OCR replay. The supported bounded, user-initiated recovery and its input/storage limits are owned by the [current weekly-planning contract](../domains/weekly-planning/architecture/current-contract-v5.md#ai-runtime-module-recovery). A page already running an older release still needs an explicit refresh; preserve its unsaved input first.

Keep JavaScript load/link failures distinct from cached evaluation failures. References: [Vite load-error handling](https://v6.vite.dev/guide/build#load-error-handling), [Cloudflare Pages serving/SPA fallback](https://developers.cloudflare.com/pages/configuration/serving-pages/), [dynamic import caching](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import). Immutable deployment-pinned assets are a separate deployment design requiring access/CORS/CSP/retention validation, not an unverified quick fix.


## Negated GitHub closing references and stale completion metadata

- Verified on 2026-10-05: Issue #437 was automatically closed at PR #454 merge despite prose saying it was outside scope. The body contained a negated closing-keyword reference. GitHub issue-closing syntax must not be treated as natural-language negation-aware
- Put the intentional closing reference on its own line. Use `Related unfinished work: #437` for excluded work; do not put a closing keyword immediately before an excluded issue number, even with “not”
- After merge, re-read related Issue states rather than infer them from prose. Reopen accidentally closed unfinished work and record the correction; verify other related Issues too. #437 was reopened and #164 remained open
- Update completion metadata by replacing obsolete current-status/checkpoint text, not merely prefixing “complete” above an unchanged “not adopted/pending” statement. Preserve failed-run history explicitly as history, with final head/tree and successful post-main evidence separated
- No workflow, permission, branch or history rewrite is required. Use ordinary Issue/PR metadata actions only. Reference: https://github.com/kame447/StudyPlanner/issues/437#issuecomment-5985007509


## Wrangler image dependency audit (sharp / librsvg)

Verified 2026-10-06 for Issue #497. A newly published audit entry can fail an unchanged lock: GHSA-wq5f-xc86-pv6w affects sharp before 0.35.5. The current development chain is Wrangler 4.143.1 → Miniflare 5.20260926.1-alpha → sharp. The narrow override pins sharp 0.35.5 for that exact Miniflare parent; official prebuilt binaries report librsvg 2.63.2. Keep optional platform packages in the lock. Do not accept npm audit's suggested Wrangler downgrade or relax the high threshold.

Run `node scripts/ci/worker-image-toolchain.mjs` after a clean install. It resolves Sharp from the actual Miniflare location, checks native versions, decodes benign SVG, resizes/transcodes PNG/JPEG/WebP, exercises local Miniflare Images info/transform/output and rejects malformed data. No remote binding or production configuration is used. Miniflare 5 requires its exported `convertV4MiniflareOptions` adapter for the older options shape; its bundled README alone is not sufficient evidence of the installed constructor contract.

This override protects the repository-installed toolchain, not an independently downloaded `npm exec --package=wrangler` installation. Existing remote JEV launchers' external toolchain path is not exercised or certified by this fix. Prefer the verified lockfile installation; any separately installed toolchain needs its own dependency validation before use. The production app/Worker has no Images binding or direct Sharp import; this does not establish exploitation or guarantee every external toolchain is patched. Existing moderate Vitest advisories remain separately tracked.
