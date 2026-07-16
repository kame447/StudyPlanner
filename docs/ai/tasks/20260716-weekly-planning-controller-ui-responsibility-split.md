# 週間計画controllerとUIの責務を分離する

Status: planned
Priority: P2
Requirement IDs: DA-TURN-001, DA-PREVIEW-001

## 1. 背景

`NaturalLanguageAssistant.tsx`が通常自然言語入力、週間計画state、pipeline orchestration、AI設定、preview、draft promotion、approval UI、error表示を同時に担当している。request ownership、trace、retry、session lifecycleの接続位置が分かりにくい。

## 2. 目的

会話制御、preview制御、表示componentを分離し、UI componentを描画とuser action委譲へ限定する。

## 3. Entry conditions

- entrypoint request ownership taskの調査結果を先に確認する。
- PR #5または後続のcomponent分割がmainへ入った場合は、重複実装を避けて再評価する。
- 現在のstate ownershipとcallback経路をdiagram化する。

## 4. 分離候補

```text
useWeeklyPlanningConversationController
useWeeklyPlanningPreviewController
WeeklyPlanningConversationPanel
WeeklyPlanningPreviewPanel
```

名称は固定しない。責務境界を優先する。

## 5. 対象責務

- conversation stateとhistory
- request orchestration
- preview lifecycle
- draft promotion
- approval action委譲
- error/status state
- trace instrumentation boundary

## 6. 触らない範囲

- UX文言の全面変更
- CSS全面変更
- scheduler contract
- AI/rules統合方式
- approval persistence方式

## 7. 受け入れ条件

- view componentがpipelineやrepositoryを直接呼ばない。
- conversation controllerがrequest lifecycleを所有する。
- preview controllerがpreview、stale、promotion、approval eligibilityを所有する。
- approval repository writeは既存の保存境界を維持する。
- refactor前後でstate transitionと表示結果が変わらない。
- unitとintegration testで責務境界を固定する。

## 8. Exit conditions

- component sizeではなく依存方向とownershipで完了判定する。
- entrypoint/browser verificationが未完ならfully completeと記載しない。
