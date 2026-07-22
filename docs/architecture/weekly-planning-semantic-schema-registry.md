# 週間計画 semantic schema registry

Status: canonical / current generation registry
最終更新: 2026-07-22

- Current contract: [weekly-planning-current-contract-v5.md](../ai/weekly-planning-current-contract-v5.md)
- Stable V5 migration plan: [weekly-planning-semantic-stable-v5-migration-plan.md](../ai/strategy/weekly-planning-semantic-stable-v5-migration-plan.md)
- V5 roadmap: [weekly-planning-semantic-v5-roadmap.md](../ai/strategy/weekly-planning-semantic-v5-roadmap.md)
- Schema overview: [weekly-planning-semantic-schema-v5.md](weekly-planning-semantic-schema-v5.md)
- Code generation index: [weeklyPlanningSemanticSchemaGenerations.ts](../../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticSchemaGenerations.ts)

この文書は、コード上に存在するsemantic schemaとPlanningFactGraphの世代、依存関係、production利用状況、廃止条件を管理する正本である。現在確認できる事実と将来の統合提案を分離して記録する。

schema識別子、JSON Schema名、TypeScript型名、直接依存、production未接続・未保存という現在事実はcode generation indexでも固定する。このindexはmetadata onlyであり、production runtimeがresponse formatやdecoderを動的選択するために使用してはならない。文書上の責務、廃止条件、migration順序は本registryを正とする。

## 1. 現在確認できるsemantic schema世代

| schema識別子 | TypeScript型 | JSON Schema名 | 状態 | 主な責務 | 前世代との差分 | 実装依存 | production利用 | persisted data | real-eval | 後継 | 廃止条件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `planning-semantic-v0` | `SemanticPlanningDocument` | `weekly_planning_semantic_document_v0` | experiment / legacy-eval | generic task、study component、workload、schedule constraint、recurrence、relation、planning window、uncertaintyを評価する最初の汎用schema | 起点。所要時間はschedule constraint内のdurationとして扱い、correction、decision、全nodeのlocal IDは持たない | 独立した実験module。V5 runtimeからのimportは確認されていない | 未接続 | production保存なし。実行時にeval report artifactを生成し得る | env-gated runnerあり。過去のAPI評価記録はあるが、本調査ではartifactと成功結果を再確認していない | `planning-semantic-v1` | v0固有fixtureと比較指標をv1以降で再現でき、履歴評価runnerをproduction source treeから分離した後 |
| `planning-semantic-v1` | `SemanticPlanningDocumentV1` | `weekly_planning_semantic_document_v1` | experiment / legacy-eval | pre-V5の汎用task schemaとしてworkload、effort estimate、temporal constraint、recurrenceを評価する | v0のschedule constraintをeffort estimateとtemporal constraintへ分離し、workloadへ`periodExpression`を追加 | 独立した実験module。Alpha 1、Alpha 2からのruntime importは確認されていない | 未接続 | production保存なし。targetedを含むeval report artifactを生成し得る | env-gated runnerとtargeted runnerあり。本調査では実AIを実行していない | V5 Alpha 1 | v1固有fixture、評価case、過去reportの再現手段をlegacy-eval領域へ移し、Stable V5の評価で代替可能と確認した後 |
| `weekly-planning-semantic-v5-alpha1` | `WeeklyPlanningSemanticDocument` | `weekly_planning_semantic_document_v5_alpha1` | active foundation | response-local ID、quantity role、correction、decisionを含むV5基礎documentを表す | pre-V5実験から型とvalidatorを閉じ、全nodeのlocal ID、参照整合、correction、decision、strict response formatを追加 | Alpha 2の型、JSON Schema、system/user prompt、validator、canonicalizerの直接依存先 | production未接続。module testとAlpha 2内部依存で使用 | production保存なし。Alpha 1 shadow report moduleは存在するがproduction未接続 | unit/module testあり。専用の現行real-eval runnerは確認できていない | V5 Alpha 2、最終的にはStable V5 | Stable V5が基礎構造を直接定義し、Alpha 2 validator/canonicalizerのprojection依存を廃止し、Alpha 1評価fixtureの保存先を確保した後 |
| `weekly-planning-semantic-v5-alpha2` | `WeeklyPlanningSemanticDocumentV2` | `weekly_planning_semantic_document_v5_alpha2` | draft / active foundation | Alpha 1へconstraint level、named time period、task date rule、plan-wide availability、external source requestを追加する | `constraintLevel`、`namedTimePeriod`、`allowed_date`、`excluded_date`、`availabilityDeclarations`、`constraintSourceRequests`を追加 | Alpha 1 response schemaをcloneして拡張し、Alpha 1へprojectしてvalidatorとcanonicalizerを再利用する | production未接続。normalizerからdialogue policy / preview gateまでのmodule内導線で使用 | production保存なし。persisted graph migration未実装 | date real-eval harnessあり。ただしrunner開始前の実行基盤失敗と資格情報不足により実AI未実行 | Stable V5 | Stable V5のdirect validator、direct canonicalizer、Fact Graph V5、互換性test、stable real-evalが成立し、shadow接続先をStable V5へ変更した後 |

