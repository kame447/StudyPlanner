# 週間計画 semantic schema registry

Status: canonical / current generation registry
最終更新: 2026-07-22

- Current contract: [weekly-planning-current-contract-v5.md](../ai/weekly-planning-current-contract-v5.md)
- Stable V5 migration plan: [weekly-planning-semantic-stable-v5-migration-plan.md](../ai/strategy/weekly-planning-semantic-stable-v5-migration-plan.md)
- V5 roadmap: [weekly-planning-semantic-v5-roadmap.md](../ai/strategy/weekly-planning-semantic-v5-roadmap.md)
- Schema overview: [weekly-planning-semantic-schema-v5.md](weekly-planning-semantic-schema-v5.md)
- Code generation index: [weeklyPlanningSemanticSchemaGenerations.ts](../../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticSchemaGenerations.ts)

この文書は、コード上に存在するsemantic schemaとPlanningFactGraphの世代、依存関係、production利用状況、廃止条件を管理する正本である。現在確認できる事実と将来の移行提案を分離して記録する。

schema識別子、JSON Schema名、TypeScript型名、直接依存、production未接続・未保存という現在事実はcode generation indexでも固定する。このindexはmetadata onlyであり、production runtimeがresponse formatやdecoderを動的選択するために使用してはならない。文書上の責務、廃止条件、migration順序は本registryを正とする。

## 1. 現在確認できるsemantic schema世代

| schema識別子 | TypeScript型 | JSON Schema名 | 状態 | 主な責務 | 前世代との差分 | 実装依存 | production利用 | persisted data | real-eval | 後継 | 廃止条件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `planning-semantic-v0` | `SemanticPlanningDocument` | `weekly_planning_semantic_document_v0` | experiment / legacy-eval | generic task、study component、workload、schedule constraint、recurrence、relation、planning window、uncertaintyを評価する最初の汎用schema | 起点。所要時間をschedule constraint内のdurationとして扱い、correction、decision、全nodeのlocal IDは持たない | 独立した実験module。V5 runtimeからのimportなし | 未接続 | production保存なし。eval artifact生成のみ | env-gated runnerあり。本調査では再実行していない | `planning-semantic-v1` | v0固有fixtureと比較指標を再現可能なlegacy-eval領域へ移し、不要性を確認した後 |
| `planning-semantic-v1` | `SemanticPlanningDocumentV1` | `weekly_planning_semantic_document_v1` | experiment / legacy-eval | pre-V5の汎用task schemaとしてworkload、effort estimate、temporal constraint、recurrenceを評価する | schedule constraintをeffort estimateとtemporal constraintへ分離し、workloadへ`periodExpression`を追加 | 独立した実験module。Alpha世代からのruntime importなし | 未接続 | production保存なし。eval artifact生成のみ | env-gated runnerとtargeted runnerあり。本調査では再実行していない | V5 Alpha 1 | v1固有fixture、評価case、過去reportの再現手段をlegacy-eval領域へ移し、Stable評価で代替可能と確認した後 |
| `weekly-planning-semantic-v5-alpha1` | `WeeklyPlanningSemanticDocument` | `weekly_planning_semantic_document_v5_alpha1` | active foundation / legacy runtime dependency | response-local ID、quantity role、correction、decisionを含むV5基礎document | pre-V5実験から型とvalidatorを閉じ、全nodeのlocal ID、参照整合、correction、decision、strict response formatを追加 | Alpha 2の型、JSON Schema、prompt、validator、canonicalizerの直接依存先 | production未接続。Alpha 2内部依存とmodule testで使用 | production保存なし | unit/module testあり。専用の現行real-evalは未確認 | Alpha 2、Stable V5 | Alpha 2 runtime依存をStableへ切替え、Alpha fixtureの保存先を確保し、rollback観察を終えた後 |
| `weekly-planning-semantic-v5-alpha2` | `WeeklyPlanningSemanticDocumentV2` | `weekly_planning_semantic_document_v5_alpha2` | draft / active foundation / legacy module path | Alpha 1へconstraint level、named time period、task date rule、plan-wide availability、external source requestを追加する | `constraintLevel`、`namedTimePeriod`、`allowed_date`、`excluded_date`、`availabilityDeclarations`、`constraintSourceRequests`を追加 | Alpha 1 schema clone、Alpha 1 prompt append、Alpha 1 validator/canonicalizerへのprojectionに依存 | production未接続。resolver、scheduler input、dialogue policyまでの旧V5 module導線で使用 | production保存なし | Alpha 2 date real-eval harnessあり。実AI未実施 | Stable V5 | Stableのfull test、real-eval、shadow、migration rehearsal、cutover、rollback観察後 |
| `weekly-planning-semantic-v5` | `WeeklyPlanningSemanticDocumentV5` | `weekly_planning_semantic_document_v5` | stable / parallel module implementation | Alpha 1基礎構造とAlpha 2追加構造を一つのstrict schema、direct prompt、direct validatorで表す | Alpha schema clone、prompt append、validator projectionを廃止し、Stable rootを直接定義 | Alpha 1 / Alpha 2をimportしない。calendar syntax validator等の世代非依存pure helperだけを利用 | production未接続。normalizer、direct validator、direct canonicalizer、read-only shadow module、real-eval harnessで使用 | production保存なし。Fact Graph V5 persistence未実装 | Stable専用harness実装済み。実AI real-evalは未確認 | 将来のV6または互換変更 | production cutover後も現行stableとして維持。後継schemaとmigrationが成立するまで削除不可 |

