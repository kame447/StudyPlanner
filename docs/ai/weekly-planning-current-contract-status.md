# weeklyPlanning current contract status

Status: canonical / Phase 4 behavior-preserving refactor
Updated: 2026-08-11

- [current contract v5](weekly-planning-current-contract-v5.md)
- [runtime contract](weekly-planning-stable-v5-runtime-trial-contract.md)
- [main roadmap](strategy/weekly-planning-roadmap.md)
- [semantic roadmap](strategy/weekly-planning-semantic-v5-roadmap.md)
- [test philosophy](testing/weekly-planning-test-philosophy.md)
- [execution sequence](tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md)

## 1. 現在のフェーズ

PR #109でStable V5主要経路をmainへ固定し、PR #112でproductionから到達不能なlegacy interpreter/parser/runtime/semantic experiment経路を削除した。両PRともmerge後main CI greenを確認済みである。

現在はPhase 4の挙動不変リファクタだけを行う。

```text
完了: #109 merge-readiness / merge
完了: #112 legacy / 過去経路削除
現在: Stable V5挙動不変リファクタ
次:   7視点ゼロベース再棚卸し
最後: 新規改善再開
```

Phase 4では新機能、semantic意味変更、scheduler policy変更、UI workflow変更を意図的に入れない。

## 2. Stable V5 production baseline

Stable V5が唯一のproduction週間計画runtimeである。

削除済み:

- old interpreter / parser fallback
- old intake/dialogue pipeline
- semantic V1 / V2 experiment cluster
- fixed legacy runtime branch / runtime selector
- production-unreachable semantic/cutover prototypes
- obsolete fixed AI quality eval / model comparison infra

現在も残す互換層:

- 既存保存data migration decoder
- approval ledger / owner migration
- 現行trace/exportが過去保存形式を読むdecoder
- human-guided observation checkpoint helper
- repository/trace用test-support

これらは旧runtimeではない。Phase 4では必要なら命名・配置を整理するが、読み取り互換を削らない。

## 3. AI / deterministic責務

変更禁止の基準線:

- raw user text、会話文脈、訂正、quantity role、曜日・時間帯、authorization intentの意味理解はAI。
- focused / generic semanticへ分けても意味解釈はAI。
- deterministic routerはmachine stateから経路を選ぶだけで、raw user textを意味解析しない。
- validator、formal binding、Fact Graph lifecycle、revision、readiness、scheduler、preview、approval、saveはdeterministic core。
- provider/validation failureから自然言語parserへfallbackしない。

Phase 4の抽出・rename・module分割によってこの境界を変えない。

## 4. Phase 4 refactor targets

優先順:

1. current validator内部に残る`Legacy`命名・wrapper/core二層構造を現行名称へ整理
2. semantic orchestration / focused vs generic semanticの責務境界とprompt assemblyの重複整理
3. existing entity binding / canonicalization / no-op detectionの責務整理
4. Fact Graph revision / idempotency mutationの責務整理
5. runtime executor / application lifecycle / persistenceの巨大境界整理
6. dialogue decision / renderer contract整理
7. test fixture builderと重複fixture整理

各batchは小さくし、挙動差がないことを対象回帰→typecheck→必要に応じfull regression/buildで確認する。

## 5. Prompt / orchestration

汎用semantic promptへ新規ルールを追加しない。既存prompt内容を分割・共通化する場合もserialized request budgetを悪化させない。

focused semanticの適用範囲拡大は挙動変更なのでPhase 4では行わない。作成許可focused semanticなど既存経路の責務を整理するだけとする。

## 6. Testing contract

自動テストは決定論的内部契約を保証する。

Phase 4で禁止:

- AIの特定日本語返答をexpectedにする
- 固定scenarioのsemantic結果を品質PASSにする
- refactorを通すために有効な回帰testを削る
- prompt budget上限を緩める

renameやmodule splitでtest importだけ変える場合も、testの意味は維持する。

## 7. 各batchの7視点監査

1. AI意味理解責務 / orchestration / prompt
2. state / Fact Graph / revision / idempotency
3. dialogue / pending question / renderer
4. scheduler / preview / correction / approval / save
5. test妥当性 / regression coverage
6. trace / checkpoint / persistence / recovery
7. CI / dependency / build / operational safety

新しい仕様問題を見つけても、データ破壊・security・save不整合等のBLOCKERでなければPhase 5 backlogへ記録し、Phase 4で挙動変更しない。

## 8. Phase 4完了条件

- production current coreに歴史的wrapper/duplicate責務が不必要に残っていない。
- semantic ownership境界がコード構造から追いやすい。
- validator / canonicalizer / graph mutation / runtime executorの責務が明確。
- prompt budgetが悪化していない。
- deterministic regression coverageを維持。
- typecheck / full Vitest / production build / diff check green。
- refactor PRの7視点監査でBLOCKER/MAJORなし。

完了後にmainへmergeし、merge後main CI greenを確認してからPhase 5の7視点再棚卸しへ進む。
