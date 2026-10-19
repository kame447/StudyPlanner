# Event ingestion read load

Status: local implementation and full verification complete; no publication or production action
Owner: Issue #542; immutable event/actor/privacy contract remains Issue #213
Branch: `perf/observability-event-create-reads`
Base/HEAD before implementation: `819d5bac3791b0d0aac2a6b1fd977fe73256edf6`
Updated: 2026-10-13 UTC

## Scope and ownership

Current #542 comments establish that #546/#547/#560 are merged. Existing open PRs, remote branch names, #542 and #213 checkpoints were inspected before implementation. No active event-ingestion read-reduction branch/PR was found. This is a separate release unit from the old scheduled idle-read scope. Reuse #542; do not create another Issue. No remote write is authorized through this task.

The local scope is `productObservabilityStore`, its existing Firestore service-account client and boundary tests. The Todo admission owner retains `usePlannerDataState`; frozen #488 work, AI semantics, models, approval, planner data, Rules, credentials and deployment are untouched.

## Finding and alternatives

The store reads an event before immutable creation even when it does not exist. The REST client already performs atomic create (HTTP POST with documentId), compares a document after HTTP 409, and never overwrites an existing event. The store separately owns the replay comparison that ignores only id, observedAt and expireAt.

1. Keep pre-read: existing replay is cheap, but every new event performs an unnecessary missing-document GET.
2. Remove pre-read alone: new-event GET disappears, but a later replay performs two GETs because the lower comparison includes observedAt and the store reads the same collision again. Rejected as a replay regression.
3. Reuse only the exact collision snapshot: a typed Error from the existing 409 path retains its snapshot privately; the store applies its existing comparison without another GET. Non-409/unknown write failures still require a fresh read to reconcile response loss. This bounded design passed independent storage/security review.

A returned result would change the existing client success contract; an optional comparison callback would move the observability equality rule into generic storage. A payload-free Error/message with a private snapshot accessor preserves the existing void success and throwing conflict boundary with less caller coupling. No persistent cache or retry policy is introduced.

## Baseline verification

On unchanged base, an API-zero fixture called the real store and real REST client with all HTTP intercepted and only a synthetic demo-project path accepted. Four tests passed. Event GET counts were: new event 1; same event replay at a later ingestion time 1; changed payload at the same ID 1; committed write followed by 503 2; uncommitted 503 2. A direct lower 409 comparison performs one GET. Existing actor-directory GET is counted separately and is not removed.

These are measured mock HTTP calls, not production requests, billing reads, Rules reads, whole-app cost or speed improvement. No real Firestore, AI, credentials or paid service was accessed. The private raw fixture/log/count receipt is retained with the local task; production source is unchanged at the baseline checkpoint.

## Acceptance and next action

Implement and test create-first event persistence with private typed collision evidence. Verify new-event GET 1→0, successful replay GET remains 1, existing document bytes/first-ingestion retention stay unchanged, changed payload/owner conflicts reject, overlapping identical deliveries dedupe, and ambiguous write outcomes retain fresh reads. Preserve other immutable clients' Error/message behavior and ensure generic logging/serialization cannot expose retained payload.

Local acceptance criteria are verified below. Next: parent review of the local commit and a separately authorized publication path. Remote CI, production deployment and billing effects remain unverified; the inherited frontend bundle-budget failure remains a separate release constraint.

## Earlier focused-verification checkpoint

The candidate removes the event pre-read and preserves atomic immutable creation. The existing lower conflict path now throws an Error subclass with unchanged name/message and a private `#existingDocument` field. Only the explicit accessor returns the snapshot; JSON serialization, object spread, stringification, stack and generic inspection do not expose document payload. The store reuses this 409 evidence for its own unchanged replay comparison. Other write/read failures still use a fresh reconciliation read, including committed response loss.