## 2. 現在確認できるFact Graph世代

| graph識別子 | TypeScript型 | 状態 | 主な責務 | 前世代との差分 | 実装依存 | production利用 | persisted data | 後継 | 廃止条件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `weekly-planning-fact-graph-v1` | `WeeklyPlanningFactGraph` | active foundation / legacy runtime dependency | task、study context、component、workload、effort、temporal constraint、recurrence、relation、uncertainty、correction intent、decision intentを正式IDとrevisionで保持する | 起点 | Graph V2が型継承し、V2 canonicalizerがV1へprojectする | production未接続 | production保存なし | Graph V2、Stable V5 | Alpha 2 / Graph V2 runtime依存削除とrollback観察後 |
| `weekly-planning-fact-graph-v2` | `WeeklyPlanningFactGraphV2` | draft / active foundation / legacy module path | Graph V1へconstraint level、named time period、task date rule、availability declaration、constraint source requestを追加する | temporal constraintを拡張し、3種類のfact collectionを追加 | Graph V1型とV1 canonicalizerへ依存 | production未接続。既存resolver、generic scheduler input、dialogue policyで使用 | production保存なし | Fact Graph V5 | resolver共通read境界、Stable shadow、migration rehearsal、cutover、rollback観察後 |
| `weekly-planning-fact-graph-v5` | `WeeklyPlanningFactGraphV5` | stable / parallel module implementation | 現在必要な全collectionを継承なしで直接列挙し、Stable canonicalizerのatomic出力を保持する | Graph V1/V2継承と旧graph projectionを廃止 | Alpha graphをimportしない。Stable document型だけを参照 | production未接続。direct canonicalizerとread-only shadow内で使用 | production保存なし。serializer、decoder、migration未実装 | 将来のgraph version | persisted formatまたはlifecycle変更の後継graphとmigrationが成立するまで削除不可 |

## 3. 現在の実行時依存と並列Stable実装

Alpha 2導線は引き続き次の依存を持つ。

```text
WeeklyPlanningSemanticDocumentV2
  → Alpha 1 type / prompt / JSON Schema

Alpha 2 validator
  → Alpha 1へprojection
  → Alpha 1 validator
  → Alpha 2追加field検証

Alpha 2 canonicalizer
  → documentとGraph V2をV1へprojection
  → V1 canonicalizer
  → Alpha 2追加fact付加

WeeklyPlanningFactGraphV2
  → WeeklyPlanningFactGraphを型継承
```

