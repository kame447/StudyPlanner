# Measured replay scenario: scale and conditional cost

The successful real-Rules scenario is **one cold planner launch followed by replay/completion of five already-saved approval plans**. It is not initial creation: that separate scenario is blocked on both revisions. This section is separate from the 13-phase mock sequence in the owning checkpoint and does not price the mock's logical returned-document totals.

Each fixture has 24 / 240 / 2,400 original plans, 8 / 80 / 800 MonthEvents, **plus five previously saved approval plans**. Other fixture collections have the cardinalities listed in the owning checkpoint. The included session ends after replay/completion; the test's later explicit refresh and five independent verification reads are excluded. They are checks, not part of the modeled user session.

#### Observation-to-model boundary

| Metric per included session | Small before → after | Medium before → after | Large before → after |
| --- | ---: | ---: | ---: |
| Cold Listen document responses (unchanged) | 69 → 69 | 564 → 564 | 5,514 → 5,514 |
| Replay Listen document responses | 346 → 6 | 2,821 → 6 | 27,571 → 6 |
| Replay transaction document responses (unchanged) | 32 → 32 | 32 → 32 | 32 → 32 |
| Observed response-only read equivalents: cold + replay + transaction | 447 → 107 | 3,417 → 602 | 33,117 → 5,552 |
| Dedicated verify-only Commit operations (unchanged) | 16 → 16 | 16 → 16 | 16 → 16 |
| Pricing read equivalents: responses + verify-only operations | 463 → 123 | 3,433 → 618 | 33,133 → 5,568 |

Server query targets are **54 → 9 per session** (cold **9 → 9**, replay **45 → 0**). The replay's six migration-marker responses remain on both revisions. All 32 transaction documents are found; the included fixture has no empty queries or missing-document responses. The reductions in modeled document reads are 73.43%, 82.00% and 83.20% respectively. Cold startup is not credited with a server-read saving.

There are **16 observed document mutations per replay on both revisions**: six operation-document mutations and ten approval-item mutations. There are no ScheduleEvent or migration-marker mutations. Six Commit RPCs also carry **16 dedicated verify-only operations**. These are counted separately from update/delete/transform mutations by the outgoing RPC instrumentation, rather than inferred from a generic write precondition. They are not added to mutation write counts. The model therefore uses **16 writes/session**, unchanged, and adds the 16 verify-only operations to its pricing read equivalents. Counts exclude fixture seeding and test verification.

