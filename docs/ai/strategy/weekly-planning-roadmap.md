# 週間計画 AI ロードマップ

Status: canonical / Phase 4 behavior-preserving refactor
最終更新: 2026-08-11

- Current status: [../weekly-planning-current-contract-status.md](../weekly-planning-current-contract-status.md)
- Semantic V5 roadmap: [weekly-planning-semantic-v5-roadmap.md](weekly-planning-semantic-v5-roadmap.md)
- Test philosophy: [../testing/weekly-planning-test-philosophy.md](../testing/weekly-planning-test-philosophy.md)
- Execution sequence: [../tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md](../tasks/20260811-weekly-planning-merge-cleanup-refactor-sequence.md)

## 0. 最上位設計原則

ユーザーの自然言語、会話文脈、訂正、quantity role、日付・曜日・時間帯、authorization intentの意味理解はAIが担当する。

deterministic codeはschema/reference/evidence validation、formal binding、Fact Graph lifecycle、revision/idempotency、readiness、scheduler、preview、approval、save、persistence、安全境界を担当する。raw user textをregex・keyword・dictionary・parserで再解釈してAIの意味を上書きしない。

focused / genericへAI orchestrationを分ける場合も意味解釈はAIに残す。deterministic routerはmachine stateからsemantic責務を選ぶだけとする。

rendererはtyped application decisionを自然な日本語へ変換し、renderer文面からsemantic stateを逆推定しない。

## 1. 現在の基準線

Stable V5が唯一のproduction週間計画runtimeである。

```text
user utterance
→ focused または generic AI semantic interpretation
→ validation / 必要時AI repair最大1回
→ existing entity binding / canonical commit
→ Fact Graph V5
→ readiness / scheduler / dialogue decision
→ AI renderer
→ preview
→ draft / approval / save
```

PR #109で主要会話経路を実API・決定論的回帰から安定化し、PR #112でproductionから到達不能なold interpreter/parser/runtime/semantic experiment経路を削除した。両PRともmerge後main CI greenを確認済みである。

## 2. 実行順序

以下を変更しない。

```text
Phase 1: PR #109 merge-readiness                 完了
Phase 2: PR #109 squash merge                    完了
Phase 3: legacy / 過去経路削除（PR #112）        完了
Phase 4: Stable V5挙動不変リファクタ              進行中
Phase 5: 7視点ゼロベース再棚卸し                 未着手
Phase 6: 新規会話改善・機能追加                   未着手
```

詳細な実行条件はexecution sequenceを正とする。

## 3. Phase 4: 挙動不変リファクタ

目的は責務境界をコード構造から追いやすくすることであり、仕様変更ではない。

現在の重点:

- semantic validatorのbase/extension責務
- generic semantic prompt assembly
- focused authorization semantic boundary
- semantic response validation chain
- repair prompt generation
- AIへ渡すpublic-state context
- existing entity binding / correction / no-opを含むsemantic commit transaction
- pipeline orchestrationとtrace

Phase 4で禁止:

- promptへ新しい意味規則を追加
- focused semantic適用範囲を拡大
- validator accept/reject policyを変更
- readiness優先度を変更
- scheduler配置policyを変更
- renderer意味契約を変更
- preview / approval / save workflowを変更
- 既存data migration compatibilityを削除

各batchで7視点監査を行い、有効な回帰を削らず、typecheck / relevant tests / foundationを通す。責務の大きいbatchではfull Vitest / buildまで通す。

## 4. Phase 4完了gate

- AI意味理解責務がコード構造から明確に追える。
- generic/focused semantic、validation、repair、public context、canonical commitの境界が分離されている。
- Fact Graph revision/idempotency挙動が不変。
- prompt content / request budgetを意図せず増やしていない。
- scheduler / preview / approval / saveへのbehavior差分がない。
- test philosophyに反する固定AI oracleを導入していない。
- trace / checkpoint / persistence contractを壊していない。
- dependency audit、typecheck、full Vitest、production build、diff checkがgreen。
- 7視点最終監査でBLOCKER/MAJORなし。

このgateを満たしたrefactor PRだけをsquash mergeする。merge後main CI greenを確認してからPhase 5へ進む。

## 5. Phase 5: 7視点再棚卸し

整理後mainをゼロベースで監査する。

1. AI意味理解責務 / orchestration / prompt
2. state / Fact Graph / revision / idempotency
3. dialogue / pending question / renderer
4. scheduler / preview / correction / approval / save
5. test妥当性 / stale expectation / overfitting
6. trace / checkpoint / persistence / recovery
7. CI / dependency / deployment / operational safety

古いtaskやroadmapの残件を自動継承せず、現コード・実API観測・現在のプロダクト目標からbacklogを作り直す。

## 6. Phase 5後に再評価する候補

- partial semantic acceptance / ambiguity lifecycle / clarification transaction
- focused semantic適用範囲の拡大
- current-time hard boundary
- cloud authoritative conversation / Fact Graph repository
- external source production adapter
- cross-tab / cross-device conflict handling
- trace production operations
- approval operational rollout
- personalization

古いMDに存在するという理由だけで着手しない。

## 7. テスト方針

自動テストは決定論的契約だけを保証する。

AIの意味理解・自然さ・特定の日本語返答を固定期待値にしない。実API会話はhuman-reviewed observationで確認し、開発側で明確な欠陥を修正してから最終判断を人間へ渡す。

禁止:

- fixed scenario semantic oracle
- model比較を通常CIへ入れる
- exact renderer wordingをAI品質contractにする
- prompt wording自体を回帰contractにする

## 8. 文書運用

current判断はcurrent contract、current status、本roadmap、semantic roadmap、execution sequenceを優先する。

historical task/auditの`Status: active`を無条件に信用しない。Phase 5でroot taskを再分類し、完了は`closed/`、統合済みは`superseded/`へ移す。
