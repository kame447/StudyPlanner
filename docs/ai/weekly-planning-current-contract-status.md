# weeklyPlanning current contract status

Status: canonical / Phase 3 legacy cleanup
Updated: 2026-08-11

- [current contract v5](weekly-planning-current-contract-v5.md)
- [runtime contract](weekly-planning-stable-v5-runtime-trial-contract.md)
- [main roadmap](strategy/weekly-planning-roadmap.md)
- [semantic roadmap](strategy/weekly-planning-semantic-v5-roadmap.md)
- [test philosophy](testing/weekly-planning-test-philosophy.md)
- [execution sequence](tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md)

## 1. 現在のフェーズ

PR #109は監査済みheadをsquash mergeし、merge後main CIもgreenである。

現在はPhase 3のlegacy / 過去経路削除だけを行う。

```text
完了: #109 merge-readiness
完了: #109 merge
現在: legacy / 過去経路削除
次:   挙動不変リファクタ
次:   7視点再棚卸し
最後: 新規改善再開
```

legacy削除とリファクタを同一PRへ混ぜない。Phase 3では挙動改善を追加しない。

## 2. Stable V5 production baseline

Stable V5が唯一のproduction週間計画runtimeである。

削除済みまたは削除対象として確定した旧経路:

- old interpreter / parser fallback
- semantic V1 / V2 experiment cluster
- fixed legacy runtime branch
- runtime mode selector / runtime mode change event
- production-unreachable semantic/cutover prototype modules
- obsolete fixed real-API scenario eval / model comparison workflow
- prompt wordingをAI品質oracleにするtest

残す互換層:

- 旧保存形式を現在形式へ読むmigration decoder
- 既存利用者dataのowner検証・approval ledger migration
- 現行trace/exportが過去保存形式を安全に読むためのdecoder
- human-guided observation専用checkpoint helper
- repository/trace契約を守るtest-support

「legacy」という名前だけを理由に消さない。production data migrationまたは現在の回帰契約に必要なものはPhase 4以降で名前・配置を整理する。

## 3. AI / deterministic責務

現在の正本:

- 自然言語、会話文脈、訂正、数量役割、曜日・時間帯、authorization intentの意味理解はAIが担当する。
- focused / generic semanticへ分けても意味解釈は各AIが担当する。
- deterministic routerはmachine stateから処理経路を選ぶだけで、raw user textを意味解析しない。
- validator、binding、Fact Graph lifecycle、revision、readiness、scheduler、preview、approval、saveはdeterministic coreが担当する。
- provider/validation failureから自然言語parserへfallbackしない。

## 4. 主要経路の確認済み事項

PR #109 baselineで実API・回帰確認済み:

- planning window / multi-task取り込み
- total + completedからremainingを正しく扱うsemantic repair
- pending effort answerの既存workload binding
- reload可能なGraph/checkpoint
- current-turn evidence validation
- copied prior fact rejection
- no-op時のrevision抑止とidempotency履歴保持
- taskごとのworkload readiness
- 曜日・preferred time scheduler保持
- preview訂正 → re-preview
- no-op時preview保持
- preview → draft → approval callback

実APIで確認した配置例:

- 数学: 2026-08-18 21:00–24:00
- 英語レポート: 2026-08-20 12:00–14:00

## 5. Prompt / orchestration

汎用semantic promptへ責務を無制限に積まない。

作成許可のfocused semanticではgeneric semantic約25KB級に対し約1.3KB級までrequestを縮小できた。今後のfocused分割拡大はPhase 3では行わず、Phase 4の挙動不変リファクタとPhase 5の7視点再棚卸しで評価する。

prompt budget上限を緩めて肥大化を隠さない。

## 6. Test philosophy

自動テストは決定論的内部契約を保証する。

自動PASSにしないもの:

- AIの特定日本語返答
- 固定scenarioのsemantic解釈
- 自然さ・会話品質
- model比較

実AI会話はhuman-reviewed observationで確認し、開発側で明確な欠陥を修正してから最終判断を人間へ渡す。

## 7. Phase 3 verification

legacy削除はbatchごとに7視点監査する。

1. AI意味理解責務
2. state / Fact Graph / revision / idempotency
3. dialogue / pending question / renderer
4. scheduler / preview / approval / save
5. test妥当性
6. trace / checkpoint / persistence / recovery
7. CI / dependency / deployment

現在までのcleanup batchでは、targeted regressions、typecheck、conversation foundation、full Vitest、production buildをgreen確認してからbranchへ固定している。

## 8. Phase 3完了条件

- production dependency graphに旧runtime/interpreter/parser/semantic experiment経路が残らない。
- production-unreachable非test moduleは、現行observation/test-supportとして必要なものだけになる。
- runtime mode selectorが存在しない。
- obsolete fixed-AI-quality evalが存在しない。
- canonical docsがStable V5 sole runtimeを前提とする。
- full CI / typecheck / buildがgreen。
- cleanup PRの7視点監査でBLOCKER/MAJORなし。

この条件を満たしたらcleanup PRをmergeし、そのmain CI成功後にだけPhase 4の挙動不変リファクタbranchを作る。
