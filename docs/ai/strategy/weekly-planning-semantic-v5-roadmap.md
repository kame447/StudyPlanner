# 週間計画 汎用意味モデル v5 ロードマップ

Status: canonical / active migration queue
最終更新: 2026-07-22

- Current contract: [weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
- Schema registry: [weekly-planning-semantic-schema-registry.md](../../architecture/weekly-planning-semantic-schema-registry.md)
- Stable V5 migration plan: [weekly-planning-semantic-stable-v5-migration-plan.md](weekly-planning-semantic-stable-v5-migration-plan.md)
- Schema overview: [weekly-planning-semantic-schema-v5.md](../../architecture/weekly-planning-semantic-schema-v5.md)
- Architecture: [weekly-planning-dialogue-architecture-v5.md](../../architecture/weekly-planning-dialogue-architecture-v5.md)
- Availability architecture: [weekly-planning-availability-architecture-v5.md](../../architecture/weekly-planning-availability-architecture-v5.md)
- Active task and work log: [20260722-weekly-planning-generic-semantic-v5-migration.md](../tasks/20260722-weekly-planning-generic-semantic-v5-migration.md)
- Specific-date / personalization record: [20260722-weekly-planning-specific-date-and-personalization-profile.md](../tasks/20260722-weekly-planning-specific-date-and-personalization-profile.md)
- External source retry record: [20260722-weekly-planning-external-source-atomic-retry.md](../tasks/20260722-weekly-planning-external-source-atomic-retry.md)
- General roadmap: [weekly-planning-roadmap.md](weekly-planning-roadmap.md)

この文書はsemantic v5移行streamのqueue正本である。一般運用、privacy、approval、personalization等のqueueは従来roadmapを参照する。schema世代、実行時依存、廃止条件はschema registryを正とし、Stable V5の物理統合手順はStable V5 migration planを正とする。

## 1. 到達状態

```text
自然文
  → AI Semantic Normalizer
  → SemanticTurnDocument
  → runtime validation
  → deterministic canonicalizer
  → PlanningFactGraph
  → work demand / date eligibility / availability / commitment compilation
  → readiness / acknowledgement / question policy
  → scheduler / preview / approval / save
```

## 2. Gate

### V5-A: documents and decisions

Status: complete

- architecture v5、schema overview、availability architecture、current contract v5、migration task、roadmapを正本化する。
- typed commandとexam専用stateが新しい正本ではないことを明記する。
- API実験と外部予定取得契約の判断を記録する。
- schema registryでpre-V5、Alpha 1、Alpha 2、Fact Graph V1/V2の責務と廃止条件を固定する。

### V5-B: stable semantic document

Status: Alpha 2 foundation complete / Stable V5 direct consolidation pending

- generic task、component、workload、effort、temporal、recurrence、relationを分離する。
- constraint level、availability declaration、named time period、external source requestを扱う。
- non-consecutive explicit datesを一日ごとのdate ruleとして保持する。
- weekday rangeをcanonical weekday集合へ展開し、一つのrecurrence factへ保持する。
- local ID、ref、cycle、category/study整合をclosed validatorで検証する。
- 日本語日時をAI境界でcanonical tokenへ変換し、後段で再解析しない。
- Alpha 1の基礎fieldとAlpha 2の追加fieldを一つのStable V5 schemaへ直接定義する。
- Stable V5はAlpha 1 response schemaのclone、Alpha 1 promptのappend、Alpha 1 validatorへのprojectionを使用しない。
- `WeeklyPlanningSemanticDocumentV5`、`weekly-planning-semantic-v5`、`weekly_planning_semantic_document_v5`は候補名とし、direct実装とmigration contractを固定してから確定する。
- Stable V5専用schemaでreal API evalを実行する。

### V5-C: PlanningFactGraph

Status: additive foundation complete / Stable V5 graph and lifecycle pending

- 正式fact IDとrevisionをcoreが発行する。
- SemanticTurnDocumentをatomicにcanonicalizeする。
- 不完全なfactを保持する。
- task date rule、recurrence、availability declaration、source request、constraint level、named time periodを正式factへ保持する。
- Stable canonicalizerはdocumentとgraphをV1へprojectionせず、Fact Graph V5へ直接書き込む。
- `WeeklyPlanningFactGraphV5`と`weekly-planning-fact-graph-v5`は候補名とし、serializationとmigration contractを固定してから確定する。
- correction/delete/proposal decisionへ使うstable public refとlifecycleを実装する。
- old persisted state migration decoderを実装する。

### V5-D: shadow normalizer

Status: Alpha 1 shadow module exists / Stable V5 production shadow connection pending

- 現行のshadow evaluatorはAlpha 1 normalizer型に固定され、Alpha 2追加fieldとcanonicalization結果を扱わないため、そのままproductionへ接続しない。
- Stable V5 normalizerとFact Graph V5を使用し、現行production stateへ書き込まないshadow evaluatorを実装する。
- semantic schema version、JSON Schema name、fact graph version、normalizer/validator/canonicalizer versionを記録する。
- request bytes、latency、provider outcome、repair、parse/schema rejectionを記録する。
- provider failureでparserへfallbackしない。
- traceへraw response本文を永続化しない。
- purpose別output token上限をWorkerへ実装する。
- Stable V5 real-evalとautomated compatibility testの成功後に、feature flag付きでproduction turnからshadow callを起動する。

### V5-E: scheduler input foundation

Status: foundation complete / old scheduler adapter pending

- generic work demandを生成する。
- page、problem、word、chapter、minute、exam_year、customを同一contractで扱う。
- ordinalとactual valueを分離する。
- estimated minutes不足をreadinessへ返す。
- user availability、external occupied event、fixed task reservationを解決する。
- multiple allowed dates、excluded dates、task-level weekday recurrenceをtask date eligibilityへ解決する。
- recurrence由来の候補日からexact excluded dateを差し引く。
- 明示allowed/excludedの直接衝突だけをblocking conflictとする。
- work demand、date eligibility、reservation、availability、relation、planning windowを単一scheduler inputへ統合する。
- fixed taskを可動work itemとそのblocking issueから除外する。
- hard occupied/unavailable windowを必須制約として渡す。
- existing scheduler adapterは一方向かつtemporaryにする。

### V5-F: dialogue/readiness integration

Status: pure scheduler policy complete / renderer connection pending

- accepted fact diffからacknowledgementを生成する。
- 高影響不足を原則一件質問する。
- availability/source/commitment/task-dateのblocking issueを統合する。
- external source failure時もconversationと入力内容を保持する。
- explicit authorizationとpreview gateを維持する。
- exam/general rendererを統合する。

### V5-FS: external source acquisition

Status: atomic retry module complete / automated verified / production adapter connection pending

- 取得結果を`success(events)`または`failure(reason)`へ限定する。
- `success(events=[])`を正常な予定なしとして扱う。
- `partial`状態を上位contractから削除する。
- pagination等の途中結果を破棄する。
- timeout、network、rate limit、一時的server error、取得例外を自動再試行する。
- authentication、permission、source未設定、invalid responseは再試行せず具体的対応へ進む。
- failureを空予定として扱わない。
- failure時に計画sessionを終了せず、source依存previewだけを保留する。

### V5-G: production cutover

Status: not started

- executorを新semantic pathへ一括切替する。
- 同一turnで旧commandと新factをmergeしない。
- persisted state migrationを実装し、versionだけを書き換えない。
- migrationをidempotentにし、owner mismatch、破損payload、途中失敗をfail closedで扱う。
- old scheduler adapterでtask date eligibilityを消費する。
- cutover generationをsessionへ記録し、Stable persisted graphを旧executorへ渡さない。
- 旧prompt、command、exam state、exam adapter、exam rendererを削除する。
- full tests、build、roleplay、Stable V5 real-eval、七視点監査を完了する。

## 3. 現在の進捗

```text
V5-A documents and decisions       complete
V5-B stable semantic document      Alpha 2 foundation complete / direct Stable consolidation pending
V5-C PlanningFactGraph             V2 additive foundation complete / direct V5 graph pending
V5-D shadow normalizer             Alpha 1 module only / Stable production shadow not connected
V5-E scheduler input               date eligibility foundation complete / adapter pending
V5-F dialogue integration          pure policy complete / renderer pending
V5-FS external source acquisition  automated verified / disconnected
V5-G production cutover            not started
```

## 4. 依存順

```text
V5-A documents / schema registry
  ↓
V5-B direct Stable V5 schema / prompt / validator
  ↓
V5-C direct Fact Graph V5 / canonicalizer
  ↓
automated schema compatibility / resolver / scheduler regression
  ↓
Stable V5 real-eval
  ↓
V5-D read-only production shadow
  ↓
V5-C lifecycle / persisted migration decoder / migration dry-run
  ↓
V5-E old scheduler adapter + V5-F renderer integration
  ↓
cutover rehearsal / rollback verification
  ↓
V5-G production cutover
  ↓
rollback observation / legacy runtime deletion
```

V5-E/V5-FSのpure moduleはStable V5 direct実装と並行して保守できる。ただしproduction shadowはStable V5 real-eval後、production cutoverはlifecycle、migration、authorization、approval、storage、rollback回帰の完了後に限る。

## 5. Merge禁止条件

次のいずれかが残る場合、production採用しない。

- 院試、過去問、年度、分野がtop-level必須構造に残る。
- AIが内部command、missing、readiness、preview、scheduler、saveを決める。
- raw textの後段parserまたはfallbackが残る。
- componentとworkloadが配列位置で対応する。
- 日付と時間帯が混在し、後段が日本語日時を再解析する。
- 非連続日が連続rangeへ変換される。
- task-level weekday recurrenceがscheduler input到達前に失われる。
- recurrence由来の候補日とexact excluded dateが誤ってblocking conflictになる。
- workloadとavailabilityが混同される。
- external予定本文をAIが再生成する。
- 不完全なtime factが破棄または0分へ変換される。
- correctionが無関係factを破壊する。
- provider failureでstateが変わる。
- external source failureを空予定として扱う。
- external sourceの途中取得結果をschedulerへ渡す。
- external source failureでconversationまたはaccepted factsを破棄する。
- fixed taskが可動work itemとして二重配置される。
- hard occupied/unavailable windowへwork itemを配置できる。
- explicit authorization前にpreviewが生成される。
- request ownership、approval、storage回帰が失敗する。
- Stable schemaがAlpha 1 schema cloneまたはAlpha 1 validator projectionへ依存する。
- Stable canonicalizerが旧documentまたは旧graphへprojectionする。
- Alpha 1固定shadow evaluatorをproductionへ接続する。
- schema version、fact graph version、migration versionを記録しない。
- migrationなしでpersisted versionを書き換える。
- alpha1/alpha2の二重production経路が残る。

## 6. 検証記録

- GitHub Models APIでinitial generic schemaを評価済み。
- semantic全test、Worker routing、full TypeScript、Vite production buildをCloudflare Pages上でcommit `c6336f0`にて同時成功。
- 外部予定atomic retry修正はcommit `47b66f8`でsemantic全test、Worker routing、full TypeScript、Vite production buildを同時成功した。
- specific-date / personalization全体はcommit `090a5eb`でsemantic全test、personalization、routing、full TypeScript、production buildを同時成功した。
- non-consecutive dates / weekday setsはcommit `d9c6829`でresolver、scheduler integration、normalizer prompt、full TypeScript、production buildを同時成功した。
- 通常buildへ復元したcommit `2b25994`以降のheadでもfull TypeScriptとVite production buildが成功している。
- 実APIで`7/8、10、11`と`水曜と金曜〜日曜`を評価するAlpha 2 real-evalは未実施である。
- GitHub Actionsはrunner step開始前failureのため、Actions側の運用問題は別途解決が必要である。step、log、artifactがないfailureをAI評価失敗と扱わない。
- schema generation固定testを追加した。実行結果は対応commitのCIまたは作業記録で成功、失敗、未実施を区別する。

## 7. 記録規則

各gate開始前に、current contract v5、schema registry、Stable V5 migration plan、schema overview v5、architecture v5、availability architecture v5、本roadmap、active task MDを確認する。完了後はactive task MDまたは対応する個別task MDへ次を記録する。

- 変更ファイル
- contract上の判断
- 発見した注意点
- 検証結果
- real-eval、実行基盤、資格情報の失敗分類
- production接続状態
- 次gateへの未解決事項
