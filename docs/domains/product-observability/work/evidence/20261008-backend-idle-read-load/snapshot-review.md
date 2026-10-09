# Independent snapshot early-return review

Reviewed 2026-10-08 UTC. No blocking regression found in the narrow snapshot candidate. This is independent local source/mock validation, not production or full integration approval.

- Worktree: `<BACKEND_WORKTREE>`
- Base HEAD: `22847120386987329e2f034d6062d59694ef1180`
- Reviewed runtime: `workers/ai-proxy/src/productObservabilityActiveUserSnapshot.ts`
- Runtime SHA-256: `aeb492f16c5995a74358b8f26609cae2338ce3e14b80533dd4977f502a077770`
- Existing owner evidence inspected: `<MEASUREMENT_OUTPUT>/snapshot-green.log` reports 31 tests / 4 files passed, including 16 snapshot tests. Existing scheduled/REST comparison confirms steady idle 67 to 3 requested document keys, with 3 HTTP requests unchanged; clean bootstrap adds one HTTP request; dirty maximum remains 44. These are mocked counts, not billing measurements.

## Safety reasoning

The new branch runs only when no dirty sources were supplied. It parses the actual job and requires `idle` plus an existing current-day snapshot. Its return contains no completed source, so `traceWorker` cannot acknowledge/clear a dirty revision on this path. The later revision-aware checkpoint clear remains unchanged.

Any scanning job, missing current-day snapshot, or supplied dirty source reaches the existing full 66-key state read. An inconclusive two-key probe is not reused or joined with later accumulator reads. Before mutation, the full 66-key state is still re-read within the transaction and compared against the complete initial full read. Concurrent control changes cannot cause publication from a composite probe/full snapshot.

A job or dirty revision arriving after an idle read may wait for the next scheduled invocation. The early-return branch neither erases nor advances it. Date is captured once per invocation; the next invocation detects the next Tokyo reporting day. Existing malformed-job validation remains in effect. The real REST client rejects incomplete batch-get responses instead of treating omitted keys as nonexistent.

## Additional independent checks

Executed `audit-snapshot-races.mjs` against the exact candidate, using only the existing memory fixture and real runtime module. Global fetch was replaced with a throwing function; no external requests or repository writes occurred.

1. Existing current-day snapshot plus unfinished source-less bootstrap: scanning resumes and publishes the expected count. Read sets `[2,66,66]`; one remaining actor-date page.
2. Inconclusive probe followed by newly created scanning job/current snapshot: the fresh full read sees and completes the new job. Read sets `[2,66,66]`.
3. Job begins just after a clean probe: fast return leaves the job scanning and old snapshot unchanged, performs no transaction, and the next invocation resumes/completes it.
4. Full-read path followed by transactional job conflict: returns unpublished with `hasMore=true`, rolls back once, leaves existing snapshot and scanning job unchanged.

All assertions passed. Reproduction: `node <REVIEW_OUTPUT>/audit-snapshot-races.mjs <BACKEND_WORKTREE>`. Output is `snapshot-races.log` in this directory.

## Remaining gates

The integration owner must run final applicable verification on the combined snapshot/retention content and preserve exact source/toolchain evidence. Live Firestore consistency, deployed behavior, and billing were not examined. Any runtime change after the above hash needs corresponding review/test evidence again. No new Issue, branch, PR, production change, or publication was performed by this reviewer.
