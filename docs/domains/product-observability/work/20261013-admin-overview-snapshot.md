# Admin Overview snapshot request consolidation

Status: verified local candidate; publication not authorized
Owning issues: #542 (read load), #213 (observability contract)
Branch: `perf/admin-overview-snapshot`
Base: `372fd242e67d6676675004e973e7256495293154`
PR: none

## Scope and decision

Overview reads daily rollups, active-user window and checkpoint with one batch and two GETs. Users trend already batch-loads those same keys. Reuse the existing private snapshot-reading responsibility for both callers, retaining standalone daily/checkpoint consumers, registration COUNT readiness, date limits, validation and response shapes. No cache, dependency, schema, authorization, AI, UI or deployment change.

Alternatives: leaving the calls separate has no benefit; a shared long-lived cache adds freshness and invalidation policy. The existing bounded cross-collection batch is the smallest independently verifiable change. A consumer requiring independent snapshot timing or any response/authorization regression would falsify this choice.

## Ownership preflight

GitHub main was read through the commit endpoint at 2026-10-13 08:49 UTC. All 19 open PR changed-file lists and 99 branch names were checked, plus current #542/#213 checkpoints. No active owner for this scope was found. Historical #310/#313 are already merged. The parent owns concurrent UI release work and later main integration; this local branch remains pinned to the base above.

## Verified behavior

- The existing Users trend batch-reading responsibility is now a private helper shared with Overview. Both public response shapes and the standalone daily/checkpoint readers are unchanged.
- Real service + REST client, with all HTTP intercepted locally, passed 114 before/after cases at 7/30/93 days: 63 successful responses and 51 fail-closed cases. Successful response JSON bytes, requested document-key multisets and registration COUNT queries match. Fixtures cover populated, missing day/window/checkpoint/all, reversed results, dirty/current/other-environment/out-of-window/duplicate revisions, incomplete registration, malformed values, incomplete batches and backend failures.
- Overview uses one snapshot batch for 9/32/95 document keys instead of a daily batch and two GETs. Ready registration still uses three COUNTs: storage HTTP 6→4; cold authenticated route 9→7. Incomplete registration retains two COUNTs and unknown new registrations: storage HTTP 5→3. Users trend remains one batch; the ready Users route remains eight requests.
- Individual window/checkpoint transport failures now identify the batch operation internally rather than GET. Both still produce the same public sanitized HTTP 503; two route tests cover this. A missing document is represented by a batch `missing` entry, while a failed batch HTTP 404 remains an error.
- Document keys and COUNT query shapes are unchanged. This is HTTP request consolidation, not an established reduction in billable Firestore document reads, production latency or billing.

## Verification evidence

- Final focused run: seven files, 113 tests passed.
- Final `npm run verify`: exit 0; fresh non-incremental app and Worker checks, 7,727 tests passed / 54 skipped / one todo, and production build in 5.54 seconds. Skips/todo are not counted as passes. No lint script is configured.
- Full verification compared all 2,413 source/config/document inputs and 19,329 installed dependency entries before/after; all were identical. Dependencies are an independent local copy, byte-identical to their source, not a shared writable symlink. Generated Worker runtime types were unchanged during final verification; all 47 build output files were hashed.
- Verified service SHA-256: `4e5444b771f2dc10918ef982f29bdcf61e4c937010e0c884b874c8519d3e2a36`. The before/after probe captured and verified every transitive source hash; only this service differs from the base.
- Before/after probes and successful test runs used a fail-closed network guard. No production credentials, Firestore traffic or writes were used. Command-scoped existing LAN-host, offline npm and Wrangler options avoid optional host discovery/update/metadata work without changing repository configuration.
- An initial test startup hit sandbox network-interface discovery; setting the existing `DEV_LAN_HOST` option allowed the unchanged tests to run. The initial aggregate run then exposed only two stale Overview request-count assertions in the token-sharing test (expected nine, measured seven). Only those counts changed; OAuth and Identity Toolkit count assertions are retained. The failed intermediate run and the final passing run are both preserved in local evidence.

The latest main was rechecked through the GitHub commit endpoint during 2026-10-13 09:05:47–09:06:12 UTC: `cf725d088ab1249fe1da6fe7d40e6b9274fa61e4`. Its changes from this branch's base do not touch Worker/shared sources, dependencies or verification configuration. All 18 remaining open PR file lists have no scope overlap. The parent owns later release integration.

Next: independent final review, then obtain publication authorization. CI, production Worker deployment and live authenticated Admin behavior have not been verified for this candidate. No publish, merge or deploy is authorized.

## Local integration checkpoint — 2026-10-13

- A separate, explicitly requested verification snapshot applies the complete original seven-file patch to main `840e7aeb6dd962fdc51de43cc3ab54818b82b427`, tree `cf6115b513a21e929b5917d195c4bea2a5ef74f7` (PRs #611 and #612 included).
- Local-only branch: `test/admin-overview-main840-integration`. Original branch `perf/admin-overview-snapshot` and its commit `8e08ab0c9a51ff8ad300008245695ae41168d8fd` remain untouched. No new Issue or PR, remote write, merge or deployment.
- The original patch applies without conflict. All seven patched files were byte-identical to the original before adding this checkpoint; none changed between the original base and this integration base. No new feature or profile-recovery patch is included.
- Dependencies are an independent local copy. The existing generated runtime type file is eligible for Wrangler's supported cache because the complete config, workerd binary/version, Wrangler generator and generated bytes match the original verified provenance. Cache reuse is distinct from fresh Worker runtime-type compilation; final non-incremental TypeScript checks still run normally.
- Focused verification passed all 113 tests across seven files. The offline real-service/REST-client comparison passed 114 cases (63 successful responses and 51 fail-closed cases); response bytes, requested document keys and COUNT query shapes remain identical. All eight transitive probe sources on current main match the original baseline, and the integrated candidate matches the original candidate sources and bundle bytes. No external requests.
- Final `npm run verify` exited 0: fresh non-incremental app and Worker TypeScript checks; 844 test files / 7,840 tests passed, 11 files / 54 tests skipped, one todo; production build 5.13 seconds. Skips and todo are not passes; no lint script is configured. The build retains the large-chunk warning.
- All 2,439 source/config/document inputs and 19,329 installed dependency entries matched before and after the full run. All 47 build output files were hashed. The generated runtime-type file remained unchanged; Wrangler explicitly logged supported cache reuse. This does not claim fresh workerd type compilation.
- HTTP calls are 9→7 for cold authenticated Overview, with the same 9/32/95 requested document keys and registration COUNT query shapes. This does not establish lower billed Firestore document reads, production latency or billing.
- Local evidence: `admin-overview-main840-integration/receipt.json` and its manifests/logs in the shared evidence directory. Only this checkpoint changed after the successful full run; runtime/test/configuration/dependency identities were rechecked unchanged.
- Next: obtain publication authorization, then perform independent review and remote checks for the exact published candidate. No CI run, production Worker compilation/deployment or live authenticated Admin verification is claimed for this snapshot. Keep the original and integration branches until the parent resolves publication; no branch was deleted.
