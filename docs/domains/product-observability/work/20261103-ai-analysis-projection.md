# AI analysis projection boundary

Status: local candidate, not published; current integration checkpoint excludes this candidate.
Base: `c4b0dfa8c21573ef278cecc3bfa9c22864763568`
Domain: Product Observability (#213)

The admin analysis service retains the two concurrent read-model requests and
unchanged error propagation. A single internal projection function owns the
existing daily AI dimension aggregation and planning-efficiency response. Four
private aggregation helpers move with it unchanged. No generic framework,
validation, persisted data change, or public service API change is introduced.

Keep current purpose-prefix classification, unknown cost/token counters, null
ratios, histogram percentile composition, dimension tie ordering, legacy missing
operation-kind support, and checkpoint identity. This projects typed stored
observations; it does not interpret user language or alter VNext/V5 execution.

Alternatives: retain mixed IO/projection responsibilities (least churn), or split
identity hydration (higher migration/error-state risk). The selected boundary
separates data retrieval from pure metric projection without wrapping IO.

Local evidence:
- Existing service cases plus three realistic characterization cases: 27 pass
  before and after extraction.
- Fresh Worker runtime types and non-incremental Worker typecheck pass.
- Four helper bodies and the full projection are unchanged; the service class
  differs only by replacing the post-await computation with one synchronous call.
- Independent pure-projection and IO/error/timing reviews passed.

Final current-base combined verify and applicable native CI are still required.
No production or real-device claim. External writes remain held; no new PR.
