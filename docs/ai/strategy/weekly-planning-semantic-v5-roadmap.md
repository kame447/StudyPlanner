# 週間計画 汎用意味モデル v5 ロードマップ

Status: canonical / active migration queue
最終更新: 2026-07-22

- Current contract: [weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
- Schema overview: [weekly-planning-semantic-schema-v5.md](../../architecture/weekly-planning-semantic-schema-v5.md)
- Architecture: [weekly-planning-dialogue-architecture-v5.md](../../architecture/weekly-planning-dialogue-architecture-v5.md)
- Availability architecture: [weekly-planning-availability-architecture-v5.md](../../architecture/weekly-planning-availability-architecture-v5.md)
- Active task: [20260722-weekly-planning-generic-semantic-v5-migration.md](../tasks/20260722-weekly-planning-generic-semantic-v5-migration.md)
- External source record: [20260722-weekly-planning-external-source-atomic-retry.md](../tasks/20260722-weekly-planning-external-source-atomic-retry.md)
- Specific date / personalization record: [20260722-weekly-planning-specific-date-and-personalization-profile.md](../tasks/20260722-weekly-planning-specific-date-and-personalization-profile.md)
- General roadmap: [weekly-planning-roadmap.md](weekly-planning-roadmap.md)

この文書はsemantic v5移行streamのqueue正本である。一般運用、privacy、approval、storage、trace等の非競合queueは従来roadmapを参照する。

## 1. 到達状態

```text
自然文
  → AI Semantic Normalizer
  → SemanticTurnDocument
  → runtime validation
  → deterministic canonicalizer
  → PlanningFactGraph
  → work / commitment / task-date / availability compilation
  → readiness / acknowledgement / question policy
  → scheduler / preview / approval / save

account profile
  → versioned personalization parameters
  → scheduler scoring modifier
```

## 2. Gate

### V5-A: documents and decisions

Status: complete

- architecture v5、schema overview、availability architecture、current contract、roadmap、work logを正本化する。
- typed commandとexam専用stateをhistoricalへ降格する。
- API実験、外部予定取得、特定日、個人最適化の判断を記録する。

### V5-B: stable semantic document

Status: alpha2 foundation complete / consolidation pending

- generic task、component、workload、effort、temporal、task-date、recurrence、relationを分離する。
- constraint level、availability declaration、named time period、external source requestを扱う。
- 一日計画、task allowed date、task excluded date、終日休みを区別する。
- local ID、ref、cycle、category/study整合をclosed validatorで検証する。
- 日本語日時をAI境界でcanonical tokenへ変換し、後段で再解析しない。
- alpha1とalpha2をproduction採用前に一つへ統合する。
- stable schemaでreal API evalを再実行する。

### V5-C: PlanningFactGraph

Status: additive foundation complete / lifecycle pending

- 正式fact IDとrevisionをcoreが発行する。
- SemanticTurnDocumentをatomicにcanonicalizeする。
- 不完全なfactを保持する。
- availability、source request、constraint level、named time period、task date ruleを正式factへ保持する。
- correction/delete/proposal decisionへ使うstable public refとlifecycleを実装する。
- old persisted state migration decoderを実装する。

### V5-D: shadow normalizer

Status: module complete / production shadow connection pending

- 現行production stateへ書き込まないshadow evaluatorを実装する。
- request bytes、latency、provider outcome、repair、parse/schema rejectionを記録する。
- provider failureでparserへfallbackしない。
- traceへraw response本文を永続化しない。
- purpose別output token上限をWorkerへ実装する。
- feature flag付きでproduction turnからshadow callを起動する。

### V5-E: scheduler input foundation

Status: v2 foundation complete / old scheduler adapter pending

- generic work demandを生成する。
- page、problem、word、chapter、minute、exam_year、customを同一contractで扱う。
- ordinalとactual valueを分離する。
- estimated minutes不足をreadinessへ返す。
- user availability、external occupied event、fixed task reservationを解決する。
- task allowed/excluded dateを解決する。
- date-only hard unavailableを終日windowへ解決する。
- work、reservation、task-date、availability、relation、planning windowを単一scheduler inputへ統合する。
- fixed taskを可動work itemとそのblocking issueから除外する。
- 特定日除外でfixed reservationが消えても可動workへ戻さない。
- hard occupied/unavailable windowを必須制約として渡す。
- existing scheduler adapterは一方向かつtemporaryにする。

### V5-F: dialogue/readiness integration

Status: pure scheduler policy complete / renderer connection pending

- accepted fact diffからacknowledgementを生成する。
- 高影響不足を原則一件質問する。
- availability/source/commitment/task-dateのblocking issueを統合する。
- 同一日のallowed/excluded conflictを勝手に解決しない。
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

### V5-P: personalization profile

Status: profile v2 storage/validation foundation complete / scoring and learning pending

- 個人最適化をSemanticTurnDocumentとPlanningFactGraphから分離する。
- profile schema、feature version、weight versionを持つ。
- time band、weekday、session length、completion、delay、interruption、reschedule、transition、sleep proximity、workload density、subject affinityを扱う。
- parameterへcontext、scope、coefficient、provenance、confidence、updatedAtを持たせる。
- coefficientをboundedにし、未知featureと不正値をsanitizeする。
- v1 profileを空placement model付きv2へ移行する。
- 全ユーザー共通weightはprofileへ複製しない。
- production schedulerへread-onlyで接続する。
- plan/actual集計からparameter候補を生成するlearning pipelineを実装する。
- 少数例、古い観測、明示設定との競合を扱う更新規則を固定する。

### V5-G: production cutover

Status: not started

- executorを新semantic pathへ一括切替する。
- 同一turnで旧commandと新factをmergeしない。
- persisted state migrationを実装する。
- 旧prompt、command、exam state、exam adapter、exam rendererを削除する。
- full tests、build、roleplay、real-eval、七視点監査を完了する。

## 3. 現在の進捗

```text
V5-A documents and decisions       complete
V5-B stable semantic document      alpha2 foundation complete
V5-C PlanningFactGraph             additive foundation complete
V5-D shadow normalizer             module complete / disconnected
V5-E scheduler input v2            foundation complete / adapter pending
V5-F dialogue integration          pure policy complete / renderer pending
V5-FS external acquisition         automated verified / disconnected
V5-P personalization profile       v2 foundation complete / scoring pending
V5-G production cutover            not started
```

## 4. 依存順

```text
V5-A
  ↓
V5-B semantic contract
  ↓
V5-C canonical graph
  ↓
V5-D shadow module
  ↓
V5-E scheduler input + V5-FS source acquisition
  ↓
V5-C lifecycle / persisted migration
  ↓
V5-D production shadow evaluation
  ↓
V5-F renderer + scheduler adapter
  ↓
V5-P read-only personalization scoring
  ↓
V5-G production cutover
  ↓
V5-P learning pipeline
```

pure moduleは並行実装可能だが、production connectionはlifecycle、migration、authorization、privacy回帰の完了後に行う。学習によるprofile更新は、read-only scoringの安全性確認後に導入する。

## 5. Merge禁止条件

次のいずれかが残る場合、production採用しない。

- 院試、過去問、年度、分野がtop-level必須構造に残る。
- AIが内部command、missing、readiness、preview、scheduler、saveを決める。
- raw textの後段parserまたはfallbackが残る。
- componentとworkloadが配列位置で対応する。
- 日付と時間帯が混在し、後段が日本語日時を再解析する。
- 一日計画を一週間へ強制拡張する。
- taskの特定日指定が破棄される。
- recurring fixed taskへexcluded dateが適用されない。
- date-only hard unavailableを時刻不足として捨てる。
- allowed/excluded conflictを無言で片方へ決める。
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
- personalization係数にversion、context、provenance、confidenceがない。
- 単発のAI発話が長期profile係数を直接上書きする。
- raw conversation本文をpersonalization profileへ保存する。
- request ownership、approval、storage回帰が失敗する。
- alpha1/alpha2の二重production経路が残る。

## 6. 検証記録

- GitHub Models APIでinitial generic schemaを評価済み。
- semantic全test、Worker routing、full TypeScript、Vite production buildをCloudflare Pages上でcommit `c6336f0`にて同時成功。
- 外部予定atomic retry修正はcommit `47b66f8`で一括成功。
- 特定日resolver単体はcommit `8913477`で成功。
- 一日計画、task例外日、終日休み、fixed reservation例外の統合テストはcommit `6514a81`で成功。
- personalization profile v2 migration/validationはcommit `86d1972`で成功。
- date-rule validationはcommit `e8c8c5c`、canonicalizerはcommit `89e8942`で成功。
- semantic全test、personalization test、Worker routing、Vite buildはcommit `69bebad`で成功。
- task-date dialogueを含むsemantic全回帰はcommit `3d6d674`で成功。
- full TypeScriptとVite production buildはcommit `a4c29be`で成功。
- temporary tsconfigはcommit `bb4d951`で削除済み。
- GitHub Actionsはrunner step開始前failureのため、Actions側の運用問題は別途解決が必要。

## 7. 記録規則

各gate開始前に、current contract、schema overview、architecture、availability architecture、本roadmap、active taskを確認する。完了後は対応するMDへ次を記録する。

- 変更ファイル
- contract上の判断
- 発見した注意点
- 検証結果
- production接続状態
- 次gateへの未解決事項