## 2. 現在確認できるFact Graph世代

| graph識別子 | TypeScript型 | 状態 | 主な責務 | 前世代との差分 | 実装依存 | production利用 | persisted data | 後継 | 廃止条件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `weekly-planning-fact-graph-v1` | `WeeklyPlanningFactGraph` | active foundation | task、study context、component、workload、effort、temporal constraint、recurrence、relation、uncertainty、correction intent、decision intentを正式IDとrevisionで保持する | 起点 | Graph V2が型を継承し、V2 canonicalizerがGraph V2をV1へprojectしてV1 canonicalizerを呼ぶ | production未接続 | production保存なし。persisted migration未実装 | Graph V2、最終的にはFact Graph V5 | Stable canonicalizerがGraph V5へ直接書き込み、V2からV1へのgraph projectionが消えた後 |
| `weekly-planning-fact-graph-v2` | `WeeklyPlanningFactGraphV2` | draft / active foundation | Graph V1にconstraint level、named time period、task date rule、availability declaration、constraint source requestを加える | temporal constraintを拡張し、3種類のfact collectionを追加 | Graph V1型とV1 canonicalizerへ依存 | production未接続。resolver、generic scheduler input、dialogue policyのmodule内導線で使用 | production保存なし。migration decoder未実装 | Fact Graph V5 | Stable V5のdirect graph、migration fixture、serializer/decoder、rollback契約が成立した後 |

## 3. 現在の実行時依存

現在のAlpha 2導線は次の依存を持つ。

```text
WeeklyPlanningSemanticDocumentV2
  → Alpha 1のtypeとpromptをimport
  → Alpha 1 JSON Schemaをcloneして差分を注入

Alpha 2 validator
  → Alpha 2をAlpha 1へprojection
  → Alpha 1 validatorを実行
  → Alpha 2追加fieldを別段で検証

Alpha 2 canonicalizer
  → documentとGraph V2をV1へprojection
  → V1 canonicalizerを実行
  → Alpha 2追加factを別段で付加

WeeklyPlanningFactGraphV2
  → WeeklyPlanningFactGraphを型継承
```

したがって、Alpha 1とFact Graph V1は現在もruntime/build上必要であり、過去記録という理由だけで削除できない。

一方、`planning-semantic-v0`と`planning-semantic-v1`は実験runnerとfixtureのために必要であり、Alpha 2の実行時導線には入っていない。これらは記録用依存である。

## 4. production利用状況

現在のproduction会話handlerは`weekly_planning_interpreted_commands`をresponse formatとするtyped command interpreterを使用している。V5 Alpha 1 / Alpha 2 normalizerはproduction interpreterから参照されていない。

新V5導線はmodule間では次まで接続されている。

```text
semantic normalizer
→ strict schema
→ runtime validator
→ canonicalizer
→ PlanningFactGraph V2
→ availability / fixed commitment / task date resolver
→ generic scheduler input
→ dialogue policy / preview gate
```

ただし、production conversation handler、現行scheduler adapter、preview UI、repository、保存処理への入口と出口は未接続である。新旧semantic resultを同一turnでmergeしてはならない。

また、現行の`weeklyPlanningSemanticShadowEvaluation.ts`はAlpha 1 normalizer型に固定されている。Alpha 2追加fieldを集計せず、productionにも未接続である。Stable V5 shadow接続前に、Stable V5 normalizerとversion metadataを使用する実装へ置き換える必要がある。

## 5. persisted stateの現在事実

AIのSemanticDocumentをそのまま永続化しないことがcurrent contractで固定されている。現在のproduction stateはowner付きversion envelopeで保存される旧週間計画stateであり、V5 Fact Graphのproduction persistenceは未実装である。

そのため、Stable V5移行で必要なのはschemaVersion文字列の置換ではない。次を別々に扱う。

```text
旧production PlanningState
  → version判定
  → owner / payload validation
  → Stable V5へ変換可能なaccepted dataをmigration decoderで変換
  → 変換不能なsessionはfail closedまたは明示的再確認

Alpha 1 / Alpha 2 eval document
  → production stateへ書き込まない
  → historical fixtureまたはeval artifactとして保存
```

migrationなしで保存済みversionを書き換えてはならない。Stable V5 persistenceを開始する場合は、少なくとも`sourceSchemaVersion`、`factGraphVersion`、migration version、owner、revisionを記録する。

## 6. 旧schemaを残す場所

現段階では物理移動を行わない。Stable V5成立後に、pre-V5 schemaとreal-evalをproduction runtimeから明確に分離したlegacy-eval領域へ移す。

候補は次である。

```text
src/features/weeklyPlanning/semantic/legacyEval/
  planningSemanticV0.ts
  planningSemanticV1.ts
  fixtures/
  realEval/
```

Git履歴だけを保存手段にしない。過去reportとの比較、prompt regression、評価caseの再実行に必要なfixtureとrunnerは、廃止判定が終わるまでrepository上に残す。

