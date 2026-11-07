# #977 Provider prompt cache measurement

Status: baseline measured; renderer key-order experiment awaiting after run

- Owner: SlateHopper; integration/push/paid run dispatch: PluckyTuring.
- Clone: `s1-991/.prompt977`; current branch `perf/issue977-renderer-prefix`.
- Current base/HEAD: `022931a899b3dc4c106c6b17cfd7d31932aec357` plus the renderer experiment diff. Initial instrumentation base was `856dbe11fd4a34c24fbe3d6f79d07b109152e176`; shipped as PR #1041 (merge `5e4df591`).
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

## Historical table before instrumentation

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
- Parent approved the instrumentation, merged #1041, and completed baseline run 42401574682. Parent Mail16016 approves only moving the renderer `request` key first, with unchanged values/directives/schema; parent will dispatch the same profile/repetition after the patch.
- If a cause is demonstrated, preserve schema/instruction meaning, fix only ordering, prove stable prefix bytes and same deterministic fixtures, then request the same real profile for after comparison.
- Ready requires measured table/coverage, exact changed-state verification, actual-run comparison for any prompt optimization, and a patch/short summary to the parent. A metrics-only checkpoint is not proof of cache improvement or completion of umbrella #977.

## Instrumented actual baseline

Run [42401574682](https://github.com/kame447/StudyPlanner/actions/runs/42401574682), exact head `e46b9c39dc5eda1daa4e045effae1189285a036f`, `profile=vnext`, repetition 1, direct OpenAI `gpt-6-luna`. Artifact `weekly-planning-real-api-1` (ID13585888687). Aggregation reads all `[AI Eval Metric]` lines from `run.log`, not the client's last-100 in-memory window.

| Kind | Requests / known cache | Input | Cached | Cache write | Token reuse | Requests with a hit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| native (including repair) | 106 / 106 | 1,823,378 | 1,766,989 | 56,071 | 96.91% | 105/106 = 99.06% |
| focused | 16 / 16 | 12,811 | 0 | 0 | 0% | 0/16 |
| renderer (V5 comparison + VNext) | 115 / 115 | 232,547 | 8,451 | 219,875 | 3.63% | 5/115 = 4.35% |
| other semantic/V5 | 67 / 64 | 282,190 | 258,367 | 23,161 | 91.56% | 62/64 = 96.88% |

Three other-semantic client failures have unknown usage and are excluded from token/hit denominators. Focused requests contain 660–987 input tokens (all below 1,024), so low reuse is not evidence of unstable prefix and padding is not proposed. Renderer input ranges 473–2,988 tokens (6 below 1,024). Its five hits reuse almost the whole prompt (1,486–2,061 tokens); reuse of a newly stable partial prefix remains an experiment. No caching/model/API/retention setting is changed, and no dollar-cost reduction is inferred.

Quality scope: the baseline workflow failed `compound-date-shared` in the native provider observation suite; 95 tests passed / 1 failed in that step. This is not a passing quality gate. The failing native date-reading scenario is recorded independently from these cache counter observations; the renderer experiment cannot be declared successful from the counters alone.

### Chosen experiment and falsification

1. Unstable renderer leading context is demonstrated: changing action IDs precede a long repeated `request` directive. Move that single JSON key first, preserving every JSON value and the complete system string. Do not touch the native prompt (already 96.91% reuse), schema, message roles/count, interpreter, saved state, approval or persistence.
2. Unsupported caching as a blanket explanation is contradicted by actual renderer cache reads/writes on the same route/model. Short focused input is a separate eligibility explanation, not a reason to enlarge its prompt.
3. **Message-boundary caching can defeat a key-order-only change.** The official guide describes GPT-5.6+ implicit lookup at eligible message endings. A longer common byte prefix inside one user message may still yield no reuse. The guide's API examples use Responses, while this experiment preserves Chat Completions. Do not claim a supported internal breakpoint or extrapolate cache behavior from byte equality. After run is required; if no useful improvement is measured, recommend withdrawing the production reorder rather than expanding to role/API/message changes without parent judgment.

The four pre-change fixture digests cover question, real recorded preview, recovery and reference context. They canonicalize object-key order only, leaving all strings, values, arrays and the system prompt intact. The prefix regression varies IDs, user text, history and accepted facts while requiring the same leading directive bytes. Actual renderer → failed append → persistent outbox/reload → Worker privacy preparation regressions preserve the reordered request prefix, current user input, future sentinel, client/server size limits and large-input truncation.

Replaying only this key-order transform over the baseline's 53 VNext comparison renderer requests changes their common compact messages-JSON prefix from **975 to 1,835 UTF-8 bytes**, preserving every individual message byte length. The common directive substring itself is 876 bytes; longer identical-directive groups can share more. These numbers describe the wire representation, not cacheable token count or a server-side breakpoint.

The experiment base 022931a8 differs from the paid baseline head e46b9c39 only in the Firestore-load work document, conversation-index tooling and a local renderer-fidelity integration test. The native/focused/renderer production implementations and real-API scenario sources match before this reorder. Coral's separately prepared X0 native-recurrence explanation (+2 system bytes) is not part of this experiment base. Reconfirm these inputs at the actual after head; do not silently combine their effects.

## Renderer experiment verification checkpoint

- Before the production edit: the new canonical-digest check passed, while the new prefix check failed exactly because the first key was `actionId` instead of `request` (1 passed / 1 failed). The four digest constants were captured on unmodified 022931a8, then fixed in the regression.
- After the production edit: renderer prefix + existing prompt + prompt-trace + durable renderer trace persistence regressions: 28 passed / 4 files (`--configLoader runner --maxWorkers=2`). No assertion weakening.
- The current complete VNext/Worker directory integration and app/Worker typecheck are running. Pending is not pass; append their terminal results before sending the experiment patch.
- After-model results are still missing. This checkpoint proves value preservation and a stable wire prefix, not lower cost/latency, better semantic quality or a measurable cache improvement.

## Instrumentation verification (base 856dbe11 + current diff)

- `node node_modules/vitest/vitest.mjs run --config vite.config.mjs --configLoader runner src/services/ai/openAiCompatibleClientMetrics.test.ts --maxWorkers=2`: 17 passed. Direct/proxy cache hits, explicit zero, omitted fields, partial usage and invalid numbers are distinct; capture on/off keeps the exact body and reply; only finite request-kind labels are retained.
- Same runner, related files `src/services/ai/openAiCompatibleClient.test.ts`, `openAiCompatibleClientDispatch.test.ts`, `openAiCompatibleClientEmptyResponse.test.ts`, `workers/ai-proxy/src/durableTurns/durableVNextProviderCalls.integration.test.ts`, `src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextLocalRuntime.integration.test.tsx`: 72 passed / 5 files.
- `WRANGLER_LOG_PATH="$PWD/.cache/wrangler-typecheck.log" WRANGLER_SEND_METRICS=false npm run typecheck`: app + regenerated Worker types + Worker exit 0. `git diff --check` passed.
- Focused integration scope instead of repeating all VNext/Worker files: this first patch changes only opt-in client evaluation counters/classification, with unchanged provider request/body, return values, retries and disabled-capture behavior. The actual VNext runtime and durable Worker dispatch boundaries above check the applicable combined path. No state/schema/prompt/Worker implementation changes. Full CI/build belongs to the parent integration owner.
- Environment: Node 24; Vitest 5.0.5 / TypeScript 5.9.3 / Vite 6.4.4; lock SHA256 `529b5285a7ecfbc9b8da8176f9e6811fd3ee3c398e3b1d9db6c134a10faed122`. Dependencies are the parent-provided symlink. Default bundle config loading was blocked writing its `.vite-temp` in that shared dependency target; the CLI-documented `runner` config loader avoids this write, without changing dependencies, permissions or source config. An early typecheck observed a test mock's pre-fix zero-argument signature; the typed fetch mock and fresh check passed afterward.

## Trace/privacy boundary

This change adds content-free numbers plus a finite enum to the existing explicit-opt-in evaluation metric, not planning turn diagnostics or product telemetry. Existing `[AI Eval Metric]` output is captured in the synthetic evaluation job log. Prompt/body/user text/API keys are not newly logged, and no new trace/checkpoint field is introduced. The separate Worker observation path already handles cache counters. No trace-persistence schema expansion is needed for this evaluation-only channel.
