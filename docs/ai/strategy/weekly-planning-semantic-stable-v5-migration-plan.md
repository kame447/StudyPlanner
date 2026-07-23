# 週間計画 Stable V5 semantic schema統合計画

Status: canonical proposal / implementation not started
最終更新: 2026-07-22

- Schema registry: [weekly-planning-semantic-schema-registry.md](../../architecture/weekly-planning-semantic-schema-registry.md)
- Current contract: [weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
- V5 roadmap: [weekly-planning-semantic-v5-roadmap.md](weekly-planning-semantic-v5-roadmap.md)
- Schema overview: [weekly-planning-semantic-schema-v5.md](../../architecture/weekly-planning-semantic-schema-v5.md)

この文書は、V5 Alpha 1とAlpha 2をStable V5へ統合するための設計とgateを定める。今回の段階では物理統合、大規模rename、production接続、保存形式変更を行わない。

## 1. 現在の問題

現在のarchitecture名称はV5である一方、TypeScript型とFact Graphは`V2`を使用している。

```text
WeeklyPlanningSemanticDocumentV2
WeeklyPlanningFactGraphV2
```

ここで`V2`はarchitectureの世代ではなく、Alpha 1に追加fieldを重ねた実装世代を表している。このままproductionへ採用すると、次の問題が残る。

- schemaVersionのV5と型名のV2が一致しない。
- Alpha 2 response schemaがAlpha 1 schema objectをcloneして変更する。
- Alpha 2 validatorがAlpha 1へprojectionして二段検証する。
- Alpha 2 canonicalizerがdocumentとgraphをV1へprojectionしてから追加factを付加する。
- Fact Graph V2がFact Graph V1を型継承する。
- Alpha 1を過去記録として分離できない。
- shadow evaluatorがAlpha 1 normalizer型に固定されている。

したがって、Stable V5化は単なるrenameではなく、schema、validator、canonicalizer、graph、telemetry、migrationの責務境界を再構成する変更である。

## 2. 名称候補と確定条件

候補は次とする。

```text
WeeklyPlanningSemanticDocumentV5
WeeklyPlanningFactGraphV5
weekly-planning-semantic-v5
weekly_planning_semantic_document_v5
weekly-planning-fact-graph-v5
```

現時点では名称をコードへ追加しない。`WeeklyPlanningSemanticDocumentV2`はnormalizer、validator、canonicalizer、resolver、scheduler input、dialogue policy、real-eval、testから参照されており、PR差分検索でも少なくとも30件の利用がある。renameコストは中程度以上である。

名称は次を満たした時点で確定する。

- Stable V5のfield集合がcurrent contractと一致する。
- Alpha 2から削除・変更するfieldがないかを確定する。
- persisted migration envelopeとgraph versionを確定する。
- shadow telemetryへ記録するversion metadataを確定する。
- 一括切替可能なimport境界を設計する。

architectureのV5と整合し、今後の追加を`V6`まで持ち越さないため、最終名称は上記V5候補を第一案とする。

## 3. Stable V5 documentの構造

Stable V5はAlpha 1の基礎構造とAlpha 2の追加構造を一つのsource of truthで直接定義する。

```text
WeeklyPlanningSemanticDocumentV5
├─ schemaVersion
├─ planningIntent
├─ planningWindow
├─ tasks
│  ├─ workloads
│  ├─ effortEstimates
│  ├─ temporalConstraints
│  │  ├─ constraintLevel
│  │  └─ namedTimePeriod
│  └─ recurrence
├─ relations
├─ availabilityDeclarations
├─ constraintSourceRequests
├─ uncertainties
├─ corrections
└─ decisions
```

Alpha 2で追加した次の概念をStable V5へ正式に吸収する。

- `hard | soft | unknown`のconstraint level。
- named time period。
- `allowed_date | excluded_date`のtask date rule。
- plan-wide availability declaration。
- timetable、existing plans、calendarの利用要求。
- canonical date expressionとcanonical weekday集合。

外部予定本文、event ID、owner、取得結果はSemanticDocumentへ入れない。AIはsource利用要求だけを出力し、authoritative dataは後段が取得する。

## 4. JSON Schemaの統合

Stable response formatは一つのschema objectとして直接構築する。

```text
WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5
  json_schema.name = weekly_planning_semantic_document_v5
  strict = true
```

Alpha 1 schemaを`JSON.parse(JSON.stringify(...))`でcloneして差分注入する方式は廃止する。shared fragmentを使用する場合も、Stable V5のroot schemaが正本となり、旧世代rootを拡張しない。

旧response formatはlegacy-evalと互換性testのために残す。production normalizerが複数schemaを選択する実装にはしない。

## 5. promptの統合

Stable V5 system promptはAlpha 1基礎promptとAlpha 2追加promptを一つの公開関数から生成する。

```text
createWeeklyPlanningSemanticSystemPromptV5()
createWeeklyPlanningSemanticUserPromptV5()
```

内部で小さな共通文を組み立てることは許可するが、Stable promptがAlpha 1 promptを呼び出して追加文を連結する依存は廃止する。

次の責務境界は維持する。

- AIはtask、quantity、time、relation、availability、correction、decision、明示的source requestを意味化する。
- AIはreadiness、質問選択、配置、preview、approval、保存を決めない。
- provider/schema failureでparser fallbackしない。
- repairは完全なJSON/schema修復を一回だけ行う。
- external timetable/calendarの内容をAIに生成させない。

## 6. validatorの一段統合

Stable V5ではpublic validatorを一段にする。

```text
validateWeeklyPlanningSemanticValueV5(value)
parseWeeklyPlanningSemanticDocumentV5(content)
```

一段とは、Alpha 1へschemaVersionを書き換え、追加fieldを削除して旧validatorへ渡すprojectionを行わないことを意味する。内部helperの再利用は可能だが、次を一回のvalidation transactionで検証する。

- exact root key。
- exact child key。
- schemaVersion。
- enum、値域、clock、canonical date、weekday。
- local IDの一意性。
- task内target参照。
- relation、correction、decision参照。
- constraint levelとkindの整合。
- named time periodとclockの排他。
- task date ruleのdate-only制約。
- availability scope。
- external source requestのclosed contract。

validation失敗時はdocumentを返さず、stateを変更しない。

## 7. canonicalizerの一段統合

Stable canonicalizerはStable documentからFact Graph V5を直接生成する。

```text
canonicalizeWeeklyPlanningSemanticDocumentV5({
  graph,
  document,
  context,
})
```

次を廃止する。

- Stable documentからAlpha 1 documentへのprojection。
- Fact Graph V5からFact Graph V1へのprojection。
- V1 canonicalizerの戻り値へ追加factを継ぎ足す二段処理。

ID生成、turn重複防止、expected revision、atomic commit、source metadataは一つのcanonical transactionで扱う。Alpha 1相当factとAlpha 2追加factのどちらか一方でも失敗した場合、revisionとgraph全体を変更しない。

## 8. Fact Graph V5

Fact Graph V5はV1/V2を継承する型ではなく、現在必要なcollectionを直接列挙する。

```text
WeeklyPlanningFactGraphV5
├─ version
├─ revision
├─ appliedTurnKeys
├─ planningWindows
├─ tasks
├─ studyContexts
├─ components
├─ workloads
├─ effortEstimates
├─ temporalConstraints
├─ taskDateRules
├─ recurrences
├─ relations
├─ uncertainties
├─ correctionIntents
├─ decisionIntents
├─ availabilityDeclarations
└─ constraintSourceRequests
```

fact lifecycleはStable cutover前に追加する。少なくともactive、superseded、removedを区別し、correction/deleteをstable public refへ実適用できる必要がある。

Fact Graph V5のversionはsemantic document versionと独立して記録する。semantic schemaが同じでもgraph lifecycleまたはserializationが変わる可能性があるためである。

## 9. old schema real-evalの保存

pre-V5とAlpha世代のreal-evalをGit履歴だけへ退避しない。次を残す。

- 入力case。
- metric定義。
- expected attachmentとrelation。
- response format。
- report reader。
- 過去reportを比較するためのschemaVersion。

Stable V5導入後は、旧runnerをlegacy-eval領域へ移す。production bundleへ入らないことをbuild graphで確認する。旧runnerを実行した場合は旧schemaの評価であることをreportへ明示し、Stable readiness判定へ流用しない。

## 10. persisted state migration

現在、SemanticDocumentとFact Graph V2はproduction保存されていない。productionに存在するのは旧PlanningState envelopeである。Stable V5 migrationは次のdecoder境界を持つ。

```text
read envelope
→ validate owner and stored version
→ select decoder by version
→ convert accepted state to Stable V5 migration input
→ create Fact Graph V5 with migration metadata
→ validate graph
→ persist new envelope atomically
```

migration metadata候補は次である。

```text
sourceStateVersion
sourceSchemaVersion
sourceFactGraphVersion
migrationVersion
migratedAt
ownerId
```

SemanticDocumentを過去の会話本文からAIで再生成してmigrationしてはならない。旧stateの確定済みtyped dataだけを決定論的に変換し、根拠が不足するfieldはunknownまたはunresolvedとして保持する。変換不能な高影響条件はユーザーへ再確認する。

migrationはidempotentにする。途中失敗時は旧envelopeを保持し、versionだけを書き換えない。

## 11. production shadowのversion記録

Stable V5 shadow reportは最低限次を記録する。

```text
semanticSchemaVersion
jsonSchemaName
factGraphVersion
normalizerBuildVersion
validatorVersion
canonicalizerVersion
outcome
attemptCount
repairAttempted
latencyMs
requestBytes
responseLengths
validationErrorCodes
canonicalizationOutcome
```

raw response、raw conversation本文、外部予定本文はtraceへ保存しない。shadowはproduction state、preview、repository、schedulerを変更しない。

現在のAlpha 1 shadow evaluatorをそのまま接続してはならない。Stable V5追加fieldのcountとcanonicalization結果を扱う新reportへ置き換える。

## 12. rollback

production cutoverはexecutor単位で行い、同一turnで旧commandと新factをmergeしない。

cutover前はread-only shadowなので、feature flagを無効化すれば旧production経路へ戻せる。cutover後にStable V5 graphを保存したsessionについては、旧executorへ無条件に戻さない。

rollback設計は次とする。

- sessionへcutover generationを記録する。
- 旧generation sessionだけ旧executorで継続できる。
- Stable V5へ移行済みsessionはStable readerを維持するか、明示的に新sessionを開始する。
- Stable graphを旧stateへdowngrade保存しない。
- rollback中もpreview ownership、approval idempotency、owner boundaryを維持する。
- migration前payloadを監査期間中保持する。

## 13. schema互換性test

Stable V5実装時に次を追加する。

### identifier contract

- 全schemaVersionが一意である。
- 全JSON Schema nameが一意である。
- document typeとresponse formatの対応を固定する。
- wrong generationのschemaVersionをrejectする。

### Alpha 1 / Alpha 2差分

- Alpha 2 rootがAlpha 1 rootを欠落させていない。
- Alpha 2追加root fieldがavailabilityとsource requestだけであることを意図的に固定する。
- temporal constraintの追加fieldと追加kindを固定する。
- Alpha 1 projectionで失われるfieldを一覧化する。

### Stable V5 parity

- Alpha 1共通subsetをStable V5が同じfactへ変換する。
- Alpha 2のvalid fixtureをStable V5が受理する。
- task date rule、availability、source requestをprojectionなしでgraphへ保存する。
- invalid date、weekday、constraint level、referenceを同じか厳しい基準でrejectする。
- duplicate turnとrevision conflictでgraphを変更しない。

### resolver / scheduler parity

- availability window。
- fixed commitment reservation。
- allowed/excluded date。
- weekday recurrence。
- exact exclusion。
- source fact refs。
- blocking issue。
- generic scheduler input。

### persistence / rollback

- old fixture migration。
- owner mismatch rejection。
- corrupt payload rejection。
- migration idempotency。
- interrupted migration rollback。
- Stable generationを旧executorへ渡さないguard。

## 14. 実装gate

### S0: 世代固定

Status: complete in this task

- schema registryを追加する。
- current factsとfuture proposalを分離する。
- Alpha 1がruntime dependencyであることを明記する。
- Alpha 1 shadow evaluatorの制約を明記する。
- schema世代固定testを追加する。

### S1: direct Stable contract

Status: not started

- Stable V5 document型とresponse formatを追加する。
- Alpha 1をimportしないdirect schemaを構築する。
- Stable promptを一本化する。
- production importは変更しない。

### S2: direct validator / graph / canonicalizer

Status: not started

- direct validatorを追加する。
- Fact Graph V5を追加する。
- direct canonicalizerを追加する。
- Alpha 1 / V1 projectionを使用しない。
- resolverとscheduler inputをV5 graphへ適合させる。

### S3: compatibility and real-eval

Status: not started

- automated parity testを完了する。
- semantic、validator、canonicalizer、graph、resolver、scheduler input、Worker routing、TypeScript、production buildを通す。
- Stable V5専用real-evalを実行する。
- 実AI未実行なら成功扱いしない。

### S4: production shadow

Status: not started

- Stable normalizerをfeature flag付きread-only shadowへ接続する。
- Stable schemaとgraph versionを記録する。
- current executor、scheduler、preview、repository、保存を変更しない。
- latency、repair率、validation rejection、canonicalization rejectionを評価する。

### S5: migration rehearsal

Status: not started

- old PlanningState decoderを実装する。
- production copyまたは匿名化fixtureでdry-runする。
- migration不能率と再確認項目を測定する。
- rollback markerを検証する。

### S6: production cutover

Status: not started

- temporary one-way scheduler adapterを完成する。
- rendererとpreview gateを接続する。
- executorをsession generation単位で一括切替する。
- owner、approval、storage、reload回帰を通す。
- PRをDraftから外す判断はfull roleplay、real-eval、七視点監査後に行う。

### S7: legacy整理

Status: not started

- rollback観察期間を完了する。
- Alpha 1 / Graph V1 runtime dependencyを削除する。
- Alpha 2 / Graph V2 runtime dependencyを削除する。
- pre-V5 evalをlegacy-evalへ移す。
- unused production bundle inclusionを確認する。

## 15. 今回行わないこと

- Alpha 1とAlpha 2の物理統合。
- `V2`から`V5`への大規模rename。
- production conversation handlerへの接続。
- 現行schedulerへの切替。
- UI、repository、保存形式の変更。
- persisted schema versionの書換え。
- parser fallbackの復活。
- AIによるreadiness、質問、配置、保存判断。
- 実AI未実行状態でのreal-eval成功記録。
