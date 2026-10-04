# Issue #305 Unit 1 — semantic dispatch と Phase 0 census

## Round 2 A — active checkpoint (2026-10-05)

Owner: CoolArchimedes / integration: BronzeMaxwell. Branch: `feat/issue305-semantic-census-activation`.
Base/HEAD: `8e62377e0c59d8b5ac820358781a8c3584433a9a`; changes stay uncommitted for parent integration. Existing Issue #305 is reused; no new Issue/PR and no GitHub writes.

DECISION 1 authorizes privacy-scoped actual census. ORRERY2349/2360/2362 additionally approve random turn/request join metadata, the existing `observability_events` sink, 90-day retention/admin access, client observer and smallest normalizer-boundary hook. Source activation remains off and deploy belongs to the parent after merge.

Compared: (1) proxy request alone as turn (rejected: client repair/background calls falsify completeness); (2) full trace reuse (rejected: retains forbidden content and expands access); (3) random-ID start/request/closure records with strict typed projections (chosen). Missing closure, missing physical request, conflicting ingestion and late/unjoined work remain unknown; structural machine metadata does not establish semantic purity/correctness. Falsifier: any bypassed semantic call, content in the sink/provider census envelope, request counted twice, or false free outcome.

Current: implementation complete and submitted for parent integration/external review, source activation off. Final verification: `npm run verify` exit 0 on the uncommitted content (660 files passed; 4,461 tests passed, 45 skipped, 1 todo; app/Worker non-incremental typechecks and production build passed). Definition of done for A is met: typed census ready for explicit configuration, no deploy/provider evaluation, final checks green, exact diff/state in the runtime report. Next: parent combined-content A/D/E test and CopperHopper audit, then parent-only commit/push/deploy. Actual production frequency remains unknown until approved activation and collection.

### Round 2 implementation and privacy boundary

Production observation now reuses the Unit 1 physical-send recorder, then passes its snapshot through the Unit 1 completeness reducer **before** removing laboratory/dispatch IDs. Unknown family/boundary, wrong turn join, duplicate/missing manifest and reversed timing remain unknown. A strict closed receiver rejects extra fields and contradictory counts/usage; each census payload is at most 8,192 bytes, with at most 64 proxy requests per closure and 16 physical sends per request. Overflow remains unknown with observed lower bounds, never exact zero.

- `shared/semanticTurnCensus.ts` owns the production allowlist: closed questionCode/route/family/stage/outcome, nullable counts/tokens/provider-reported cost, machine binding/freshness, counts/categories and SHA-256 candidate metadata only when already deterministically available. No raw text, generated text, free-form labels, provider secrets, application IDs or laboratory population IDs are retained.
- `shared/semanticDispatchRecorder.ts` adds opt-in best-effort capture: observer ID/callback/response-clone failure never blocks or repeats the original provider send. Existing evaluation behavior stays strict.
- The Worker default-export wrapper lazily creates a recorder at the existing authenticated parsed-body boundary and joins existing `waitUntil` tasks. It writes after settlement without awaiting persistence on the user response. No additional provider, request body read or authentication call is introduced for provider observation. Existing generic token/provider/storage paths are reused.
- The client records random-ID start/request/closure events through one invocation-local scope. The actual weekly-planning hook is the existing normalizer factory in `weeklyPlanningStableV5SemanticTurn.ts`, wrapped by `weeklyPlanningSemanticCensus.ts`; the pipeline, controller, reducer and normalizer body are untouched. User-context uses its interpreter boundary. Stage metadata is inserted **after** existing trace capture in normalizerRun/focusedPreRoutes.
- `semanticCensusObserver.observe(stage, dispatch)` registers each physical proxy request in the same manifest/pending set. The wrapped Luna client exposes this port so the independently owned Choice transport can use it for each node and fallback. A required factory callback from the existing application owner preserves independently owned normalizer options (the observer does not import/select the concrete normalizer); the parent must pass the observed client's observer into Choice when combining A/D/E. No adoption route is enabled here. Any future route that bypasses this boundary requires a scope around that route before collecting complete-turn evidence.

