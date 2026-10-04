# Issue #305 Unit 1 — semantic dispatch と Phase 0 census

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
