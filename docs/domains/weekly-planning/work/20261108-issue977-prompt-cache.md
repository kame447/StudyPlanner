# #977 Provider prompt cache measurement

Status: active measurement checkpoint; cache effectiveness not yet established

- Owner: SlateHopper; integration/push/paid run dispatch: PluckyTuring.
- Clone: `s1-991/.prompt977`; branch `perf/issue977-prompt-cache`.
- Base/HEAD: `856dbe11fd4a34c24fbe3d6f79d07b109152e176`.
- Scope: actual provider usage, grouped native/focused/renderer. Do not change prompt semantics, schemas or request bodies before a demonstrated cause. No inference-result cache.

## Existing evidence and competing explanations

Existing artifacts from runs [42355936803](https://github.com/kame447/StudyPlanner/actions/runs/42355936803) (head `1ef7efae82cdf0680011d87d5a9b74e566582e38`, one repetition) and [42347452608](https://github.com/kame447/StudyPlanner/actions/runs/42347452608) (head `8aa9019df5afd922ba5371172a0f772b97f170f0`, three repetitions) contain 1,174 `[AI Eval Metric]` records: 709 semantic normalizer and 465 renderer. These workflows ended in failure; completed provider observations are still observations, not passing quality gates. The artifact JSON files contain 742 `usage:null` slots (not a unique-request count; reports can repeat observations). Only the four provider-smoke responses retain raw usage; those short requests are not representative of native/focused/renderer cache behavior.

1. **Unstable prefix:** plausible, but neither zero cached tokens nor a cache miss has been measured yet. Falsify/confirm with actual per-kind usage plus byte-prefix comparisons. A reorder risks model behavior, so defer it until measured.
2. **Provider/route does not report cache usage:** distinguish omitted values from explicit zero. Existing workflow uses direct OpenAI, not the production Worker proxy; do not generalize its result to all routes.
3. **Evaluation drops the data:** confirmed in `openAiCompatibleClient.ts` / `openAiCompatibleClientMetrics.ts`. Existing evaluation metrics copy prompt/completion/total tokens but omit provider cache read/write details. Their absence cannot establish a cache miss. The minimal first change retains those counters only when evaluation capture is enabled.

The provider's [official prompt caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching) describes exact matching of a reusable prefix. A shared session does not guarantee a hit. Preserve the requested model and route in comparisons; do not infer discounts, model support or billed costs from input bytes.

## Measurement definitions

- Input tokens: provider `usage.prompt_tokens`.
- Cached tokens: `usage.prompt_tokens_details.cached_tokens`.
- Cache-write tokens: `usage.prompt_tokens_details.cache_write_tokens`.
- Unknown/omitted/malformed counters stay null; zero means a reported zero.
- Token reuse ratio = sum(cached tokens) / sum(input tokens) over records with both counters known and input > 0. Report coverage separately, not a zero-filled denominator.
- Request hit rate = requests with reported cached tokens > 0 / requests with a known cached counter. Report input-zero/failed/unknown counts separately.
- native/focused grouping derives only from fixed typed response-schema families; renderer derives from its typed purpose. Other semantic calls remain `other`, so V5 comparison calls are not silently labelled native. Renderer totals may include both V5 comparison and VNext unless the artifact context distinguishes them.

## Current table

| Group | Requests | Input tokens | Cached tokens | Cache-write tokens | Hit rate |
| --- | ---: | ---: | --- | --- | --- |
| semantic normalizer (native/focused/V5 not separately labelled) | 709 | 6,909,789 (706 known) | Unknown | Unknown | Not measurable |
| renderer (both comparison cores) | 465 | 944,536 (465 known) | Unknown | Unknown | Not measurable |

| Run / repetition | Semantic requests | Known semantic input | Renderer requests | Known renderer input | Cache coverage |
| --- | ---: | ---: | ---: | ---: | --- |
| 42347452608 / 1 | 178 (2 failed) | 1,648,621 / 176 requests | 114 | 232,590 | 0 / 292 |
| 42347452608 / 2 | 176 (1 failed) | 1,627,713 / 175 requests | 115 | 235,043 | 0 / 291 |
| 42347452608 / 3 | 178 | 1,634,137 / 178 requests | 119 | 239,100 | 0 / 297 |
| 42355936803 / 1 | 177 | 1,999,318 / 177 requests | 117 | 237,803 | 0 / 294 |

`0 / N` is zero coverage of the cache counter, **not zero cache hits**. These are completed client metrics, including three failure observations, not a claim that every input token was captured. Aggregate known input is 7,854,325 tokens across 1,171 known-usage requests. Missing request bodies are not reconstructed from byte sizes.

### Wire-prefix comparison (necessary evidence, not a cache-hit measurement)

The latest run's `vnext-comparison/vnext-native.json` captures typed requests. Grouping those records by response-schema name gives:

| Schema | Captured requests | First system message variants | System bytes | Common messages-JSON prefix bytes | Schema variants |
| --- | ---: | ---: | ---: | ---: | ---: |
| `weekly_planning_vnext_native_v1` | 54 | 1 | 19,966 | 20,078 | 1 |
| `weekly_planning_vnext_label_repair_v1` | 3 | 1 | 19,966 | 20,078 | 1 |
| `weekly_planning_stable_v5_dialogue_response` | 53 | 1 | 881 | 975 | 1 |

Comparison uses UTF-8 JSON with compact separators and preserves message ordering; schema comparison canonicalizes object keys only for equality hashing. No prompt text is reproduced here. The renderer's first dynamic user-payload key is `actionId`, before `currentUserMessage`; common directive text is later in the `request` field. This is a candidate to examine **if** actual renderer cache reuse proves low. Native's leading instruction bytes are already stable in this sample. These byte counts are not model token counts, server-rendered prefix lengths, eligibility thresholds or a proof of a cache hit. Response formats and provider-side hidden context also affect cache behavior.

## Next / done

- Add eval-only scalar counters and finite request-kind grouping, with mocked direct/proxy responses covering zero, absence, invalid counters and disabled capture. Verify identical outbound request bodies and returned content with capture on/off.
- Parent approved this instrumentation and will push/dispatch `profile=vnext`, repetitions=1 as the baseline. Await actual artifact usage before deciding on a prefix change.
- If a cause is demonstrated, preserve schema/instruction meaning, fix only ordering, prove stable prefix bytes and same deterministic fixtures, then request the same real profile for after comparison.
- Ready requires measured table/coverage, exact changed-state verification, actual-run comparison for any prompt optimization, and a patch/short summary to the parent. A metrics-only checkpoint is not proof of cache improvement or completion of umbrella #977.

## Instrumentation verification (base 856dbe11 + current diff)

- `node node_modules/vitest/vitest.mjs run --config vite.config.mjs --configLoader runner src/services/ai/openAiCompatibleClientMetrics.test.ts --maxWorkers=2`: 17 passed. Direct/proxy cache hits, explicit zero, omitted fields, partial usage and invalid numbers are distinct; capture on/off keeps the exact body and reply; only finite request-kind labels are retained.
- Same runner, related files `src/services/ai/openAiCompatibleClient.test.ts`, `openAiCompatibleClientDispatch.test.ts`, `openAiCompatibleClientEmptyResponse.test.ts`, `workers/ai-proxy/src/durableTurns/durableVNextProviderCalls.integration.test.ts`, `src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextLocalRuntime.integration.test.tsx`: 72 passed / 5 files.
- `WRANGLER_LOG_PATH="$PWD/.cache/wrangler-typecheck.log" WRANGLER_SEND_METRICS=false npm run typecheck`: app + regenerated Worker types + Worker exit 0. `git diff --check` passed.
- Focused integration scope instead of repeating all VNext/Worker files: this first patch changes only opt-in client evaluation counters/classification, with unchanged provider request/body, return values, retries and disabled-capture behavior. The actual VNext runtime and durable Worker dispatch boundaries above check the applicable combined path. No state/schema/prompt/Worker implementation changes. Full CI/build belongs to the parent integration owner.
- Environment: Node 24; Vitest 5.0.5 / TypeScript 5.9.3 / Vite 6.4.4; lock SHA256 `529b5285a7ecfbc9b8da8176f9e6811fd3ee3c398e3b1d9db6c134a10faed122`. Dependencies are the parent-provided symlink. Default bundle config loading was blocked writing its `.vite-temp` in that shared dependency target; the CLI-documented `runner` config loader avoids this write, without changing dependencies, permissions or source config. An early typecheck observed a test mock's pre-fix zero-argument signature; the typed fetch mock and fresh check passed afterward.

## Trace/privacy boundary

This change adds content-free numbers plus a finite enum to the existing explicit-opt-in evaluation metric, not planning turn diagnostics or product telemetry. Existing `[AI Eval Metric]` output is captured in the synthetic evaluation job log. Prompt/body/user text/API keys are not newly logged, and no new trace/checkpoint field is introduced. The separate Worker observation path already handles cache counters. No trace-persistence schema expansion is needed for this evaluation-only channel.
