# 週間計画 汎用意味モデル v5 ロードマップ

Status: canonical / active migration queue
最終更新: 2026-07-22

- Current contract: [weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
- Architecture: [weekly-planning-dialogue-architecture-v5.md](../../architecture/weekly-planning-dialogue-architecture-v5.md)
- Availability architecture: [weekly-planning-availability-architecture-v5.md](../../architecture/weekly-planning-availability-architecture-v5.md)
- Active task and work log: [20260722-weekly-planning-generic-semantic-v5-migration.md](../tasks/20260722-weekly-planning-generic-semantic-v5-migration.md)
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
  → generic work demand + authoritative availability
  → readiness / acknowledgement / question policy
  → scheduler / preview / approval / save
```

## 2. Gate

### V5-A: documents and decisions

Status: foundation complete

完了済み:

- architecture v5、availability architecture v5、current contract v5、migration task、roadmapを追加した。
- typed commandとexam専用stateが新しい正本ではないことを明記した。
- API実験の判断を記録した。

### V5-B: stable semantic document

Status: partially complete

完了済み:

- generic task/component/workload/effort/temporal/recurrence/relation schema。
- `quantityRole=declared|target|remaining|completed|unknown`。
- closed runtime validator、local ID/ref/cycle/category整合。
- unit/property tests。

残り:

- temporal constraint level `hard|soft|unknown`。
- explicit external constraint source request。
- stable schemaでのreal API再評価。

### V5-C: PlanningFactGraph

Status: foundation complete / lifecycle incomplete

完了済み:

- 正式fact IDとrevisionをcoreが発行する。
- SemanticTurnDocumentをatomic proposalへcanonicalizeする。
- partial factを保持する。
- failed validation/providerで元graph同一参照を返す。

残り:

- active/superseded/removed lifecycle。
- correction/delete/proposal decision実適用。
- source selection/availability facts。
- old state migration decoder。

### V5-D: shadow normalizer

Status: module complete / production disconnected

完了済み:

- 専用purpose、最大一回repair、no parser fallback。
- request bytes、latency、provider outcome、parse/schema rejection観測。
- raw responseをreportへ残さないshadow evaluator。

残り:

- feature flag付きproduction shadow接続。
- purpose別output token上限のWorker実装。
- stable schema real API eval。

### V5-E: generic work item compiler

Status: work-demand foundation complete

完了済み:

- task/component/workloadから一般work demandを生成。
- page、problem、word、chapter、minute、exam_year等を同一contractで扱う。
- ordinal/actual range、estimated minutes、unresolved issuesを分離。

残り:

- authoritative availability input。
- relation/planning window input。
- old scheduler temporary adapter。
- schedule chunk split policy。

### V5-F: dialogue/readiness integration

Status: pure policy foundation complete

完了済み:

- accepted fact diffからgrounded acknowledgement素材を生成。
- 高影響不足を原則一件質問。
- explicit authorization/current revision/missing estimateを確認するpreview gate。

残り:

- unified renderer接続。
- exam/general renderer統合。
- production question context移行。

### V5-G: production cutover

Status: not started

完了条件:

- executorを新semantic pathへ一括切替する。
- 同一turnで旧commandと新factをmergeしない。
- persisted state migrationを実装する。
- 旧prompt、command、exam state、exam adapter、exam rendererを削除する。
- full tests、build、roleplay、real-eval、七視点監査を完了する。

## 3. 現在の進捗

```text
V5-A documents and decisions       foundation complete
V5-B stable semantic document      partial
V5-C PlanningFactGraph             foundation complete / lifecycle pending
V5-D shadow normalizer             module complete / disconnected
V5-E generic work demand           foundation complete
V5-F dialogue policy               foundation complete / disconnected
V5-G production cutover            not started
```

## 4. 依存順

```text
constraint level + source request schema
  ↓
source selection / authoritative availability facts
  ↓
fact lifecycle + correction application
  ↓
old state migration decoder
  ↓
feature-flagged shadow evaluation
  ↓
scheduler one-way adapter
  ↓
unified dialogue integration
  ↓
production cutover and old-path deletion
```

## 5. Merge禁止条件

次のいずれかが残る場合、production採用しない。

- 院試、過去問、年度、分野がtop-level必須構造に残る。
- AIが内部command、missing、readiness、preview、scheduler、saveを決める。
- raw textの後段parserまたはfallbackが残る。
- componentとworkloadが配列位置で対応する。
- workloadとavailabilityが混同される。
- external予定本文をAIが再生成する。
- partial time factが破棄または0分へ変換される。
- correctionが無関係factを破壊する。
- provider failureでstateが変わる。
- explicit authorization前にpreviewが生成される。
- request ownership、approval、storage回帰が失敗する。

## 6. 検証記録

- GitHub Models APIでinitial generic schemaを評価済み。
- semantic関連unit/property tests、Worker routing test、TypeScript、production buildをCloudflare Pages上でcommit `d8e59f4`にて一括成功。
- 一時的なbuild script変更は検証後に復元済み。
- GitHub Actionsはrunner step開始前failureのため、Actions側の運用問題は別途解決が必要。

## 7. 記録規則

各gate開始前に、current contract v5、architecture v5、availability architecture v5、本roadmap、active task MDを確認する。完了後はactive task MDへ次を記録する。

- 変更ファイル
- contract上の判断
- 発見した注意点
- 検証結果
- 次gateへの未解決事項
