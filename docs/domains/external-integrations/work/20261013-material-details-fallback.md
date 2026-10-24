# Material details optional-enrichment fallback

Status: active, local implementation
Owning Issue: [#187](https://github.com/kame447/StudyPlanner/issues/187)
Branch: `fix/material-details-fallback`
Base / initial HEAD: `98f3c324b5320d38294905c858ce1d2310209312`
PR: none
Canonical contract: [material metadata](../spec/material-metadata.md)

## Ownership and scope

The implementation owner checked #187 comments, all open PRs, all 109 remote
branches and related closed PRs on 2026-10-13, with main re-read at 19:41 UTC.
No active owner covers optional NDL detail enrichment; #598 is already merged.
The parent selected this two-file local repair. Documentation independently
read the clean initial branch, relevant source and the API-zero baseline below.
Remote ownership findings are the implementation owner's evidence.

Runtime/test scope: `workers/ai-proxy/src/materialMetadataApi.ts` and its existing
`materialMetadataApi.test.ts`. Preserve already acquired search candidates when
optional SRU enrichment fails in transport, response-body reading or XML
conversion, matching the existing non-success HTTP fallback. Do not fabricate
edition/page-count/contents that were not obtained. No new provider, storage
schema, UI behavior or AI logic is introduced.

## Reproduction and acceptance

The same synthetic candidate on unchanged main returns HTTP 200 for successful
SRU enrichment and HTTP 503 fallback, then reaches cover enrichment. Network,
body-read and XML-conversion exceptions instead return HTTP 502 and never reach
cover enrichment. The API-zero baseline records all five paths.

- Preserve candidate identity and basic fields on optional detail failure;
  continue the existing cover/cache behavior without inventing detail data.
- Preserve successful enrichment and the no-ISBN/already-complete fast paths.
- Keep initial search failures, authentication/input rejection and cancellation
  boundaries separately tested; do not hide them with a route-wide catch.
- Verify source-level scope, focused regressions and final exact-content full
  checks. Browser/remote/provider acceptance remains a separate release gate.

## Verification checkpoint

The narrow enrichment boundary is implemented. URL validation stays outside
the fallback catch, AbortError is rethrown, and only optional detail failures
retain the candidate. The existing cover lookup and cache flow then continue.

- Old source with new regressions: 6 failed / 30 passed, exit 1.
- Corrected API plus service/catalog regressions: 51 tests in 3 files passed,
  exit 0 (36 API + 6 service + 9 catalog; not added to the red-run counts).
- `npm run typecheck:worker:full`: exit 0 with runtime types generated. The
  log separately contains a Wrangler log-directory ENOENT warning; it is not
  omitted from the evidence or presented as a clean log.
- A separate bundled-handler probe preserves the successful and non-success
  HTTP paths byte-for-byte. Network/body/XML failures now return candidate plus
  cover at HTTP 200. All probes use synthetic HTTP and zero provider calls.

Evidence is outside the repository in
`material-details-fallback-evidence-20261013/`: `baseline.json`, `fixed.json`,
`red.log`, `green-focused.log`, `worker-types.log` and `focused-receipt.json`.
Documentation read these outputs and checked both runtime/test hashes against
the focused receipt. The parent reviewed the narrow error boundary.

Next: one final full verification in the assigned slot, recording exact source,
installed dependency, generated-input and environment identities. No final
full, native browser, real provider or remote release acceptance is claimed.
PR publication, main merge and production API deployment remain unapproved.