このためAlpha 1とFact Graph V1は、Stable実装が追加された現在もAlpha 2 moduleのbuild/runtime依存として必要である。production cutover前に削除してはならない。

Stable V5は別の並列導線として次まで直接実装されている。

```text
WeeklyPlanningSemanticDocumentV5
→ strict Stable response schema
→ direct Stable validator
→ Stable semantic normalizer
→ direct Stable canonicalizer
→ WeeklyPlanningFactGraphV5
→ read-only Stable shadow report
```

Stable導線はAlpha schema、Alpha validator、Alpha canonicalizer、旧Fact Graphをimportまたはprojectionしない。`planning-semantic-v0`と`planning-semantic-v1`は引き続き記録用依存であり、どちらの現行module導線にも入らない。

## 4. production利用状況

現在のproduction会話handlerは`weekly_planning_interpreted_commands`をresponse formatとするtyped command interpreterを使用している。Alpha normalizerとStable V5 normalizerのどちらもproduction interpreterから参照されていない。

Alpha 2 module導線はresolver、generic scheduler input、dialogue policy、preview gateまで接続済みである。Stable V5導線はdirect Fact Graph V5とread-only shadow evaluator moduleまで実装済みだが、既存resolverとscheduler inputはGraph V2型を受け取るため、Stable V5からの共通read boundaryは未実装である。

production conversation handler、現行scheduler、preview UI、repository、保存処理、production shadow invocationへの入口と出口はすべて未接続である。新旧semantic resultを同一turnでmergeしてはならない。

Stable shadow reportはschema version、JSON Schema name、fact graph version、normalizer/validator/canonicalizer version、normalization outcome、direct canonicalization outcome、集計件数を記録する。raw response、semantic本文、外部予定本文をreportへ含めない。moduleは実装済みだが、実AI real-evalとfull検証前にproduction turnから起動してはならない。

## 5. persisted stateの現在事実

AIのSemanticDocumentをそのまま永続化しない。現在のproduction stateはowner付きversion envelopeで保存される旧週間計画stateであり、Fact Graph V2とFact Graph V5のproduction persistenceは未実装である。

Stable V5移行はschemaVersion文字列の置換ではない。

```text
旧production PlanningState
  → version判定
  → owner / payload validation
  → accepted typed dataをmigration decoderで変換
  → Fact Graph V5を生成・検証
  → atomically persist

Alpha / Stable eval document
  → production stateへ書き込まない
  → fixtureまたはeval artifactとして保存
```

migrationなしで保存済みversionを書き換えてはならない。少なくとも`sourceStateVersion`、`sourceSchemaVersion`、`sourceFactGraphVersion`、migration version、owner、revisionを記録する。raw conversationからAIでSemanticDocumentを再生成してmigrationしてはならない。

## 6. 旧schemaを残す場所

現段階では物理移動を行わない。Stable cutoverとrollback観察後に、pre-V5 schemaとreal-evalをproduction runtimeから分離したlegacy-eval領域へ移す。

```text
src/features/weeklyPlanning/semantic/legacyEval/
  planningSemanticV0.ts
  planningSemanticV1.ts
  fixtures/
  realEval/
```

Git履歴だけを保存手段にしない。過去reportとの比較、prompt regression、評価caseの再実行に必要なfixtureとrunnerはrepository上に残す。Alpha 1 / Alpha 2は現在の旧module pathの実行依存であり、Stable V5実装済みという理由だけで削除できない。

## 7. Stable V5確定識別子

次の名称は候補段階を終え、並列Stable実装の識別子としてコード上に存在する。

```text
TypeScript document: WeeklyPlanningSemanticDocumentV5
TypeScript graph:    WeeklyPlanningFactGraphV5
schemaVersion:       weekly-planning-semantic-v5
JSON Schema name:    weekly_planning_semantic_document_v5
fact graph version:  weekly-planning-fact-graph-v5
```

これはproduction採用済みという意味ではない。識別子はStable moduleの契約として確定したが、production cutover、persistence、migration、resolver接続は未実施である。

## 8. Stable V5の境界

