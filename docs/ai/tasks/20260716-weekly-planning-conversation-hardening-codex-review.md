# 週間計画対話改善のCodexレビュー

Status: open
Created: 2026-07-16
Reviews: `20260716-weekly-planning-conversation-hardening.md`

## レビュー目的

今回の実装が既存の週間計画機能を壊さず、場当たり的な文言置換ではなく一般化された責務として成立しているか確認する。

## 主な変更

- deterministic parserの部分exam scopeをAIが安全に補完できるvalidator契約
- 単一分野ではpriority質問を生成しないmissing導出
- 計画期間内の登録済み予定だけを根拠にしたfixed events質問
- 会話messagesとintake stateのweekly planning stateへの集約とlocalStorage永続化
- 送信直後の入力クリア、composer非表示、assistant typing indicator
- 会話履歴表示の独立component化
- AI structured outputの任意null propertyを未指定へ正規化

## 必須確認項目

1. 複数分野のpriority確認が残っていること。
2. 既存の確定exam scopeを異なるAI候補が上書きできないこと。
3. fixed events質問に範囲外予定や入力外予定が混ざらないこと。
4. modalを閉じて再度開いた際、会話とintake stateが復元されること。
5. `assumptionProposalRecords`がlocalStorageへ保存されないこと。
6. 履歴クリアがdraft blockを意図せず削除しないこと。
7. 送信中にtextareaとユーザー発話が二重表示されないこと。
8. preview生成・個別削除・一括承認の既存経路に回帰がないこと。
9. `NaturalLanguageAssistant`から分離したcomponent境界が新しい循環依存を作っていないこと。
10. 任意項目の`null`だけが除去され、必須項目の欠落や不正配列が修復されていないこと。

## 実行済み検証

- `npm run test:run -- src/features/weeklyPlanning src/components/WeeklyPlanningConversation.test.tsx`
- `npm run build`
- `git diff --check`

## レビュー結果の書き方

BLOCKER、MAJOR、MINORの順で、該当ファイルと再現条件を示す。問題がなければ「採用可」とし、残る設計判断だけを別項目に分離する。
