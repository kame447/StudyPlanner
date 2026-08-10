# 週間計画 汎用意味モデル Stable V5 ロードマップ

Status: canonical / active semantic architecture
最終更新: 2026-08-11

- Main roadmap: [weekly-planning-roadmap.md](weekly-planning-roadmap.md)
- Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Test philosophy: [../testing/weekly-planning-test-philosophy.md](../testing/weekly-planning-test-philosophy.md)
- Execution sequence: [../tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md](../tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md)

## 0. 非交渉の責務境界

ユーザー発話と会話文脈の意味理解はAIが担当する。

```text
user utterance + relevant conversation + machine-readable state
→ AI semantic interpretation
→ structural / reference / safety validation
→ formal ID binding
→ Fact Graph lifecycle
```

禁止する。

```text
user utterance
→ regex / keyword / dictionary / parser
→ AIの意味を置換・補完・上書き
```

AI orchestrationをfocused / genericへ分ける場合も、意味解釈はAIに残す。deterministic routerはpending question、runtime phase、targetFactIdなどのmachine stateだけでrouteを選ぶ。

## 1. 現行Stable V5 semantic path

```text
AI semantic normalizer
→ strict validation
→ structural/reference violation時のみAI repair最大1回
→ accepted SemanticDocument
→ existing entity binding
→ canonicalization / no-op detection
→ Fact Graph V5
→ scheduler/readiness/dialogue
```

semantic ambiguityをdeterministic repairで意味確定しない。意味が不明な場合は将来のclarification contractで扱う。

現行で許可するdeterministic normalizationは、意味を機械的に変えないことを証明できるものに限定する。例は完全一致の既存Fact再利用、current-turnに根拠のない保存済みplanning window再送の除去、formal ID bindingなどである。

## 2. PR #109で確定した重要契約

- workloadをeffort estimateのformal targetとして扱える。
- current-turn semantic deltaに根拠のない過去Factコピーをvalidatorで拒否する。
- no-op turnでFact semantic revisionを増やさない。
- no-opでもapplied turn/idempotency履歴は保持する。
- pending answerが既存Factへformalに結び付く。
- quantity semanticsの構造矛盾はvalidatorで検出し、必要時のみAI repairへ戻す。
- 標準曜日はAIがstructured representationへ正規化し、schedulerはその意味を再解釈しない。
- schedulerの単なる既定時間帯は、AIが構造化した明示的preferred windowより弱い。
- creation authorizationの意味判定をAIへ残す。
- renderer文面をsemantic stateへ逆利用しない。

## 3. prompt / orchestration方針

一つの巨大promptへすべてのsemantic責務を積み続けない。

machine stateから責務を限定できる場合は、小さいfocused semantic callへ切り出してよい。ただしfocused call自身が意味を解釈し、deterministic codeは発話の意味を判定しない。

現行改善ループでは、単純な作成許可をfocused semanticへ切り出したことで、generic semantic request約25KB級に対し約1.3KB級まで縮小できた実測がある。

promptへ新しい規則を追加する前に、次を確認する。

1. 既存規則が長すぎて落ちていないか。
2. 別semantic責務へ分離できないか。
3. schema表現力不足ではないか。
4. validator / binding / state handoffの欠陥ではないか。

prompt budgetを緩めて解決しない。

## 4. 今後の実行順序

semantic作業もmain roadmapの順序へ従う。

```text
PR #109 merge-readiness
→ #109 merge
→ legacy semantic/parser/eval経路削除
→ Stable V5 semantic pipeline挙動不変リファクタ
→ 7視点再棚卸し
→ 必要性を再評価してsemantic新機能へ進む
```

PR #109へpartial semantic acceptance、ambiguity lifecycle、generic turn delta等を追加しない。

## 5. legacy削除で確認するsemantic対象

- old AI interpreter
- old semantic experiment V1/V2/V5 eval残骸
- parser fallback
- legacy runtime selector
- deterministic short-answer/correction/authorization semantic parser
- fixed scenario semantic oracle
- prompt wording contract test
- obsolete compatibility shim

productionから到達不能でも、Stable V5の構造テストに必要なfixture/helperは即削除せずtest-supportへ隔離する。

## 6. リファクタ重点

legacy削除後に独立PRで行う。

- focused semantic / generic semanticの共通client・response envelope
- validator chainの責務分割
- source evidence / current-turn grounding
- existing entity binding
- canonicalization / duplicate/no-op判定
- repair feedback生成
- Graph applyとの境界
- trace payloadとrequest budget計測
- fixture builderの共通化

リファクタ中にsemantic contractを拡張しない。挙動差分が必要ならPhase 5の再棚卸しで別task化する。

## 7. 7視点再棚卸し時のsemantic観点

1. AI semantic ownershipが破られていないか。
2. focused/generic routeがmachine stateだけで決まるか。
3. context過多・不足・古いstate混入がないか。
4. schemaがAIの正しい意味を損失なく表せるか。
5. validatorが意味を選び直していないか。
6. repairが指摘範囲外の意味を変更していないか。
7. request size、repair率、latency、traceからorchestration分割の効果を測れるか。

## 8. 将来候補

再棚卸し後に必要性を再判定する。

- partial semantic acceptance
- unresolved fact / ambiguity ID
- clarification transaction
- resolved-only scheduler view
- generic semantic turn delta / lifecycle applier
- evidence coverage registry
- model escalation policy

これらは古いroadmapに書かれていたという理由だけで自動着手しない。

## 9. failure investigation protocol

実APIで問題が出た場合は次の順で確認する。

```text
AI input context
→ AI raw semantic meaning
→ schema表現可能性
→ validator
→ repair
→ formal binding
→ Fact Graph apply / no-op / revision
→ readiness / scheduler / dialogue / renderer
→ preview / approval / save
```

この順序を確認する前に自然言語ルールを追加しない。
