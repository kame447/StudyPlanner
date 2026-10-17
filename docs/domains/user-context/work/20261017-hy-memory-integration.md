# Hy Memory 2.0 — local bridge connectivity checkpoint

Status: real offline multilingual embeddings + SDK/HTTP verified on Mac; not deployed for production users
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

## Offline-only embedding decision (2026-10-17)

Product constraint: Keep the existing conversation AI provider. Do not send raw user memories to Tencent or add a remote embedding/LLM service solely for Hy Memory. The open-source Python SDK is allowed as a locally executed dependency, but production must additionally use host-level outbound-network restrictions.

The experimental memory bridge now starts a local 384-dimensional multilingual embedding model through FastEmbed/ONNX (model: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, Apache-2.0, FastEmbed 0.9.0). Inference runs in the same private Python service process. A small authenticated OpenAI-compatible embedding endpoint binds only to an ephemeral `127.0.0.1` port. The SDK's `MEMORY_EMBEDDER_BASE_URL`, `MEMORY_LLM_BASE_URL`, keys, model and dimensionality are forced to that loopback process; accidental LLM calls hit an unsupported local URL, never a cloud fallback. Chroma stays on local persistent disk under `MEMORY_DATA_DIR`. Run mode is pinned to `lite`.

Weights are fetched from Hugging Face only in an explicit bootstrap command using public model metadata; no user memory is involved. Runtime uses `local_files_only=True`, `HF_HUB_OFFLINE=1`, disabled anonymous telemetry, disabled proxy inheritance, and an explicit model cache. Startup fails when model files are absent instead of downloading or using a cloud embedding model.

### Local setup (synthetic test; no real user data)

```sh
# One-time public model download. Use a private absolute model-cache path.
CACHE_DIR="$HOME/.cache/laplance/hymemory-models"
uv run --no-project --python 3.11 --with fastembed==0.9.0 -- \
  python scripts/hy_memory_local_embeddings.py \
  --download-model --model-cache-dir "$CACHE_DIR"

# Cached model only; run the real SDK + HTTP bridge + Japanese synthetic tests.
uv run --no-project --python 3.11 \
  --with hy-memory==2.0.2 --with fastembed==0.9.0 -- \
  python scripts/hy_memory_offline_e2e_smoke.py --model-cache-dir "$CACHE_DIR"

# The private service itself remains localhost only until a trusted private host exists.
# Set MEMORY_DATA_DIR, HY_MEMORY_MODEL_CACHE_DIR and HY_MEMORY_BRIDGE_TOKEN
# before running scripts/hy_memory_bridge.py.
```

### Observed evidence

On the authorized Mac, the real FastEmbed model produced 384-dimensional embeddings and its cache was usable offline. With `hy-memory==2.0.2`, the real SDK stored three synthetic Japanese facts and recalled them from three unambiguous paraphrased queries through the authenticated local HTTP bridge. Revision mismatch and forget were rejected/processed correctly. A socket guard observed zero non-loopback connection attempts throughout the SDK add/search/delete lifecycle. The Python bridge and local endpoint tests passed (8/8).

A less specific Japanese query ("英語の試験で目指すスコアは？") did not recover the "TOEICの目標点数は800点" item and ranked unrelated candidates higher when inspected without the score gate. This limitation is retained as evaluation evidence; the successful smoke is neither a Japanese retrieval accuracy benchmark nor permission to lower production thresholds. Exact-entity lexical baseline and human-reviewed holdouts remain necessary.

### Production preconditions remain

The Mac is a development machine, not a production memory server. The runtime cannot be deployed on Cloudflare Workers as a Python/ONNX package without a separate managed host. Worker and browser selectors remain opt-in/disabled, and there is no Firestore committed-event publisher. Do not merge or enable for users until the private server, trusted synchronization/forget, provenance, data routing, outbound egress restrictions, cost/latency evidence, and Japanese retrieval evaluation are established. Existing conversational AI calls remain unchanged. Do not represent a model package license or a single local socket test as a universal privacy/security guarantee.
