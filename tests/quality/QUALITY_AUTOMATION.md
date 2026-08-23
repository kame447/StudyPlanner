# Quality Automation

StudyPlanner keeps broad functional E2E coverage separate from focused quality signals. A quality layer is retained only when it detects a materially different failure class or makes external diagnosis cheaper.

## Always-on pull-request gates

- `Browser Regression`: the existing broad Chromium E2E contract suite.
- `UI Regression Matrix`: approved screenshot regression plus a narrow Chromium/Firefox/WebKit compatibility smoke.
- `UI Quality Automation / browser-quality`: axe serious+critical violations, horizontal containment at 360/390/768/1024/1440 px, and uncaught page/console/same-origin network failures.
- `UI Quality Automation / bundle-budget`: deterministic raw/gzip JavaScript and CSS budgets.

Lighthouse is intentionally not a normal pull-request gate. Hosted-runner performance variance and warning-only thresholds make it lower signal than the deterministic bundle gate, so Lighthouse is weekly or manual. The repeated cross-browser stability probe is also weekly or manual; repeating every browser check on every PR would mostly multiply runtime and flaky exposure.

`Test Intelligence` remains a slower weekly/manual layer. Coverage is observational rather than a merge threshold. Mutation testing stays targeted to the existing weekly-planning semantic core instead of expanding across UI code. Dependency audit fails at high severity or above. These checks are not duplicated across normal application PRs unless their own infrastructure is being changed.

All Playwright layers emit machine-readable JSON in CI. The QA result workflow publishes stable per-workflow PR comments containing run/job metadata, while detailed traces, screenshots, videos, HTML reports, and JSON remain in artifacts. `tests/quality/qa-manifest.json` is the machine-readable index of commands, cadence, blocking behavior, and artifact contracts.

Repository-owner commands are available on same-repository PRs. `/qa e2e` runs the existing broad Chromium E2E; `/qa visual`, `/qa cross-browser`, `/qa quality`, `/qa a11y`, `/qa responsive`, `/qa runtime`, and `/qa bundle` run focused normal gates. `/qa performance` and `/qa stability` request lower-frequency observations. `/qa coverage`, `/qa mutation`, `/qa audit`, and `/qa deep` request Test Intelligence. `/qa all` runs broad E2E plus normal UI regression/quality automation; `/qa status` reports the latest workflow state.

The comment dispatcher does not checkout or execute PR code. It only validates the repository owner and same-repository PR origin, then dispatches an existing workflow on that PR branch. GitHub requires comment-dispatch, workflow-run summary, schedule, and dispatch definitions to exist on the default branch; those definitions are now on `main`, so the control and result plane is active.

## Deliberately deferred or rejected here

This QA layer does not add more browser/device matrices, Percy/Chromatic, BrowserStack/Sauce, DAST scanners, duplicate SAST scanners, load testing, or broad mutation testing. Their current overlap, runtime, maintenance cost, or false-positive risk is greater than their expected additional signal.

Firestore Security Rules emulator tests and Firebase repository integration tests remain high-value follow-up work, but they are outside this QA scope because they introduce a different backend/security test boundary. CodeQL/default code scanning, dependency review, and GitHub Actions linting are also follow-up repository-hardening work rather than reasons to expand this QA layer further.

Dependabot remains weekly for root npm dependencies and GitHub Actions, with minor/patch grouping to limit PR noise.
