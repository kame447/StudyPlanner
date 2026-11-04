# AI metric payload versus delivery

Status: local candidate; no publication or current-base full integration proof yet.
Base: `022a09e0d8cafd8fd86ad10783e731ec5d6984c8`

`recordAiRequestMetricBestEffort` previously performed metric normalization,
pricing selection and delivery in one body. Its nontrivial payload computation
now lives in one private same-module `buildAiRequestMetricPayload` function.
The public function keeps configuration admission, clock capture, store/client
construction and best-effort failure notification. No wrapper layer, new module,
exported API, dependency or generic codec was added.

Preserve the configuration guard before clock access; explicit `nowMs` prevents
clock access. Usage defaults, unknown fields, reported-cost precedence, duration
clamping and byte rounding are unchanged. Payload/pricing evaluation remains
before the `try`: only construction/storage errors enter the existing callback
path. No catch expansion, retry, payment/provider call, auth or privacy change.

Before extraction, four public-function characterizations plus existing cases
passed (10 tests). After extraction, those same cases plus pricing/store tests
passed (34 tests, 3 files). A store prototype spy captures the outgoing payload
without live credentials or network writes. Fresh Worker runtime generation and
non-incremental Worker typecheck passed. Exact full-module comparison confirms
only the mechanical helper move and same-position synchronous invocation.

Independent source and public-test review passed. Final combined verify and applicable native CI are
separate gates, not established by these focused tests. No production claim.

The lower-churn alternative is retaining the combined function. This private
boundary is selected because pricing/payload policy and best-effort delivery have
separate change reasons, without introducing a framework or splitting a simple
forwarder. Fresh open-PR ownership and bounded historical-retain checks found no
matching work at the checked base.
