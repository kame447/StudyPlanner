# 週間計画controllerとUIの責務を分離する

Status: planned
Priority: P2
Requirement IDs: DA-TURN-001, DA-PREVIEW-001
Updated: 2026-07-17
Post-merge status: `docs/ai/weekly-planning-pr5-post-merge-status.md`
Depends on: `20260716-weekly-planning-entrypoint-request-ownership.md`

## 1. 背景

PR #5で、会話表示component、session-owned messages/intake/preview、modal close後のpreview復元、closed storage validationが`main`へ入った。

ただし、`App.tsx`、`NaturalLanguageAssistant.tsx`、`QuickEntryModal.tsx`には次が分散している。

- 通常自然言語入力
- 週間計画conversation state
- request orchestration
- AI設定
- preview lifecycle
- draft promotion
- approval UI
- repository write boundary
- status/error表示
- props中継

PR #5の機能契約を維持したまま、state ownerとuse case boundaryを整理する必要がある。

## 2. 目的

会話制御、preview制御、approval委譲、表示componentを分離し、UI componentを描画とuser action委譲へ限定する。

ファイル行数を減らすことではなく、変更理由、依存方向、state ownershipを分けることを目的とする。

## 3. Entry conditions

- entrypoint request ownership taskの調査・実装結果を先に確認する。
- merge後`main`のclose-resume、reset/stale、approval、storage contractをcharacterization testで固定する。
- Issue #21の日付parser修正をこのrefactorへ混ぜない。
- PR #5 post-merge statusとclosed maintainability auditを確認する。
- 現在のstate ownershipとcallback経路をdiagram化する。

## 4. 分離候補

```text
useWeeklyPlanningController
useWeeklyPlanningConversationController
useWeeklyPlanningPreviewController
WeeklyPlanningConversationPanel
WeeklyPlanningPreviewPanel
WeeklyPlanningApprovalActions
WeeklyPlanningDependencies
```

名称は固定しない。責務境界を優先する。

## 5. 対象責務

### Application controller

- conversation/session lifecycle
- request envelope生成
- request orchestration
- selected week、reset、explicit cancel、retry
- messages/intake/preview candidateのcommit
- stale result判定
- dependency注入

### Preview controller

- preview lifecycle
- individual delete / discard all
- draft promotion
- stale判定
- approval eligibility
- approval action委譲

### View components

- conversation history
- typing indicator
- composer
- preview rendering
- user action callback
- status/error rendering

### Composition root

- authenticated user
- planner repository adapter
- AI interpreter / renderer
- clock
- ID factory
- approval ledger repository
- controllerとviewの接続

## 6. current contractとして維持する挙動

- modal close / presentation unmountだけではsessionをcancelしない。
- close中に完了したresultをsessionへcommitし、reopen時に復元する。
- selected week変更、session reset、explicit cancellation後の旧resultを適用しない。
- clear conversationとreset sessionを分離する。
- preview candidateはsession stateで所有する。
- explicit authorizationとreadiness gate前にpreviewを生成しない。
- stale/pending previewをrepository write前に拒否する。
- closed storage validationを弱めない。
- deterministic baseline + AI semantic補完を維持する。
- existing exam flowの互換経路を維持する。

## 7. 触らない範囲

- UX文言の全面変更
- CSS全面変更
- scheduler contract
- AI/rules統合方式の再設計
- 漢数字絶対日付parser
- approval persistenceのserver-side化
- trace privacy実装
- longitudinal personalization実装
- universal Contextへの全state移行

## 8. 受け入れ条件

### Dependency direction

- view componentがpipeline、storage、repositoryを直接呼ばない。
- application controllerがrequest lifecycleを所有する。
- preview controllerがpreview、stale、promotion、approval eligibilityを所有する。
- approval repository writeは既存の保存境界を維持する。
- concrete factoryとglobal configはcomposition rootからdependencyとして渡せる。

### State ownership

- 同一stateをApp、NaturalLanguageAssistant、QuickEntryModalで重複所有しない。
- presentation unmountによってsession-owned Promise resultを失わない。
- `mode`等の導出可能stateをselectorまたは単一finalizerへ寄せる方針を明示する。
- props surfaceをfeature controller objectへまとめる。

### Behavioral equivalence

refactor前後で次を変えない。

- conversation history
- typing indicator
- pending turn lock
- close-resume
- clear conversation / reset session
- preview generation
- preview individual delete / discard / promotion
- approval stale/pending guard
- storage round-trip
- existing exam approval

### Tests

- controller unit test
- request ownership integration test
- preview lifecycle integration test
- close/unmount/remount component test
- App approval workflow characterization test
- browser close-resume、reset/stale、IME、focus scenario

## 9. Exit conditions

- component sizeではなく依存方向とownershipで完了判定する。
- `App.tsx`が週間計画workflowとledger実装を直接持たない。
- `NaturalLanguageAssistant.tsx`が単発AIと週間計画の両方を所有しない。
- `QuickEntryModal.tsx`が週間計画のapplication stateを所有せず、shell/routeとして動作する。
- refactor前後で全test、production build、`git diff --check`が通る。
- entrypointまたはbrowser verificationが未完ならfully completeと記載しない。
