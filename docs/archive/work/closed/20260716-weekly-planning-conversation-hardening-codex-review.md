# 週間計画対話改善のCodexレビュー

Status: closed / historical review instruction
Created: 2026-07-16
Closed: 2026-07-17
Reviews: `20260716-weekly-planning-conversation-hardening.md`
Outcome: 初回レビュー後に複数回の修正・再レビューを経てPR #5へ統合し、merge commit `55f8e32`で完了した。

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
- preview昇格・承認を含む成功応答の表示元を会話履歴へ一本化
- 保存済みsessionがある場合はmodal再表示時に週間計画画面から再開

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
11. preview昇格・承認成功時の文がstatus cardと会話履歴へ重複表示されないこと。
12. 保存済みsessionがある場合だけ初期タブが週間計画になり、mount後の手動切替をprops更新で上書きしないこと。

## 実行済み検証

- `npm run test:run -- src/features/weeklyPlanning src/components/WeeklyPlanningConversation.test.tsx src/components/weeklyPlanningConversationMode.test.ts`
- `npm run build`
- `git diff --check`

## 履歴上の扱い

この文書は初回レビュー指示の記録であり、現在の実装taskとして再実行しない。現在statusは`docs/ai/weekly-planning-pr5-post-merge-status.md`を参照する。