Start/request/closure records are needed because different Worker invocations and client/Worker loss cannot be joined durably in memory alone. ORRERY2420 explicitly approves storing random turn/request IDs for that purpose: every ID uses a new `crypto.randomUUID()`, independent of user/owner/conversation/trace/request identity. IDs occur only in census events, not provider payloads, weekly trace or aggregate reports. They expire with the census event and are not a new account identity. Tests exercise the actual provider wire and the existing diagnostic builder/Worker preparation to fix that exclusion.

### Existing sink, retention and access

Read-only `gh issue view 213` and `187` plus current #213 code/rules were checked. Census uses `observability_events`, the existing `ProductObservabilityStore` immutable ingestion/HMAC identity directory, Firebase authentication, existing service-account token provider and `/observability/events` endpoint. Client ingestion accepts only typed start/closure events; provider observations are Worker-only. Existing actor identity is reused solely for the preregistered account-cluster bootstrap; raw UID is absent from event documents and aggregate output.

Census events use the existing **90-day event retention** measured from server `observedAt`, `expireAt` and `ProductObservabilityRetentionService` deletion. This selects the existing #213 event contract rather than the broader weekly trace retention. Rules deny direct browser access to observability collections; existing backend/admin access remains the applicable read/export boundary. No new export endpoint, external sink, broader retention or provider exposure is added. Product activity rollups skip census events while advancing the existing ingestion cursor, including census-only pages. Persistence and actual expiration deletion are covered together in a regression.

### Switches and manual activation

Repository defaults are `SEMANTIC_CENSUS_MODE=off` in Worker configuration and an unset/off `VITE_SEMANTIC_CENSUS_MODE` in the client. Both sides require exact `typed` enablement; the client also requires the existing Cloudflare proxy configuration. Source `JEV_MODE=off` and `JEV_CANARY_PERCENT=0` stay unchanged. A merge alone does not activate the census or deploy the Worker.

After parent integration/external review, the operator builds the existing web app with `VITE_SEMANTIC_CENSUS_MODE=typed` and performs the **manual** Worker deployment using the existing `npm run deploy:worker` command with an explicit census variable override (`-- --var SEMANTIC_CENSUS_MODE:typed`). Existing #213 credentials/configuration must already be present; none are introduced or copied here. Record the actual activation/deployment timestamp for the fixed window. Disabling uses the existing source-off deployment and a client build with the census gate unset/off. This task performs no deploy, actual-user collection or paid/live-provider evaluation.

### Actual-format aggregation and preregistration

The existing offline command now accepts a version-2 normalized, operator-exported #213 artifact in addition to the Unit 1 version-1/inventory input:

```sh
node scripts/semantic-dispatch-census.mjs --input /private/tmp/actual-census-export.json --output /private/tmp/actual-census-report.json
```

Version-2 input is `{version:2, source:"observability_events", environment:"production", activationAt:<actual deployment ISO timestamp>, phase:"initial"|"extended", documents:[{eventType:"semantic_turn_census", environment:"production", actorSubjectId:<existing opaque actor>, payload:<strict census event>}]}`. Export provenance is operator-supplied and cannot be authenticated by this offline tool. The tool performs no network calls and refuses synthetic/fixture environment declarations, gate overrides and output overwrites. Test exports are explicitly mocks and never evidence of actual frequency.

The implementation follows preregistration §§13/14/16/16a: next JST midnight strictly after activation, 14 full days; evaluate once when the window has closed. The initial decision exposes only the complete-turn count if below 200 and requests one 14-day extension; no eligibility-frequency result is returned then. Extended analysis refuses an extension if the initial complete count already met 200. The primary denominator contains all observed started weekly semantic turns, including unknown observations; unknown turns are conservatively not eligible. D1's numerator is complete turns whose start-time machine pending is fresh `quantity_role_unresolved`. Complete-only and conservative upper rates are reported separately.

