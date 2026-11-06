# Name-ordered Firestore page transport

Status: local candidate verified; independent review and integration gates pending.
Base: `a4c441baace2e96cec7eded05a6e29120257955c`
Branch: `refactor/firestore-name-page-transport`

The two Firestore client methods for ordinary rows and versioned snapshots repeat
the same name-ordered query, cursor/page-size policy and HTTP failure handling.
Share only that transport block in a private same-class method. Keep the public
signatures and their distinct result conversion unchanged: ordinary rows flatten
fields, while snapshots require update time and preserve fields under `value`.

This is a bounded duplicate-contract reduction, not a production bug fix. Retain
the separate methods rather than introduce a generic query framework or combine
their response policies. Authentication, write preconditions, caller behavior,
retry behavior and Firestore codec semantics are outside scope.

Fresh open-PR paths and targeted Issue/branch searches found no matching work.
The concurrent AI-analysis projection does not change this client. Existing
consumer context remains Issue #213; the completed campaign #356 is not reopened.

## Local verification

- Ten public-method characterizations passed on the unchanged implementation,
  then passed unchanged after the extraction.
- Client, AdminAnalysis, UserEnrichmentBackfill, AccountDeletion and scheduled
  subrequest-budget checks passed: 12 files, 101 tests.
- An offline comparison of both real client implementations passed 528 paired
  cases / 1,056 calls. It compares exact request bytes, token/observer/fetch order,
  cursor and bounded limits, response projections, update-time presence, original
  failure identity, HTTP cancellation and input immutability. Every network and
  token operation is stubbed; this is not live Firestore verification.
- Inlining the new helper at both call sites reconstructs the complete original
  module exactly. The distinct decode blocks did not change.
- Fresh Worker runtime generation and non-incremental Worker typecheck passed.
- The new test file also passed a strict targeted typecheck; the normal Worker
  production typecheck excludes test files.
- Runtime identity: Node 24.22.1, TypeScript 5.9.3, Vitest 5.0.5, Vite 6.4.4,
  Wrangler 4.151.0. Existing installed dependencies were reused without changes.

The source delta is 12 added / 23 removed lines. This modest consolidation removes
a second owner of the wire-page contract; it is not a new abstraction layer or a
claimed production defect fix. No public signature, response contract, retry or
write behavior changes. JavaScript stack traces and microtask depth are not a
compared public contract.

Next: independent review and the integration owner's exact-content full verify
and applicable native CI before publication. No full verify, native CI, live
Firestore call, push, merge or deployment is claimed by these local results.