```text
Stable V5 response schema
→ Stable V5 direct runtime validator
→ Stable V5 normalizer with one repair maximum
→ Stable V5 direct canonicalizer
→ WeeklyPlanningFactGraphV5
→ common deterministic resolver read boundary
→ generic scheduler input
```

最初の5段は並列moduleとして実装済みである。resolver共通read boundary以降は未実装である。validator内部の世代非依存pure helper共有は許可するが、Stable documentをAlphaへprojectして合格判定してはならない。canonicalizerもStable documentまたはGraph V5を旧世代へprojectして処理してはならない。

AIは意味文書だけを生成する。readiness、質問選択、配置、preview、approval、保存判断はdeterministic coreが担当する。parser fallback、外部予定のAI生成、後段raw-text再解釈を復活させない。

## 9. real-eval、shadow、cutoverの順序

```text
1. registryとStable V5 contractを固定                 完了
2. direct schema / validator / canonicalizer / graph  module実装完了
3. automated compatibility testとfull build           test追加済み / full実行未確認
4. Stable V5専用real-eval                              harness実装済み / 実AI未確認
5. production stateへ書かないStable shadow接続         module実装済み / production未接続
6. resolver共通read境界、migration decoder、dry-run     未実装
7. scheduler adapter、renderer、保存migration rehearsal 未実装
8. executor単位production cutover                       未実装
9. rollback観察後のlegacy runtime削除                   未実装
```

実AIを実行していない場合はreal-eval成功と記録しない。GitHub Actionsがstep開始前に失敗し、logもartifactもない場合は実行基盤失敗であり、AI評価失敗ではない。

## 10. rollback

shadowはread-onlyであり、rollback対象のproduction stateを作らない。cutover後にStable V5 graphを保存し始めた場合、旧executorへ無条件に戻すと新graphを読めないため、単純なfeature flag reversalは不十分である。

- 旧executorがStable V5 persisted graphを読まない。
- Stable V5へ移行済みsessionを旧形式へdowngrade保存しない。
- rollback時も同一turnで旧commandと新factをmergeしない。
- migration前の旧payloadは監査可能な期間だけ保持する。
- Stable V5 readerは既知の旧versionを読むforward migrationを持つ。

## 11. 互換性を保証するtest

現在追加済みのtestは次を固定する。

- schema identifier、TypeScript世代、JSON Schema nameの一意性。
- Alpha 2がAlpha 1へ追加したroot fieldとtemporal field。
- Stable V5がAlpha 2と同じfield集合を直接定義すること。
- Alpha 1、Alpha 2、Stable V5のschemaVersion分離。
- Stable validatorが代表的Stable documentを直接受理し、不正date ruleをrejectすること。
- Stable canonicalizerがtemporal constraint、task date rule、availability、source requestを一transactionでGraph V5へ保存すること。
- duplicate turn、revision、validation failure時のatomic behavior。
- Stable normalizerの最大一回repair、provider failure、parser fallbackなし、raw response非保存。
- Stable shadow reportのversion metadata、semantic/fact counts、canonicalization outcome、raw semantic本文非保存。

未実施またはfull repositoryで未確認のtestは次である。

- Alpha共通subsetにおける旧canonicalizerとStable canonicalizerの完全fact等価性。
- Graph V5を既存resolver、scheduler inputへ渡した後のsource fact refsとdate eligibility回帰。
- old persisted fixture migration、idempotency、owner、rollback marker。
- repository全体のsemantic test、Worker routing、`tsc --noEmit`、production build。
- Stable V5実AI real-eval。

## 12. 廃止判断

```text
Stable V5 direct implementation
→ full compatibility test
→ Stable real-eval
→ production read-only shadow
→ resolver / migration / cutover rehearsal
→ production cutover
→ rollback observation
→ Alpha 1 / Graph V1 runtime依存削除
→ Alpha 2 / Graph V2 runtime依存削除
→ pre-V5 evalのlegacy-eval整理
```

Stable V5 moduleが実装された現在も、production cutoverとrollback観察が終わっていないため、どの旧世代も削除しない。
