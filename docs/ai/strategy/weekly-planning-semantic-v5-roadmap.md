# 週間計画 汎用意味モデル v5 ロードマップ

Status: canonical / active migration queue
最終更新: 2026-07-22

- Current contract: [weekly-planning-current-contract-v5.md](../weekly-planning-current-contract-v5.md)
- Architecture: [weekly-planning-dialogue-architecture-v5.md](../../architecture/weekly-planning-dialogue-architecture-v5.md)
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
  → readiness / acknowledgement / question policy
  → generic work item compiler
  → scheduler / preview / approval / save
```

## 2. Gate

### V5-A: documents and decisions

完了条件:

- architecture v5、current contract v5、migration task、roadmapを追加する。
- typed commandとexam専用stateが新しい正本ではないことを明記する。
- API実験の判断を記録する。

### V5-B: stable semantic document

完了条件:

- 実験moduleからproduction候補schema、prompt builder、runtime validatorを分離する。
- `quantityRole=declared|target|remaining|completed|unknown`を固定する。
- task、component、workload、effort、temporal、recurrence、relation、planning windowを分離する。
- local ID、ref、cycle、category/study整合を検証する。
- unit testとproperty testを通す。

### V5-C: PlanningFactGraph

完了条件:

- 正式fact IDとrevisionをcoreが発行する。
- SemanticTurnDocumentをatomicにcanonicalizeする。
- partial factを保持する。
- correction/delete/proposal decisionへ使うstable public refを定義する。
- failed validationでstate無変更を保証する。

### V5-D: shadow normalizer

完了条件:

- 現行production stateへ書き込まないshadow callを実装する。
- request bytes、latency、provider outcome、repair、parse/schema rejectionを記録する。
- provider failureでparserへfallbackしない。
- traceへraw response本文を永続化しない。

### V5-E: generic work item compiler

完了条件:

- task/component/workloadから一般work itemを生成する。
- page、problem、word、chapter、minute、exam_year、customを同一contractで扱う。
- ordinalとactual valueを分離する。
- estimated minutes不足をreadinessへ返す。
- existing scheduler adapterは一方向かつtemporaryにする。

### V5-F: dialogue/readiness integration

完了条件:

- accepted fact diffからacknowledgementを生成する。
- 高影響不足を原則一件質問する。
- exam/general rendererを統合する。
- explicit authorizationとpreview gateを維持する。

### V5-G: production cutover

完了条件:

- executorを新semantic pathへ一括切替する。
- 同一turnで旧commandと新factをmergeしない。
- persisted state migrationを実装する。
-旧prompt、command、exam state、exam adapter、exam rendererを削除する。
- full tests、build、roleplay、real-eval、七視点監査を完了する。

## 3. 現在の進捗

```text
V5-A documents and decisions       in progress
V5-B stable semantic document      not started
V5-C PlanningFactGraph             not started
V5-D shadow normalizer             not started
V5-E generic work item compiler    not started
V5-F dialogue integration          not started
V5-G production cutover            not started
```

## 4. 依存順

```text
V5-A
  ↓
V5-B
  ↓
V5-C
  ↓
V5-D shadow evaluation
  ↓
V5-E generic work items
  ↓
V5-F dialogue integration
  ↓
V5-G production cutover and deletion
```

V5-DとV5-Eのmodule実装は一部並行可能だが、production connectionはV5-C完了後に行う。

## 5. Merge禁止条件

次のいずれかが残る場合、production採用しない。

- 院試、過去問、年度、分野がtop-level必須構造に残る。
- AIが内部command、missing、readiness、preview、scheduler、saveを決める。
- raw textの後段parserまたはfallbackが残る。
- componentとworkloadが配列位置で対応する。
- partial time factが破棄または0分へ変換される。
- correctionが無関係factを破壊する。
- provider failureでstateが変わる。
- explicit authorization前にpreviewが生成される。
- request ownership、approval、storage回帰が失敗する。

## 6. 記録規則

各gate開始前に、current contract v5、architecture v5、本roadmap、active task MDを確認する。完了後はactive task MDへ次を記録する。

- 変更ファイル
- contract上の判断
- 発見した注意点
- 検証結果
- 次gateへの未解決事項