production bundleへ残す必要性はimport graphで判断する。test-onlyのpre-V5 moduleはproduction entryから未参照であることをbuild graphで確認した後に分離できる。Alpha 1はAlpha 2のruntime import先であるため、Stable V5へのdirect統合前に分離・削除してはならない。

## 7. Stable V5候補

次の名称を候補とする。

```text
TypeScript document: WeeklyPlanningSemanticDocumentV5
TypeScript graph:    WeeklyPlanningFactGraphV5
schemaVersion:       weekly-planning-semantic-v5
JSON Schema name:    weekly_planning_semantic_document_v5
fact graph version:  weekly-planning-fact-graph-v5
```

これらはruntime type、response schema、Fact Graph実装としてはまだ存在しない。code generation indexには衝突防止用のmetadata-only naming proposalとして記録している。`V2`参照がnormalizer、validator、canonicalizer、resolver、scheduler input、dialogue policy、real-eval、testへ広がっているため、単純renameは行わない。Stable V5移行計画と互換性testを先に固定し、direct実装の追加後に参照を一括切替する。

## 8. Stable V5の正しい境界

Stable V5はAlpha 1をimportして拡張するschemaではなく、Alpha 1の基礎fieldとAlpha 2の追加fieldを一つの正本で直接定義する。

```text
Stable V5 response schema
→ Stable V5 direct runtime validator
→ Stable V5 direct canonicalizer
→ WeeklyPlanningFactGraphV5
→ existing deterministic resolvers
```

validator内部の小さなpure helperは共有してよいが、Stable V5をAlpha 1へprojectionして合格判定してはならない。canonicalizerもStable V5 documentまたはGraph V5を旧世代へprojectionして処理してはならない。

AIは意味文書だけを生成する。readiness、質問選択、配置、preview、approval、保存判断は引き続きdeterministic coreが担当する。parser fallback、外部予定のAI生成、後段raw-text再解釈を復活させない。

## 9. real-eval、shadow、cutoverの順序

順序は次で固定する。

```text
1. registryとStable V5 contractを固定
2. direct schema / validator / canonicalizer / Fact Graph V5を実装
3. automated compatibility testとfull buildを通す
4. Stable V5専用real-evalを実行
5. production stateへ書き込まないStable V5 shadowを接続
6. shadow結果を分析し、migration decoderとdry-runを完了
7. scheduler adapter、renderer、保存migrationを含むcutover rehearsal
8. executor単位でproduction cutover
9. rollback期間後にlegacy runtime依存を削除
```

実AIを実行していない場合はreal-eval成功と記録しない。GitHub Actionsがstep開始前に失敗し、logもartifactもない場合は実行基盤失敗であり、AI評価失敗ではない。

## 10. rollback

shadowはread-onlyであり、rollback対象のproduction stateを作らない。cutover後にStable V5 graphを保存し始めた場合、旧executorへ無条件に戻すと新graphを読めないため、単純なfeature flag reversalは不十分である。

rollbackはsession単位のcutover markerを持ち、次を守る。

- 旧executorがStable V5 persisted graphを読まない。
- Stable V5へ移行済みsessionを旧形式へdowngrade保存しない。
- rollback時も同一turnで旧commandと新factをmergeしない。
- migration前の旧payloadは監査可能な期間だけ保持する。
- Stable V5 readerは既知の旧versionを読むforward migrationを持つ。

## 11. 互換性を保証するtest

Stable V5導入前後で次を固定する。

- schema identifier、TypeScript世代、JSON Schema nameの一意性。
- Alpha 2がAlpha 1の基礎root fieldを保持し、追加fieldだけを増やしていること。
- Stable V5がAlpha 2の受理すべきdocumentをdirect validatorで受理すること。
- Alpha 1、Alpha 2、Stable V5のschemaVersion取り違えをrejectすること。
- Alpha 1相当の共通subsetで、旧canonicalizerとStable canonicalizerのfact内容が等価であること。
- Alpha 2追加fieldがStable V5でprojectionなしにFact Graph V5へ保存されること。
- resolverとscheduler inputのsource fact refs、date eligibility、availability、commitmentが変化しないこと。
- old persisted fixtureをmigrationした結果がowner、revision、fact ID、source versionを保持すること。
- migrationの再実行がidempotentであること。
- rollback markerに反する旧経路適用を拒否すること。

現時点では、最初の2項、Alpha 1からAlpha 2への直接依存、Fact Graph V2からV1への直接依存、全現行世代のproduction未接続・未保存、Stable V5候補名との非衝突を`weeklyPlanningSemanticSchemaGeneration.test.ts`で固定済みである。Stable V5実装を必要とする残りの項目は未実施である。

## 12. 廃止判断

削除順は次とする。

```text
Stable V5 direct implementation
→ compatibility test
→ stable real-eval
→ stable shadow
→ migration / cutover rehearsal
→ production cutover
→ rollback observation
→ Alpha 1 / Graph V1 runtime依存削除
→ Alpha 2 / Graph V2 runtime依存削除
→ pre-V5 evalのlegacy-eval整理
```

Stable V5が未実装の現在は、どの世代も削除しない。
