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
  → SemanticTurnDocument V5
  → direct runtime validation
  → direct deterministic canonicalizer
  → PlanningFactGraph V5
  → common resolver read boundary
  → work demand / date eligibility / availability / commitment compilation
  → readiness / acknowledgement / question policy
  → scheduler / preview / approval / save
```

Stable V5はFact Graph V5まで並列module実装済みである。common resolver read boundary以降、production handler、UI、repository、保存処理は未接続である。

## 2. Gate

### V5-A: documents and decisions

Status: complete

- architecture v5、schema overview、availability architecture、current contract v5、migration task、roadmapを正本化する。
- typed commandとexam専用stateが新しい正本ではないことを明記する。
- API実験と外部予定取得契約の判断を記録する。
- schema registryでpre-V5、Alpha 1、Alpha 2、Stable V5、Fact Graph V1/V2/V5の責務と廃止条件を固定する。
- schema generation code indexで識別子、型名、JSON Schema名、直接依存、production未接続・未保存を固定する。

### V5-B: stable semantic document

Status: direct Stable V5 module implemented / full verification and real-eval pending

- [x] generic task、component、workload、effort、temporal、recurrence、relationを分離する。
- [x] constraint level、availability declaration、named time period、external source requestを扱う。
- [x] non-consecutive explicit datesを一日ごとのdate ruleとして保持する。
- [x] weekday rangeをcanonical weekday集合へ展開し、一つのrecurrence factへ保持する。
- [x] local ID、ref、cycle、category/study整合をclosed validatorで検証する。
- [x] 日本語日時をAI境界でcanonical tokenへ変換し、後段で再解析しない。
- [x] Alpha 1の基礎fieldとAlpha 2の追加fieldを一つのStable V5 schemaへ直接定義する。
- [x] Stable V5 response schemaをAlpha 1 cloneなしで直接構築する。
- [x] Stable V5 system/user promptをAlpha 1 appendなしで直接定義する。
- [x] Stable validatorをAlpha 1 projectionなしで直接実装する。
- [x] `WeeklyPlanningSemanticDocumentV5`、`weekly-planning-semantic-v5`、`weekly_planning_semantic_document_v5`をStable識別子として確定する。
- [x] 最大一回repair、provider failure fail-closed、parser fallbackなしのStable normalizerを追加する。
- [ ] repository全体のschema/validator/normalizer testとfull buildを通す。
- [ ] Stable V5専用schemaで実AI real-evalを実行する。

### V5-C: PlanningFactGraph

Status: direct Fact Graph V5 and canonicalizer implemented / resolver, lifecycle, migration pending

- [x] 正式fact IDとrevisionをcoreが発行する。
- [x] SemanticTurnDocumentをatomicにcanonicalizeする。
- [x] 不完全なfactを保持する。
- [x] task date rule、recurrence、availability declaration、source request、constraint level、named time periodを正式factへ保持する。
- [x] `WeeklyPlanningFactGraphV5`と`weekly-planning-fact-graph-v5`を確定し、全collectionを継承なしで直接定義する。
- [x] Stable canonicalizerをdocument/graphのV1 projectionなしで直接実装する。
- [x] duplicate turn、expected revision、fact ID collision、validation failure時のatomic rejectionを維持する。
- [ ] Graph V5を受け取る世代非依存resolver read interfaceを実装する。
- [ ] resolver、scheduler input、dialogue policyのGraph V5回帰を追加する。
- [ ] correction/delete/proposal decisionへ使うstable public refとactive/superseded/removed lifecycleを実装する。
- [ ] serializer、decoder、old persisted state migrationを実装する。

### V5-D: shadow normalizer

Status: Stable V5 read-only module implemented / production invocation pending

- [x] Alpha 1固定shadow evaluatorをproductionへ流用しない。
- [x] Stable V5 normalizerとFact Graph V5を使用するread-only shadow evaluator moduleを追加する。
- [x] semantic schema version、JSON Schema name、fact graph version、normalizer/validator/canonicalizer versionを記録する。
- [x] normalization outcome、direct canonicalization outcome、request bytes、latency、repair、validation/canonicalization errorを記録する。
- [x] task date rule、availability、source requestを含むsemantic/fact件数を記録する。
- [x] raw response、semantic本文、external予定本文をreportへ保存しない。
- [x] provider failureでparserへfallbackしない。
- [ ] Stable V5 real-evalとfull automated test成功後にfeature flag付きproduction shadow callを接続する。
- [ ] production shadowのsampling、retention、privacy、timeout budgetを固定する。

### V5-E: scheduler input foundation

Status: V2 foundation complete / Stable common graph boundary and old scheduler adapter pending

- [x] generic work demandを生成する。
- [x] page、problem、word、chapter、minute、exam_year、customを同一contractで扱う。
- [x] ordinalとactual valueを分離する。
- [x] estimated minutes不足をreadinessへ返す。
- [x] user availability、external occupied event、fixed task reservationを解決する。
- [x] multiple allowed dates、excluded dates、task-level weekday recurrenceをtask date eligibilityへ解決する。
- [x] recurrence由来の候補日からexact excluded dateを差し引く。
- [x] 明示allowed/excludedの直接衝突だけをblocking conflictとする。
- [x] work demand、date eligibility、reservation、availability、relation、planning windowを単一scheduler inputへ統合する。
- [x] fixed taskを可動work itemとblocking issueから除外する。
- [x] hard occupied/unavailable windowを必須制約として渡す。
- [ ] resolverとcompilerの入力をGraph V2固有型からcommon read interfaceへ変更する。
- [ ] Graph V5からgeneric scheduler inputまでの回帰を通す。
- [ ] existing scheduler adapterを一方向かつtemporaryに実装する。

### V5-F: dialogue/readiness integration

Status: pure V2 scheduler policy complete / Stable graph connection and renderer pending

- [x] accepted fact diffからacknowledgementを生成する。
- [x] 高影響不足を原則一件質問する。
- [x] availability/source/commitment/task-dateのblocking issueを統合する。
- [x] external source failure時もconversationと入力内容を保持する。
- [x] explicit authorizationとpreview gateを維持する。
- [ ] Stable Fact Graph V5由来のdiff/readiness入力へ接続する。
- [ ] exam/general rendererを統合する。

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
V5-B stable semantic document      direct module implemented / full verification pending
V5-C PlanningFactGraph             direct graph + canonicalizer implemented / lifecycle pending
V5-D shadow normalizer             Stable read-only module implemented / production disconnected
V5-E scheduler input               V2 foundation complete / Stable common read boundary pending
V5-F dialogue integration          V2 pure policy complete / Stable connection + renderer pending
V5-FS external source acquisition  automated verified / disconnected
V5-G production cutover            not started
```