The actor-cluster bootstrap uses exactly 20,000 replicates, SHA-256 UTF-8 seed `unit0-census-2026-10-05`, first 16 bytes as big-endian unsigned xoshiro128** state, code-point actor order, turn-weighted resampled ratios and the one-based 1,000th sample as the lower bound. Unknown actors form one cluster and do not count among the ten required known actors. Gates also require 200 complete turns, 90% coverage and 1% lower bound. This is descriptive evidence for an observed cohort, not a random-sample population guarantee. PRNG and first cluster draws have an independently calculated known-answer test.

Unjoined requests are deduplicated as request observations within the window and are **never** invented semantic turns or guessed into a turn by actor/time. Any weekly unjoined provider observation or unframed export causes HOLD with no frequency/free evaluation; observed unjoined send lower bounds remain explicit. A user-context gap only invalidates that population's complete-turn/free evidence. Missing/conflicting start, closure, request manifest or provider observation remains unknown. Entirely lost telemetry cannot be measured by this observed coverage and remains a limitation.

C5/D5/D5-prime/D6 use the existing Unit 1 structural predicate with uncollected semantic/tuple/current-intent dimensions left NA. Machine questionCode does not prove a pure user answer, candidate binding or semantic correctness. Current production metadata supplies question/represented-target count and graph freshness; propositions/candidate menu/binding stay unknown when not available at this boundary. No lexical inference or history promotion fills those fields.

### Measurement endpoints and integration obligations

`semanticResolution=success` means only **normalizer accepted** (user-context: typed parse returned). It is reported separately from HTTP/provider outcome and is never a correctness label. Label-confirmed correct-and-free remains NA. Client latency measures normalizer/interpreter plus joined client calls, excludes census persistence/renderer, and stops before formal binding/canonicalization/commit/save. Provider latency covers the actual send through response-body observation; Worker request latency stops at its main response. Late Worker provider/body observation makes whole-turn latency NA (execution order is retained even if millisecond timestamps are equal); invalid timing stays NA instead of clamping to zero. Nested durations are not added together. No latency/cost/quality non-regression or Jev adoption is claimed.

Parent integration must verify the independent Choice nodes plus fallback use the same scope, preserve D/E factory options, and include any newly adopted route before the normalizer. A's own scope/port/factory regression covers this contract; E's transport regression and the parent combined-content test complete the cross-worktree proof. The source-off baseline remains the live route here.

### Round 2 verification checkpoint

Development focused tests and app/Worker typecheck are green. The external WIP four-case projection counterexample was fixed by reusing Unit 1 validation before projection, with six explicit unknown regressions plus strict receiver checks. Additional tests cover privacy sentinels, fresh crypto IDs, proxy/provider/trace exclusion, nullable usage/timing, population separation, best-effort failure, per-node observer join, byte limits, authenticated ingress, immutable persistence/90-day deletion, census-only rollup cursor and fixed-window offline aggregation. Final corrected-content `WRANGLER_HIDE_BANNER=true WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=.wrangler/logs npm run verify`: exit 0, 660 files passed, 4,461 tests passed, 45 skipped, 1 todo, app/Worker non-incremental typechecks and production build passed. Existing live/observational skips are not provider-evaluation evidence; no lint script is configured and UI is unchanged. An earlier verify failed on the new off-path config lookup and concrete-normalizer dependency; both were corrected in production code without changing existing tests. Focused source-off/runtime/isolation tests (25) and typecheck then passed, followed by the full green run.

Final code/test/config snapshot: `/private/tmp/coolarchimedes-verified-content.json`, SHA-256 `7e7e3a7a321acd1de3f6111b2d7625b88c0d81039829cf3768c50e920c0a4a11`; all 29 changed code/test/config file hashes were rechecked after verify and match. Final log: `/private/tmp/coolarchimedes-verify-final.log`; standalone strict offline-script TypeScript check: exit 0 (`/private/tmp/coolarchimedes-script-typecheck-final.log`). Final report/exact diff: `/Users/Shogo/.agentstack/runtime/jev-impl-reports/r2/census-activation.md` and `.diff`. This verification checkpoint update is documentation-only.

