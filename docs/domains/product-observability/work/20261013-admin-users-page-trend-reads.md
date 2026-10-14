# Admin Users page-only trend reads

Status: locally implemented and full-verified; unpublished
Owning Issue: [#542](https://github.com/kame447/StudyPlanner/issues/542); contract owner: [#213](https://github.com/kame447/StudyPlanner/issues/213)
Branch: `perf/admin-users-page-trend-reads`
Base / initial HEAD: `98f3c324b5320d38294905c858ce1d2310209312`
PR: none

## Ownership and scope

The additional Users page is appended without replacing the screen's initial
trend. The current client discards that response field, but the Worker still
requests the 30-day trend. This task adds an explicit page-only request path,
while retaining initial-load, refresh and mixed-version behavior.

The implementation owner checked current main, all comments on #542/#213,
14 open non-Dependabot PRs and all 109 remote branches on 2026-10-13
19:38–19:42 UTC. No active owner covers this Worker trend reduction. The
[earlier client-only pagination change](20261013-admin-users-pagination-reads.md)
is already integrated through #607 and explicitly leaves these Worker reads.
The parent assigned this bounded local implementation. Documentation checked
the initial branch/HEAD and current service/API call sites; remote ownership
checks are the implementation owner's evidence, not an independent rerun.

Runtime ownership is limited to `src/services/adminObservabilityService.ts`,
`workers/ai-proxy/src/productObservabilityAdminApi.ts` and
`workers/ai-proxy/src/productObservabilityAdminAnalysisService.ts`.
Tests use the existing client page and Worker subrequest-budget suites, plus
the analysis-service suite if needed. Planner recovery, AI, Rules, CI workflow,
metric meanings and general Users UI behavior are outside this change.

## Acceptance

- Initial load and refresh retain the existing trend; old clients without the
  new option keep the current response. New clients still work with old Workers.
- Additional pages preserve users, cursor and enrichment readiness while
  removing the unused trend request. Measure 32 trend keys to zero and one fewer
  REST request on identical synthetic fixtures, rather than infer savings.
- Preserve empty/legacy/readiness behavior, authorization denial, invalid
  cursor handling and trend-failure behavior at the applicable boundary.
- Focused tests, independent review and exact-content final verification must
  identify the tested snapshot. Remote/browser/release gates are separate.

## Current evidence and next action

The red-to-green comparison on the same bounded fixtures was read back from
the original logs:
old source 9 failed / 64 passed; corrected source 73 passed. Synthetic HTTP
through the real Worker, read model and Firestore REST client measures:

| Additional-page case | HTTP before → after | Trend document keys before → after |
| --- | --- | --- |
| Ready | 8 → 7 | 32 → 0 |
| Before migration readiness | 42 → 41 | 32 → 0 |
| Empty | 6 → 5 | 32 → 0 |

The owner verified identical remaining HTTP inputs. These are requested-key
and HTTP measurements, not production Firestore billing. Documentation read the original service/API source, paired assertions and raw
red/green/focused logs. The expanded related suite passes 162 tests in 11 files;
the earlier 73 are included, not added again.

Runtime scope remains the three files above. Existing real-component
pagination tests additionally exercise the new response shape. Review findings
are tracked by the parent separately from the test counts below.

Final `npm run verify` on the recorded dirty snapshot exited 0: fresh app and
Worker types, regenerated runtime types, 7,976 tests / 854 files passed and
production build 5.04s. Keep 54 skipped tests / 11 skipped files / 1 TODO
separate. All 2,474 source and 19,329 installed-file identities match before
and after. Exact command/environment, hashes and logs are recorded in the
ignored `artifacts/admin-page-trend-reads/receipt.json`; documentation checked
the source hashes, six log hashes and equal before/after manifests.

This final checkpoint text is a docs-only update after verification. Next:
commit the bounded change and hand the frozen tree to the next integration
owner. Native browser, remote CI, separate bundle checks, production Worker
deployment, actual request frequency and billing remain unverified. No main
merge or remote publication is authorized for this task.