## 4. 依存順

```text
V5-A documents / schema registry                         complete
  ↓
V5-B direct Stable V5 schema / prompt / validator       module complete
  ↓
V5-C direct Fact Graph V5 / canonicalizer               module complete
  ↓
automated schema compatibility / full repository build  current gate
  ↓
Stable V5 real-eval                                     harness ready / not confirmed
  ↓
V5-D read-only production shadow connection             prohibited until prior gate
  ↓
common resolver read boundary / Graph V5 regressions
  ↓
V5-C lifecycle / persisted migration decoder / dry-run
  ↓
V5-E old scheduler adapter + V5-F renderer integration
  ↓
cutover rehearsal / rollback verification
  ↓
V5-G production cutover
  ↓
rollback observation / legacy runtime deletion
```

V5-E/V5-FSのpure moduleはStable direct実装と並行して保守できる。ただしproduction shadowはStable real-eval後、production cutoverはlifecycle、migration、authorization、approval、storage、rollback回帰の完了後に限る。

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
- AlphaとStableの二重production経路が残る。
- Graph V5をGraph V2へ無検証castしてresolverへ渡す。

## 6. 検証記録

過去のAlpha/V2基盤検証:

- GitHub Models APIでinitial generic schemaを評価済み。
- semantic全test、Worker routing、full TypeScript、Vite production buildをCloudflare Pages上でcommit `c6336f0`にて同時成功。
- 外部予定atomic retry修正はcommit `47b66f8`でsemantic全test、Worker routing、full TypeScript、Vite production buildを同時成功。
- specific-date / personalization全体はcommit `090a5eb`でsemantic全test、personalization、routing、full TypeScript、production buildを同時成功。
- non-consecutive dates / weekday setsはcommit `d9c6829`でresolver、scheduler integration、normalizer prompt、full TypeScript、production buildを同時成功。
- 通常buildへ復元したcommit `2b25994`以降のAlpha headでもfull TypeScriptとVite production buildが成功。

Stable V5追加後の現在事実:

- direct document、strict response schema、prompt、validator、Fact Graph V5、direct canonicalizer、normalizer、read-only shadow、real-eval harnessを追加した。
- schema generation test、Stable direct test、normalizer fail-closed test、shadow telemetry testを追加した。
- isolated TypeScript構造確認は実施したが、repository全体の`tsc --noEmit`、semantic test、Worker routing、Vite production buildはまだ確認済みとしない。
- Stable V5実AI real-evalは未実施または実行結果未確認である。
- GitHub Actionsがrunner step開始前にfailureとなり、step、log、artifactがない場合は実行基盤失敗と分類し、AI評価失敗またはコード不合格とは判断しない。

## 7. 記録規則

各gate開始前に、current contract v5、schema registry、Stable V5 migration plan、schema overview v5、architecture v5、availability architecture v5、本roadmap、active task MDを確認する。完了後はactive task MDまたは対応する個別task MDへ次を記録する。

- 変更ファイル
- contract上の判断
- 発見した注意点
- 検証結果
- real-eval、実行基盤、資格情報の失敗分類
- production接続状態
- 次gateへの未解決事項
