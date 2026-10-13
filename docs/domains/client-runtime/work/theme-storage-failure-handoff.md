# Theme preference storage failures

Status: publication authorized; native browser acceptance pending
Updated: 2026-10-13

## Scope and ownership

- Related UI Issue: #483. The initial implementation was local-only. On 2026-10-13, the user approved PR publication and main integration after native browser verification; the integration owner coordinates merges.
- Branch: `fix/theme-storage-failure-20261013`.
- Base: `840e7aeb6dd962fdc51de43cc3ab54818b82b427`.
- Parent triage reviewed open Issues, PRs and 101 branches; no active owner of this storage failure fix was found. The palette registry and pending profile recovery changes remain separately owned.
- Scope: storage access must not unmount the app; failed reads use safe local defaults without overwriting unknown saved values; failed writes retain usable presentation and show an inline warning. Existing keys, valid values, palette variables and functional setters are preserved.
- Excluded: generic storage framework, dependencies, CSS, CI/infrastructure, Worker production API updates, deployment and production data.

## Evidence and decision

The actual current-main hook reproduced SecurityError during mode/palette reads and QuotaExceededError during mount/change writes with React 18.3.1 test renderer. Each error unmounted its root; the healthy control passed. The reproduction and result are retained in the sibling `theme-storage-triage-evidence-20261013` directory.

Considered: (1) contain storage failures in the hook while preserving immediate paint; (2) move persistence into custom setters and roll back unsuccessful selections, matching neighboring appearance/Home hooks but changing theme behavior; (3) add an application error boundary, replacing the screen while leaving the persistence fault unresolved. Option 1 is the narrowest fix.

Each preference now keeps its value and whether persistence is allowed by a successful initial read or explicit user choice. A read fallback is never automatically written, including when only the other preference changes. A same-value explicit choice can retry. Separate mode/palette save failures ensure an unrelated success cannot hide an outstanding failure. Read/save warnings use the existing settings inline-alert pattern, with the concise wording approved by the integration owner. The DOM is not treated as evidence of saved data.

## Exact local verification

Evidence is in the sibling `theme-storage-fix-evidence-20261013` directory, outside repository production inputs.

- Red: 9 new hook regressions failed on the base; 26 existing cases passed. Green: 35 hook cases passed; the broader hook/settings/palette/appearance/Home selection passed 99 tests.
- Independent static review: no actionable findings. An extra executable probe passed batched functional updates, stable setter identities and same-value retries under a StrictMode wrapper; it does not establish real-browser concurrent effect replay.
- Theme-only full `npm run verify`: exit 0; fresh non-incremental app/Worker checks and regenerated Worker runtime types; 844 passed files / 11 skipped files; 7,821 passed tests / 54 skipped / 1 todo; production build passed. All 2,439 tracked source inputs matched before/after manifests, and all 235 installed locked package versions were unchanged.
- The first full run was intentionally interrupted (exit 130) after typechecks when the integration owner shortened warning copy. It is not counted as a full pass. The final complete run used the final concise messages.
- No lint script is configured. Existing Vite mixed-import/chunk-size warnings remain visible in the logs.

Full-run command-scoped environment: `DEV_LAN_HOST=127.0.0.1 WRANGLER_HIDE_BANNER=true WRANGLER_SEND_METRICS=false CLOUDFLARE_CF_FETCH_ENABLED=false VITEST_MIN_FORKS=1 VITEST_MAX_FORKS=1 VITEST_MIN_THREADS=1 VITEST_MAX_THREADS=1`. Node 24.19.0, React/test renderer 18.3.1, TypeScript 5.9.3, Vitest 3.2.7; the 235-package installed dependency receipt records the complete identity. No package installation or lockfile change was needed.

### Profile recovery composition: distinct trees

The frozen profile/UI base is commit `b23f14cfe023984238c9ce9f9615b08dee3df102`, tree `9a60afbc9ae51964b29779bc0a8c1f6843b1e4b7`. Its profile recovery component and test are byte-identical to the pending profile recovery commit `16508fdd54f1a5a441e79b40a77d77a775f2cc24`; the original worktrees remain unchanged.

1. Exploratory composition: tree `25a7eb94a36fec17726cc5eeefea2f6f58db69aa`, with theme runtime/tests plus four temporary profile-storage probes. Seven selected files / 145 tests and fresh app typecheck passed. These four probes are not part of either implementation patch or the release candidate. Removing only the two pre-write guards in this exploratory copy made both unread-value tests fail on actual stored-value loss; the exact exploratory source was restored afterward.
2. Actual release candidate: frozen profile/UI base plus only the exact six-file theme patch, in a separate worktree. Verified tree before this final documentation update: `2ff2e05676df1d353e75bcdaf679a0ea3620aebb`. Full `npm run verify` exited 0: fresh app/Worker checks and runtime generation; 845 passed files / 11 skipped files; 7,849 passed tests / 54 skipped / 1 todo; production build passed. All 2,443 tracked inputs and 235 installed package versions matched their before/after manifests. The count excludes exploratory probes.

After those full runs, only this documentation checkpoint was updated. Final local commit/tree identities and the confirmation that every other tracked input is unchanged are recorded in the external verification receipt. No additional runtime, test, configuration, dependency or generated-input change is included.

## Remaining acceptance and handoff

The theme implementation and local integration checks are complete. Browser/visual acceptance is explicitly unverified because local browser sockets are known unavailable; no launch was repeated. Remote publication and native CI are now authorized; the implementation worker does not merge. Worker production deployment remains excluded. No branch is eligible for cleanup while this local candidate is active. Reuse this branch and Issue #483 context if publication is later approved; do not create a competing implementation.


## Publication checkpoint — 2026-10-13

Remote main was rechecked at `840e7aeb6dd962fdc51de43cc3ab54818b82b427`; AGENTS.md is unchanged. Issue #483 comments, open theme PRs and theme/storage branches were refreshed: no competing implementation was found. Reuse `fix/theme-storage-failure-20261013` and publish a draft PR after the final local verification; remote CI owns native browser execution because local browser sockets remain unavailable.

The production fix is unchanged from local commit `f71804c679407e9d5f584dd7211fd32ca499755a`. Added four targeted native tests using the real production app and its existing local-fixture startup path, with failures restricted to the two theme storage keys. They cover unread saved-value preservation, failures on initial/changed writes, independent warnings, same-value retries, reload and warning screenshots. The existing cross-browser suite includes these cases on Chromium, Firefox, desktop WebKit and mobile WebKit; no workflow or budget threshold changed. Until native CI succeeds, these tests are authored but not browser-verified. Fresh exact-content local verification and publication evidence are retained in the sibling `theme-storage-publication-evidence-20261013` directory. The earlier combined profile/theme snapshot remains available at `1a1631460f38eaeeee14e78125ee3d686d08951c`.
