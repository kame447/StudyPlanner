# 週間計画 汎用意味モデル v5 ロードマップ

Status: canonical / active migration queue
最終更新: 2026-07-22

- Current contract: [weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
- Schema overview: [weekly-planning-semantic-schema-v5.md](../../architecture/weekly-planning-semantic-schema-v5.md)
- Architecture: [weekly-planning-dialogue-architecture-v5.md](../../architecture/weekly-planning-dialogue-architecture-v5.md)
- Availability architecture: [weekly-planning-availability-architecture-v5.md](../../architecture/weekly-planning-availability-architecture-v5.md)
- Active task and work log: [20260722-weekly-planning-generic-semantic-v5-migration.md](../tasks/20260722-weekly-planning-generic-semantic-v5-migration.md)
- External source retry record: [20260722-weekly-planning-external-source-atomic-retry.md](../tasks/20260722-weekly-planning-external-source-atomic-retry.md)
- General roadmap: [weekly-planning-roadmap.md](weekly-planning-roadmap.md)

この文書はsemantic v5移行streamのqueue正本である。一般運用、privacy、approval、personalization等のqueueは従来roadmapを参照する。

## 1. 到達状態

```text
自然文
  → AI Semantic Normalizer
  → SemanticTurnDocument
  → runtime validation
  → deterministic canonicalizer
  → PlanningFactGraph
  → work demand / availability / commitment compilation
  → readiness / acknowledgement / question policy
  → scheduler / preview / approval / save
```

## 2. Gate

### V5-A: documents and decisions

Status: complete

- architecture v5、schema overview、availability architecture、current contract v5、migration task、roadmapを正本化する。
- typed commandとexam専用stateが新しい正本ではないことを明記する。
- API実験と外部予定取得契約の判断を記録する。

### V5-B: stable semantic document

Status: alpha2 foundation complete / consolidation pending

- generic task、component、workload、effort、temporal、recurrence、relationを分離する。
- constraint level、availability declaration、named time period、external source requestを扱う。
- local ID、ref、cycle、category/study整合をclosed validatorで検証する。
- 日本語日時をAI境界でcanonical tokenへ変換し、後段で再解析しない。
- alpha1とalpha2をproduction採用前に一つへ統合する。
- stable alpha2 schemaでreal API evalを再実行する。

### V5-C: PlanningFactGraph

Status: additive foundation complete / lifecycle pending

- 正式fact IDとrevisionをcoreが発行する。
- SemanticTurnDocumentをatomicにcanonicalizeする。
- 不完全なfactを保持する。
- availability declaration、source request、constraint level、named time periodを正式factへ保持する。
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

Status: foundation complete / old scheduler adapter pending

- generic work demandを生成する。
- page、problem、word、chapter、minute、exam_year、customを同一contractで扱う。
- ordinalとactual valueを分離する。
- estimated minutes不足をreadinessへ返す。
- user availability、external occupied event、fixed task reservationを解決する。
- work demand、reservation、availability、relation、planning windowを単一scheduler inputへ統合する。
- fixed taskを可動work itemとそのblocking issueから除外する。
- hard occupied/unavailable windowを必須制約として渡す。
- existing scheduler adapterは一方向かつtemporaryにする。

### V5-F: dialogue/readiness integration

Status: pure scheduler policy complete / renderer connection pending

- accepted fact diffからacknowledgementを生成する。
- 高影響不足を原則一件質問する。
- availability/source/commitmentのblocking issueを統合する。
- external source failure時もconversationと入力内容を保持する。
- explicit authorizationとpreview gateを維持する。
- exam/general rendererを統合する。

### V5-FS: external source acquisition

Status: atomic retry module complete / production adapter connection pending

- 取得結果を`success(events)`または`failure(reason)`へ限定する。
- `success(events=[])`を正常な予定なしとして扱う。
- `partial`状態を上位contractから削除する。
- pagination等の途中結果を破棄する。
- timeout、network、rate limit、一時的server errorを自動再試行する。
- authentication、permission、source未設定、invalid responseは再試行せず具体的対応へ進む。
- failureを空予定として扱わない。
- failure時に計画sessionを終了せず、source依存previewだけを保留する。

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
V5-D shadow normalizer             module complete / not connected
V5-E scheduler input               foundation complete / adapter pending
V5-F dialogue integration          pure policy complete / renderer pending
V5-FS external source acquisition  atomic retry complete / disconnected
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
V5-C lifecycle / migration
  ↓
V5-D production shadow evaluation
  ↓
V5-F renderer integration
  ↓
V5-G production cutover and deletion
```

V5-Cのadditive fact foundationとV5-E/V5-FSのpure moduleは並行可能だが、production connectionはlifecycle、migration、authorization回帰の完了後に行う。

## 5. Merge禁止条件

次のいずれかが残る場合、production採用しない。

- 院試、過去問、年度、分野がtop-level必須構造に残る。
- AIが内部command、missing、readiness、preview、scheduler、saveを決める。
- raw textの後段parserまたはfallbackが残る。
- componentとworkloadが配列位置で対応する。
- 日付と時間帯が混在し、後段が日本語日時を再解析する。
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
- alpha1/alpha2の二重production経路が残る。

## 6. 検証記録

- GitHub Models APIでinitial generic schemaを評価済み。
- semantic全test、Worker routing、full TypeScript、Vite production buildをCloudflare Pages上でcommit `c6336f0`にて同時成功。
- V2 sourceとV2 test fixtureのstrict TypeScriptも分離確認済み。
- 診断用script、probe、temporary tsconfigは検証後に削除した。
- 外部予定atomic retry修正の一括検証は実行中であり、成功commitを確定後に追記する。
- GitHub Actionsはrunner step開始前failureのため、Actions側の運用問題は別途解決が必要。

## 7. 記録規則

各gate開始前に、current contract v5、schema overview v5、architecture v5、availability architecture v5、本roadmap、active task MDを確認する。完了後はactive task MDまたは対応する個別task MDへ次を記録する。

- 変更ファイル
- contract上の判断
- 発見した注意点
- 検証結果
- 次gateへの未解決事項