Environment: Node 22.23.0, npm 10.9.8, TypeScript 5.9.3, Vitest 3.2.7, Vite 6.4.3, Wrangler 4.143.1, React 18.3.1, Firebase 12.12.0. Lockfile SHA-256 `b2ba189b1ed63a4f8616fe4922022cb05c05f6e1f8e8c9d76c6661aa6ba147bd`; regenerated Worker runtime types SHA-256 `bf808b3fb4789a76410fc9c1ba8cd85e80453b8f92fa0981bdb86a9d523d612e`. No dependency/config/provider environment changed after the green run.

The Unit 1 history below describes the earlier evaluation-only foundation, not the current Round 2 authorization.

Status: submitted for integration / foundation only, rollout off
Owner: DewyLavoisier（integration: BronzeMaxwell）
Branch: `feat/issue305-semantic-dispatch-census`
Base / current HEAD: `5668fbfb7337b0f34bbae0ce9016765f12b60439`
PR: none（親が review 後に commit / push / PR を担当）

## Completion contract

実 provider fetch の turn 単位の計測、背景作業の join、欠測の unknown、population を分離した offline census、privacy exclusion の回帰を実装する。focused test・typecheck・最終 `npm run verify` を通し、exact diff と環境を記録して親へ提出する。採用・Luna 削減・actual の頻度を主張しない。real-user の収集、provider 評価、production sink、有効化は行わない。

## Decision checkpoint

- browser proxy の成功 / attemptCount を数える案：既存 metric があるが Jev-only と背景 dispatch を区別できないため不採用。
- production trace / telemetry に足す案：永続化境界はあるが、収集の承認と #187 / #213 の判断がないため不採用。
- 評価 harness だけが注入する invocation-local recorder と actual fetch 境界を使う案：provider 注入 port と Worker の共通送信境界があり、mock fetch で独立に検証できるため採用。通常の caller と production sink は接続しない。

反証条件：provider の送信経路が recorder を迂回する、背景作業が request closure 後に増える、欠測・混在を既知 0 に変換する場合、この方式は complete と扱わない。

## Implemented boundary

評価 harness が明示的に注入する recorder で、Worker の Luna fetch と既存の Jev provider 注入 port を観測する。direct client の fetch も同じ recorder を使える。ブラウザの proxy fetch だけでは provider の回数が分からないため、成功・usage の有無に関係なく unknown にする。通常の caller、HTTP payload / header、環境設定から recorder を作る経路はない。

- `shared/semanticDispatchLedger.ts`：population、turn / physical request / dispatch の opaque UUID、用途、完了 manifest、nullable usage の契約と reducer。全 turn の request manifest、各 request の dispatch manifest、settlement が一致して初めて exact count と free を返す。送信後の失敗も数え、送信前の拒否と semantic resolution を分ける。
- `shared/semanticDispatchRecorder.ts`：実 fetch の直前に dispatch を記録し、usage の clone 読み取りと背景作業を join する。renderer、異なる domain、未観測 proxy、不正な記録、closure 後に増えた作業は unknown。provider 内部の timeout は typed adapter result で区別する。
- `workers/ai-proxy/src/semanticDispatchWorkerObservation.ts` と Worker / client の汎用境界：off 時の通常経路は従来どおり。4種類の既存 decision port に評価用 fetch wrapper を注入する。Unit 0 所有 file は未変更。
- `scripts/semantic-dispatch-census*.{ts,mjs}`：ネットワークを呼ばない offline tool。typed label の構造上の適格性、質問・対象数・命題数・open な値・候補数・参照形式・tuple・route・用途・実測区間・nullable usage / cost を別母集団で集計する。正しさ / current intent は raw text から推測しない。

`turnId` は一つの実行、`pairId` は事前登録された同じ入力 turn の両 arm、`requestId` は一回の physical request を識別する。実 retry は新しい request / dispatch ID を持つ。artifact の再取り込みだけを ID で除き、矛盾した同一 ID は unknown にする。`sealed` は harness が全 semantic 呼出しを登録し、全 recorder の `settle()` を待った後だけ設定する。renderer と telemetry-only persistence の時間を semantic 区間へ足さない。`completedAtMs` は semantic pipeline と遅れた provider 作業の完了を含む一つの区間であり、観測の settlement 自体は後でもよい。

## Privacy exclusion

