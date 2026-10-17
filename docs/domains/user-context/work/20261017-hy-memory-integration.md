# Hy Memory 2.0 — local bridge connectivity checkpoint

Status: local synthetic SDK/HTTP integration verified; not deployed or used for production user memories
Date: 2026-10-17
Owner: #294
Draft PR: #719
SDK: hy-memory==2.0.2 (Python)

## Boundary

Laplance current structured state and Firestore user-planning-context records remain canonical. Hy Memory is an optional, disposable index, never a second truth or autonomous memory writer. The SDK's \`meta\` parameter, **not** \`metadata\`, persists client source provenance as a list; missing or merged/ambiguous mappings are rejected.

### Implemented

- \`scripts/hy_memory_probe.py --local-embedding\`: real SDK add/search/delete with a deterministic local OpenAI-compatible embedding mock, isolated temp Chroma storage, and no real accounts/provider calls.
- \`scripts/hy_memory_bridge.py\`: authenticated loopback HTTP sidecar with \`POST /v1/index\`, \`POST /v1/search\`, \`POST /v1/forget\`, \`GET /healthz\`. It calls the actual \`HyMemoryClient\` in \`lite\` mode, persists a per-owner revision fence, serializes index writes and reads, and marks interrupted/failed rebuilds unavailable. Indexing is bounded to 200 canonical records, with 2,000 characters per record. Client-supplied memories are never promoted to canonical state.
- \`workers/ai-proxy/src/hyMemoryCandidateService.ts\` and \`worker.ts\`: authenticated, quota-limited Firebase UID-scoped \`POST /user-context/hy-memory/search\` endpoint. Only mode \`shadow\` and server-side HTTPS bridge URL + secret allow a private bridge request. Invalid/stale/wrong-user/failed calls return \`unavailable\`. User auth token never reaches the Python service.
- \`src/features/userPlanningContext/hyMemoryCandidateBridge.ts\` + \`hyMemoryCandidateLookup.ts\`: opt-in browser caller, authenticated via existing Firebase session, and post-retrieval revalidation against current owner/revision/active record IDs. Vendor memory prose never enters the prompt as truth. Disabled by default.
- Focused Python and TypeScript regression tests plus \`scripts/hy_memory_e2e_smoke.py\` to run all three sidecar endpoints over authenticated loopback HTTP with the real SDK and a local embedding mock.

### Executed evidence

- 2026-10-17 macOS isolated \`uv run --no-project --python 3.11 --with hy-memory==2.0.2 -- python scripts/hy_memory_probe.py --local-embedding\`: passed actual SDK add, search with attributed \`meta\`, delete + no-recall. No provider costs or real data.
- 2026-10-17 \`python3 -m unittest discover -s scripts -p 'test_hy_memory_bridge.py' -v\`: 4/4 passed (HTTP bearer authentication, source ID provenance, owner/revision fencing, failure, forget).
- 2026-10-17 isolated \`uv run --no-project --python 3.11 --with hy-memory==2.0.2 -- python scripts/hy_memory_e2e_smoke.py\`: passed authenticated real SDK index/search/forget via HTTP, older-revision rejection.
- Full repository TypeScript and browser CI still need terminal result for the final PR HEAD. UI bundle-budget failures already existed on main and must be independently classified; do not change thresholds to mask them.

The synthetic embedding function is not a meaningful Japanese semantic model. These checks establish protocol and SDK connectivity, not semantic accuracy or provider pricing.

## How to run a private bridge

Install the SDK in a dedicated Python environment, configure \`MEMORY_DATA_DIR\` on persistent private storage, an authenticated OpenAI-compatible embedding endpoint, and a randomly generated \`HY_MEMORY_BRIDGE_TOKEN\` of at least 32 characters. Run \`python scripts/hy_memory_bridge.py --host 127.0.0.1 --port 19528\`. A production service needs an authenticated private HTTPS reverse proxy accessible only to the Cloudflare Worker; never expose the SDK's permissive stock server or the loopback HTTP bridge directly.

Worker-only configuration requires \`HY_MEMORY_CANDIDATE_MODE=shadow\`, \`HY_MEMORY_BRIDGE_BASE_URL=https://...private-endpoint\`, and secret \`HY_MEMORY_BRIDGE_TOKEN\`. The browser must also opt into \`VITE_HY_MEMORY_CANDIDATES=shadow\` to invoke the read helper. No such production provider, private proxy, or bindings are provisioned by this PR. Worker route is inert with the existing environment.

## Outstanding prerequisites — no production enablement

1. A trusted, revision-aware writer must read committed canonical records from the existing Firestore owner under verified authority and enqueue/idempotently deliver refresh and forget events. Do not send browser-provided unverified user snapshots or speculative AI outputs to \`/v1/index\`. Hook write/forget only after #164/#294 current sync and delete guarantees are verified, including cross-device and offline conflicts.
2. Deploy a durable private service + embedding provider with privacy/consent, data residency, cost, and secrets review. The local loopback service on a developer machine is not a production host.
3. Finish the app's asynchronous read integration and same-revision check, and choose a bounded live-read point without blocking current planning/save. The typed browser helper and Worker route exist but are not yet called from the planning prompt execution path.
4. Evaluate human-reviewed Japanese semantic retrieval cases against the lexical/entity baseline, covering false/stale recall, owner confusion, deletion/rehydration, p50/p95 latency, token/context budget and costs. Evaluate \`pro\` extraction and Jev rerank separately. Do not replace V5 or add another canonical memory database.

No actual user memories were exported or indexed, and no production service was deployed. The PR is Draft and #294 stays open.
