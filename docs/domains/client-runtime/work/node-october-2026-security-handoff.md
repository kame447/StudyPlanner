# October 2026 Node.js security runtime update

Status: local implementation; publication and deployment are not implied.
Branch: `fix/node-security-october-2026`.
Base: `9847d64a46f3f9e6c04440a0564ddb603ce15382`.

## Finding and decision

The repository selected Node 22.23.0. The [official October 21 advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) identifies patched releases 22.23.4, 24.22.1 and 26.12.1. Three conversation workflows independently selected the broad `22` range, which could select an older runner-cached patch even after the canonical file changed.

Options considered:

1. Change `.node-version` only: smallest diff, but falsified by the three bypassing workflows.
2. Keep major-only selectors and enable `check-latest`: may obtain a patched release, but leaves separate selection rules and a non-reproducible floor.
3. Keep the current major and select the exact patched canonical version everywhere: chosen. The existing setup action can use a cache only when that exact version is present. This changes no application or dependency behavior beyond the runtime patch.

`.node-version` now selects 22.23.4; every setup-node step uses that file. The source-reading regression covers every workflow. A dependency-free actual-runtime checker rejects pre-patch, unsupported-major and prerelease versions; `verify` executes it before checks and `prebuild` rejects an old actual Node runtime before Vite (including a stale Pages dashboard override). `engines` states the same supported release lines, but is advisory under default npm settings, not an install-time security barrier. Developers must select a patched runtime and run the checker before installing dependencies. Historical verification records remain unchanged.

## Scope and limits

- This is Node tooling/runtime remediation, not a claim that a particular exploit reached application code or that intrusion occurred.
- The checker does not update already running Node processes, managed runner action runtimes, user machines, or a Cloudflare dashboard `NODE_VERSION` override.
- Cloudflare Pages must resolve the patched pin without an overriding stale setting; production build logs require independent verification after authorized publication.
- Cloudflare Workers use workerd, not the selected Node binary. A repository Node pin is not proof of a patched Worker host.
- No major migration, dependency update, security restriction relaxation, main write, merge, or deployment is part of this local change.

## Final local verification

Verified code HEAD: `4f15be4ab1a3f9a47c8ed10375326dd623468d5e`, tree `57789ce6dee732e231feeb8206f7acc698dc30b8`. Only this documentation receipt changes afterward.

- Initial source regression: 4 failures (old canonical pin and three bypasses), 16 passes.
- Final focused Node/workflow/verification-contract tests: 53 passed across 3 files.
- Actual existing cloud Node 24.19.0: checker and `npm run build` both exit 1 with the upgrade instruction; the latter stops in prebuild, before Vite.
- Official isolated Node 22.23.4 Linux x64 / npm 10.9.9: archive SHA-256 `1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce` matches the official checksum manifest; binary SHA-256 `94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90`. Global managed runtime unchanged.
- Fresh `npm ci` succeeded, installing 242 packages. Lockfile SHA-256 `6f7ff47e56d96e1e2d845898360a2d17439bf452974fa88423f0d901120e3ffd`. `npm ls --all --json` before/after SHA-256 `27417217621c28a906cc600db407d8aa639383a0949c27f414eda2537d4bab6d` is identical. Only root engines metadata changed in the lockfile; no dependency versions changed.
- Final `npm run verify`: exit 0. Fresh non-incremental app and Worker type checks; 11,120 tests passed, 67 skipped, 1 todo; 1,060 files passed, 12 skipped. Test duration 96.90 seconds; production build 15.27 seconds. Runtime check executed both before verification and before build. Log SHA-256 `9a36a6e9294984cfc137fcc5bac222d08288018398ae88739d09a3417bca71ae`.
- Existing bundle-budget check: exit 0; no limits or application sources changed.
- `git diff --check`: pass. Test-generated `.cache/j1-old-worker` is an untracked historical fixture, not part of the change. Two earlier full runs were intentionally cancelled before final verification to add the independently identified prebuild gate and align the existing exact-command regression; they are not counted as passes.

Native GitHub CI, Pages runtime selection, embedded GitHub action runtimes and user-machine runtime updates remain unverified. The separate dependency-security investigation is not covered by this Node-only proof. Next: authorized publication and exact-head native verification, followed by the separately authorized operational runtime updates/read-back. A local branch change alone does not close the security task.
