# Firestore wire codec responsibility boundary

Status: local implementation; not published or deployed
Date: 2026-10-20
Branch: `refactor/worker-boundary-validation-local`
Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`

## Intent and boundary

AGENTS.md requires separation by responsibility/change reason and small stable
facades. The Worker Firestore client previously owned both transport/token
lifecycle and pure recursive wire-value conversion. Move only the value codec
into `workers/ai-proxy/src/firestoreValueCodec.ts`; keep all callers on the
existing `FirestoreServiceAccountClient` facade. This is a provider-specific
internal adapter, not a new generic repository abstraction or domain model.

Alternatives considered: extracting duplicated query projections would remove
less duplication but leave the mixed conversion/transport responsibilities;
consolidating authentication is outside this task's security scope. The codec
move provides a directly testable pure boundary without changing requests.

## Preserved compatibility

The wire interface, timestamp-name set and four conversion function bodies are
byte-identical after removing only export keywords. Every remaining client byte
is unchanged except the new import. Undefined object fields are still omitted,
undefined array items become null, nonfinite numbers become null, integer values
remain strings, and only valid `expireAt`/`registeredAt` string fields use the
existing timestamp representation. Nested maps retain that rule; array strings
do not inherit a field name. Malformed and multi-tag decode behavior remains
unchanged, including unknown values returning null and invalid integers NaN.
This patch deliberately adds no stricter validation or data migration.

No token, credential, security, request/retry, permissions, AI semantic/prompt,
quota, deployment or dependency code is changed. No external API was called by
the tests. Existing open PRs and Firestore-related issues were checked; no
competing codec extraction was found. Related domain owners #187/#213/#542
retain their existing scope; this change does not claim those issues resolved.

## Verification checkpoint

- Focused Vitest: 6 files / 33 tests pass (five existing client suites plus six
  new codec compatibility cases). Command: `node node_modules/vitest/vitest.mjs
  run --config vite.config.mjs workers/ai-proxy/src/firestoreValueCodec.test.ts
  workers/ai-proxy/src/firestoreServiceAccountClient --maxWorkers=1`.
- Exact extraction-body and remaining-client byte comparison: pass.
- `git diff --check`: pass.
- Node 24.19.0; existing shared local dependency installation: Vitest 3.2.7,
  TypeScript 5.9.3, Vite 6.4.3. No dependency installation/update performed.
- Full `npm run verify` passed on commit `9175c3ca89b1d7b1118086e2b26a6fdaea29314e`:
  fresh app/Worker typechecks; 1,055 test files and 10,534 tests passed, with
  existing 12 skipped files / 67 skipped tests / one todo; production build
  passed in 14.99 seconds. Wrangler 4.151.0. The historical fixture commit
  `070d25cbe14796aebb8168ac5425c93e3506df1c` was fetched for the existing archive
  contract test, without changing that test or the candidate.
- Independent review confirmed exact extraction bodies, unchanged transport
  and sole production importer (the existing client).

Local implementation, independent review and full verification are complete. No browser
or remote execution is required to characterize this pure move. Publication,
main merge and deployment are not part of this local-only deliverable.