For pricing sensitivity, each observed Listen/transaction document response is treated as one document read, and each dedicated verify-only operation contributes one additional read equivalent. [Google’s billing guidance](https://docs.cloud.google.com/firestore/native/docs/billing-questions#usage-dashboard-discrepancies), checked 2026-10-08, identifies verify-only operations as contributing to billed reads. The 16-operation count comes from the existing instrumented Commit/Write counter and final replay reports; raw RPC payloads were intentionally not persisted. This is a source-informed model, not a production billing observation. The earlier response-only model omitted this known read component; its raw observations remain unchanged. SDK-to-Emulator traffic does not measure charged index entries, Rules-dependent reads, production caching/reconnects, retries or all other application activity.

#### Assumptions and formula

- Population means **DAU**, not registered accounts or concurrent users. Every DAU executes the included session once per day, on each of 30 days. The starting fixture size is held constant; this is not a history-growth simulation.
- Pricing assumption: **Firestore Standard, Iowa (`us-central1`), USD, default pay-as-you-go, no commitment discount**. Actual production region/edition, billing currency and eligibility were not inspected.
- [Official pricing](https://cloud.google.com/firestore/pricing) and [official quotas](https://firebase.google.com/docs/firestore/quotas), checked **2026-10-08**: $0.03 per 100,000 document reads; $0.09 per 100,000 writes; 50,000 reads and 20,000 writes free per day for the eligible database. The free quota resets around midnight Pacific time and is not carried to another day. [Firebase’s current eligibility guidance](https://firebase.google.com/docs/firestore/pricing#free-quota-applies-only-to-one-database-per-project) permits one eligible database per project and describes the first-created database independently of its ID. This scenario assumes that eligibility; the actual database has not been inspected. Do not infer ineligibility from a database name alone.
- This table assigns the entire read/write free quota to the included scenario, assuming no other usage. Other usage is **unmeasured**, not known to be zero.

For each day `d`, `R_d = DAU_d × r`, `W_d = DAU_d × 16`, where `r` is the per-session model above. Calculate that day's excess before summing the month:

`monthly scenario read/write USD = Σ_d [max(0, R_d − 50,000) × 0.03 / 100,000 + max(0, W_d − 20,000) × 0.09 / 100,000]`

The uniform 30-day case below equals 30 times the daily charge. Subtracting a pooled monthly free allowance would be wrong when daily usage varies. For a database without free-quota eligibility, substitute zero for both allowances.

#### Scale and partial monthly cost

Monthly prices below include only the modeled document reads and writes. They are **not whole-app bills or total-cost upper bounds**. Display rounding is four decimal places; calculations use exact decimal arithmetic.

| Owner dataset | DAU | Model reads/day, before → after | Writes/day, both | Model read cost/month USD, before → after | Write cost/month USD, both | Partial read/write cost/month USD, before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| small | 100 | 46,300 → 12,300 | 1,600 | 0.0000 → 0.0000 | 0.0000 | 0.0000 → 0.0000 |
| small | 1,000 | 463,000 → 123,000 | 16,000 | 3.7170 → 0.6570 | 0.0000 | 3.7170 → 0.6570 |
| small | 10,000 | 4,630,000 → 1,230,000 | 160,000 | 41.2200 → 10.6200 | 3.7800 | 45.0000 → 14.4000 |
| medium | 100 | 343,300 → 61,800 | 1,600 | 2.6397 → 0.1062 | 0.0000 | 2.6397 → 0.1062 |
| medium | 1,000 | 3,433,000 → 618,000 | 16,000 | 30.4470 → 5.1120 | 0.0000 | 30.4470 → 5.1120 |
| medium | 10,000 | 34,330,000 → 6,180,000 | 160,000 | 308.5200 → 55.1700 | 3.7800 | 312.3000 → 58.9500 |
| large | 100 | 3,313,300 → 556,800 | 1,600 | 29.3697 → 4.5612 | 0.0000 | 29.3697 → 4.5612 |
| large | 1,000 | 33,133,000 → 5,568,000 | 16,000 | 297.7470 → 49.6620 | 0.0000 | 297.7470 → 49.6620 |
| large | 10,000 | 331,330,000 → 55,680,000 | 160,000 | 2,981.5200 → 500.6700 | 3.7800 | 2,985.3000 → 504.4500 |

For example, the medium 1,000-DAU case is **3,433,000 → 618,000 model reads/day**, with 16,000 writes/day. Its included read/write charge is **$30.4470 → $5.1120 per 30 days** under the stated assumptions. At 10,000 DAU the medium case is **$312.3000 → $58.9500**, including $3.7800 of writes on both revisions. These figures do not establish that 10,000 users fit a latency, capacity or total-spend target.

#### Conditional document-operation free-quota headcount

For one session per active user per day, with no unmodeled per-user work and no fixed shared work, `min(floor(50,000/r), floor(20,000/16))` gives:

| Owner dataset | Before DAU | After DAU |
| --- | ---: | ---: |
| small | 107 | 406 |
| medium | 14 | 80 |
| large | 1 | 8 |

These are conditional **document-read/write headcounts**, not a guaranteed number of users who can run the entire app free. If fixed shared daily work is `F_R` reads / `F_W` writes and omitted per-user daily work is `u_R` / `u_W`, the conditional headcount becomes:

`max(0, min(floor((50,000 − F_R)/(r + u_R)), floor((20,000 − F_W)/(16 + u_W))))`

For more than one session per user, multiply the included `r` and `16` by that frequency before adding other work. Obtain the fixed/shared and per-user terms from actual usage; do not subtract the same shared workload once per user. Storage and outbound transfer can exhaust separate free quotas before this document-operation number is reached.

#### Remaining cost and verification boundaries

Additional reads/writes from auth/profile, catalog/metadata, trace append/retry, admin history/export, backend/cron, Rules dependencies, index entries, transaction contention and SDK reconnection are not included. Neither are storage/index storage, network transfer, backups/PITR, other compute/AI services, currency conversion or tax. In production, add these workloads before applying each daily allowance and include their separate charges. The included scenario can be assessed only as one component of total cost. In particular, shared backend/cron and trace work is outside this measured fixture, not zero. Separately proposed optimizations to that work are not verified or credited in this PR. Add shared fixed work once per project, rather than once per DAU, before claiming any total-spend or free-user limit.

A new-plan first approval remains blocked by current Rules, so no successful first-save transport/billing saving is claimed. Full-history startup remains linear in stored owner data, and browser transport/performance and simultaneous multi-user capacity were not established by these observations.

Machine-readable inputs, exact results and source SHA-256 values are in `cost-model.json`; `calculate-replay-costs.py` regenerates the arithmetic from the two final replay reports. The source reports must be those with corrected mutation/verify accounting; earlier provisional write counters must not be used.