- New regression red phase: 3 expected failures / 1 pass on unchanged runtime. Initial focused green: 33 tests / 3 files.
- Broader existing storage, ingestion, trace, admin, rollup/retention boundaries: 238 tests / 30 files passed, single worker.
- Independent review: 11/11 real-runtime fake-HTTP scenarios passed, with no blocking finding. It also checked a missing 409 snapshot, transient failure of the first conflict read, unchanged trace conflict messages, private error inspection and simultaneous first deliveries.
- Fresh non-incremental typecheck was attempted; its final process status was not recovered after a polling tool cancellation. Runtime types were generated and no TypeScript diagnostic appeared, but this is not a verified pass. Wrangler's default log-directory failure is environmental and will be avoided with its supported local log-path option on the next verification. No check/assertion was relaxed.
- At this checkpoint the changes were uncommitted and full verification had not started. The final result below supersedes that intermediate state; independent review alone was not treated as completion.

## Measured tradeoff

A small real-store/real-client mock-HTTP comparison replayed four ten-delivery sequences from exact base and candidate bundles. The source hashes and receipts are retained locally. The actor was already registered. Each delivery still reads the actor directory once; there is no cross-request identity cache. All stored event bytes, first-ingestion timestamps and expiry values were identical before/after in each scenario.

| Assumed new / replay deliveries | Event GET before → after | All HTTP before → after | Successful event creates | Candidate 409 create attempts |
| --- | --- | --- | --- | --- |
| 10 / 0 | 10 → 0 | 30 → 20 | 10 → 10 | 0 |
| 8 / 2 | 10 → 2 | 28 → 22 | 8 → 8 | 2 |
| 5 / 5 | 10 → 5 | 25 → 25 | 5 → 5 | 5 |
| 2 / 8 | 10 → 8 | 22 → 28 | 2 → 2 | 8 |

Replay GET remains one, but each replay now adds a failed create request before that read. Duplicate-heavy traffic can therefore use more HTTP subrequests and could have worse latency. The assumed replay fractions are not production observations; no production billing claim is made, including for failed conditional writes. Token acquisition, real Rules evaluation and transport latency are outside this fixture. The change targets first-delivery GETs and does not assert a universal cost or speed improvement.

## Final local verification

The repeated fresh app/Worker typecheck completed with exit 0 after setting Wrangler's supported log path inside the worktree. This supersedes only the unconfirmed typecheck status above; the original attempt and tool cancellation remain historical evidence. Node 24.19.0, TypeScript 5.9.3, Vitest 3.2.7 and Wrangler 4.147.0 were used. The existing lockfile is unchanged.

One exact-content `npm run verify` completed with natural exit 0: fresh non-incremental app/Worker types, 814 passing test files / 7,243 passing tests, 45 intentionally skipped tests / 1 todo, and production build in 4.91 seconds. Skips/todo are not passes. The command used one Vitest worker, disabled tool telemetry and a writable local log path. No real-service credentials were used.

All 2,369 tracked/untracked input hashes, 235 installed package entries, 101 optional absences and tool/Node identity matched before/after. No required package was missing. The frozen baseline diagnostic fixture was renamed from `.test.ts` to `.fixture.ts` after its recorded run so it could not join the normal suite. The two intended test files add 20 regressions. Subsequent edits are documentation-only.

The final production SHA-256 values match the independent review and mixed-traffic measurements:

- `productObservabilityStore.ts`: `9ca3c85f725bc90bc49182bf0a9c8514164ec8e41d8071fe73dc0c87e43961e1`
- `firestoreServiceAccountClient.ts`: `7a3c516591230f7e783e32560af06d759ef6cefadac6e01a9f84ad077b5bb851`

A separate existing bundle-budget check fails only aggregate JavaScript raw/gzip: 2,285.5 / 615.6 KiB versus the unchanged 2,211.9 / 595.7 KiB limits. To classify it, unchanged base `819d5bac` was built separately with the same installed dependencies and options. All 47 output files are byte-identical to this candidate, and the base fails the same two guards. This is an inherited release constraint, not new bundle growth. No threshold/assertion was changed. Browser, remote CI, real Firestore and production deployment were not performed by this task.

No remote Issue, branch or PR was created or changed; the existing #542/#213 ownership was reused. The local implementation branch is retained for parent review. No branch was deleted. Later public tracking and the existing production/Worker rollout questions belong in #542 rather than a status-only PR.
