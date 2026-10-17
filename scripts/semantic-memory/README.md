# #294 runtime proof of concept

This is an optional on-device candidate-discovery runtime. Canonical user context,
lexical retrieval, provider calls, settings and persistence are outside this unit.
The factory requires both `enabled` and `optedIn`; the integrating caller owns the
OFF-by-default build flag and user permission lifecycle. Neither construction nor
empty batches start a Worker, import Transformers, inspect cache or fetch models.

## Model and runtime decision

- `Xenova/multilingual-e5-small`, immutable revision
  `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, int8, 384 dimensions.
- Public upstream [model card](https://huggingface.co/intfloat/multilingual-e5-small)
  declares MIT and 100 languages including Japanese. Retrieval training and explicit
  `query: `/`passage: ` prefixes fit asymmetric candidate discovery. This is not a
  claim of acceptable Japanese recall: the parent corpus evaluation owns that gate.
- [Pinned ONNX file](https://huggingface.co/Xenova/multilingual-e5-small/tree/761b726dd34fb83930e26aab4e9ac3899aa1fa78/onnx)
  is 118,054,593 bytes. Runtime upper bound is 120,000,000 weight bytes; tokenizer
  files have a separate 20 MB cap. FP16 is 235 MB; this export's q4 is 399 MB.
  Multilingual MiniLM offers no clear download advantage; a smaller monolingual
  model needs separate multilingual/quality evidence. Model selection remains
  provisional until real-device/quality acceptance.
- Exact Transformers.js **4.3.0**, npm published **2026-09-16**, more than two weeks
  before this task. 4.3.1 (2026-10-06) was excluded by the age requirement.
- The package is dynamically imported only inside the module Worker. ONNX runtime
  binaries are same-origin build assets, fetched lazily, never a third-party CDN.
  GPU adapter success is followed by real warm-up; GPU failure falls back to WASM
  with a separate warm-up. The typed factory option `backendPreference: 'auto' |
  'wasm'` defaults to `auto`; `wasm` skips the GPU adapter request inside the
  Worker. This is an explicit device/testing policy, never derived from input
  text. WASM always uses one thread, including non-isolated
  Safari/iOS pages. Adapter detection alone proves nothing about model support.

## Bounds, cancellation, privacy, cache

Batch maximum 8; each text maximum 2,048 UTF-16 code units; maximum pending calls 8;
production timeout 120 seconds including queue/model load. The model load and
inference queue are serialized per Worker. Cancellation or timeout terminates
that Worker, rejects **all** its pending calls, removes handlers, and releases
its queued input/model memory. A future call can start a fresh Worker. Disposed
embedders cannot restart. Backend is provisionally `wasm` before a successful
first call; only a successful warm-up/result establishes the actual backend.

Fetches permit only the pinned public model artifact list using GET without
credentials, referrer or request body. Input strings and vectors stay within
page/Worker memory. No remote embedding API, telemetry or remote fallback exists.
The signed storage redirect of an allowed public Hugging Face weight URL is part
of that public model download; user text never appears in that request.

Transformers `env.useBrowserCache` and `env.cacheKey` explicitly use only
`laplance-semantic-memory-model-v1`, including same-origin runtime binary caching.
This contains public model/runtime artifacts, not memory text/vectors. Cache
failure degrades to typed unavailability, preserving the caller's lexical fallback.
Dispose active embedders before `clearSemanticMemoryModelCache()` so a live
load cannot repopulate it. The function deletes only that namespace; local vector
index erasure is independently owned by the index layer.

## Reproduce

The repository's browser workflows already use `@playwright/test@1.64.0`. No root
Playwright dependency was added. If it is not locally installed, use the workflow's
normal isolated installation, or point to a matching installation:

```sh
npm ci
npm install --prefix /private/tmp/sm-playwright --no-save --package-lock=false @playwright/test@1.64.0
SEMANTIC_MEMORY_PLAYWRIGHT=/private/tmp/sm-playwright/node_modules/playwright/index.mjs node scripts/semantic-memory/measure.mjs
```

`SEMANTIC_MEMORY_BUNDLE_ONLY=1` rebuilds/audits only the bundle graph while
preserving the prior browser result, avoiding repeated blocked browser launches.

The script builds a separate synthetic entry using the production Vite config,
serves it with Vite preview on 127.0.0.1:4184 and runs desktop Chromium auto,
WebKit auto, and WebKit forced to WASM.
Only fixed Japanese synthetic text is embedded; it never logs into the app.
`desktop-results.json` records actual response bytes (not estimated CORS transfer
sizes), cold load plus warm-up time, first/steady inference/round-trip times,
backend, exposed GPU feature, main-page heap where available, and bundle sizes.
Main-page JS heap excludes Worker/WASM/GPU memory, so it cannot establish the
low-memory Safari release gate. Physical iPhone Safari is **NOT RUN**.

Each target verifies four additional lifecycle cases after cold inference:

1. Dispose the cold Worker, set the browser context offline, reload the page, and
   embed with a fresh Worker without clearing cache. A fixture supplies only built
   HTML and app/worker/library `.js` files as a synthetic installed shell. Public
   model files and ONNX `.mjs`/`.wasm` requests are blocked, so they must be loaded
   from the actual namespaced Cache API. Any blocked fetch during successful
   offline inference fails the gate rather than silently allowing an HTTP cache.
2. Clear the public model cache, verify its namespace is absent, reload offline,
   and require typed `model_download_failed`, with no vector result.
3. For the `webkit-wasm` target, require the actual reported backend to be `wasm`.
   The engine's skip-adapter behavior is also tested independently with a fake
   pipeline; modifying page navigator alone would not affect a Worker.
4. Restore online mode, clear cache, start inference, and hold the real full
   weight GET before it downloads. Abort only after the weight request is reached;
   require typed `aborted`, zero metrics/results after abort, and observed Worker
   closure. The held request is cancelled; it is not sent to a remote API.

The result includes explicit boolean gates, per-phase requests, cache inventory,
expected blocked requests, and fixture requests. Gate failure or harness failure
exits nonzero. This proves only the synthetic model-cache lifecycle: it does not
establish product offline routing, a service worker, installed PWA support, or
physical iPhone Safari behavior. Network response bytes are recorded separately
for the cold phase; failure phases are never included as successful downloads.

A launch failure is recorded as **NOT RUN** and exits nonzero; it does not prove
anything about model execution. The checked-in initial run was blocked before
page execution by Chromium's Mach bootstrap permission and WebKit's SIGABRT.
The bundle graph is nevertheless inspected independently: the synthetic page
statically imports the factory, but its initial graph contains no Transformers
or ONNX import. All inference chunks and WASM remain outside that graph. Main app
`npm run build` also succeeds; the runtime has no production consumer at this
child snapshot, so the synthetic entry is the stronger bundle-boundary test.

Focused verification (no model downloads):

```sh
npm run typecheck:app
node ./node_modules/vitest/vitest.mjs --config vite.config.mjs run src/features/userPlanningContext/semanticMemory/runtime
npm run build
```

Parent integration owns full `npm run verify`, production consumer integration,
Japanese retrieval quality, index lifecycle, real browser model execution,
low-memory behavior, product offline/PWA integration and all physical iPhone Safari acceptance.
This proof of concept must remain OFF by default until those gates pass.