新しい recorder は **weekly trace / persistent outbox / Firestore / production telemetry から意図的に除外**する。収集承認前に、turn の新しい集合や user text を永続化・送信しないためである。user text、prompt、response body、provider error、auth header、user ID、未知の追加 field は recorder snapshot と census aggregate に入らない。provider の応答 clone は usage を読むための一時メモリだけで、bounded body を処理後に破棄する。

代替診断は評価 harness の allowlist snapshot と offline aggregate。既存の production request metric と weekly trace は変更しない。`semanticDispatchRecorder.test.ts`、`openAiCompatibleClientDispatch.test.ts`、`semanticDispatchWorkerObservation.test.ts`、`semantic-dispatch-census.test.mjs` が、実 mock-provider request の内容と保存 aggregate の sentinel 除外、wire field の不変、通常経路の非収集を固定する。trace に新 field を追加する場合には、この除外を解除する別 owner 判断と feature AGENTS の永続化 gate が必要。

## Offline invocation and result

```sh
node scripts/semantic-dispatch-census.mjs --inventory --output /private/tmp/issue305-census.json
node scripts/semantic-dispatch-census.mjs --input /private/tmp/normalized-census.json --output /private/tmp/normalized-census-summary.json
```

input は `{ version: 1, rows: CensusRow[] }`（型の正本は `scripts/semantic-dispatch-census-core.ts`）。正規化時に framing が壊れていれば report 全体を拒否し、partial な request / dispatch は unknown として全 turn の分母に残す。output は既存 file を上書きしない。

2026-10-04 の repository inventory：20 母集団、1,242 行。contextual synthetic corpus の質問は `quantity_role_unresolved` 37、`missing_effort_estimate` 23。他の19母集団は既存 eval evidence の別 artifact / run であり、重複する実験の turn を独立の frequency として合算しない。すべて消費済み corpus / logical-request artifact の診断で、新しい独立証拠ではない。実 provider dispatch、whole-turn latency、joint correctness は unknown。actual の入力データはなく、本番頻度は unknown。新しい収集には owner 承認が必要。

## Verification checkpoint

- exact HEAD：`5668fbfb7337b0f34bbae0ce9016765f12b60439`、branch は上記。dirty / untracked の提出（親の指示により commit / push なし）。
- focused regression：9 file / 148 tests passed、exit 0。4 decision 境界、security regression、client、ledger、census を含む。
- `npm run typecheck`：app / Worker、runtime types 再生成、exit 0。
- offline scripts の standalone strict TypeScript check：exit 0。
- 最終 `WRANGLER_HIDE_BANNER=true WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=.wrangler/logs npm run verify`：exit 0、644 files passed、4,184 tests passed、45 skipped、1 todo、production build success。skip は既存の live / observational contract によるもので、有料・real provider の評価証拠ではない。lint script はない。UI 変更はない。
- npm ci は default cache の sandbox EPERM 後、task 内の cache で成功。Node `22.23.0`、npm `10.9.8`、TypeScript `5.9.3`、Vitest `3.2.7`、Vite `6.4.3`、Wrangler `4.143.1`、React `18.3.1`、Firebase `12.12.0`。
- lockfile SHA-256：`b2ba189b1ed63a4f8616fe4922022cb05c05f6e1f8e8c9d76c6661aa6ba147bd`。generated Worker types SHA-256：`bf808b3fb4789a76410fc9c1ba8cd85e80453b8f92fa0981bdb86a9d523d612e`。
- verify log：`/private/tmp/issue305-unit1-verify.log`。code / test の exact content manifest：`/private/tmp/issue305-unit1-verified-content.sha256`。本記録の追加は docs-only で検証後の code / test / config 変更はない。

外部 WIP probe の unknown family は production defect と分類して修正。reducer 自体が欠落・不正な family / boundary / population / stage / outcome / usage を検証する regression を追加した。型付きの正規の `other` と unknown は区別する。

Next: 親の diff review / commit / push、Unit 0 との統合、外部監査、CI。採用ゲート・新しい paired 評価・actual census・production collection は未証明 / 未承認。基盤の merge は採用でも Luna の削減でもない。
