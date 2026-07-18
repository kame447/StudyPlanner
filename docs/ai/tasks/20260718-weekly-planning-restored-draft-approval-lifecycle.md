# リロード後に復元した仮予定を再計算必須として扱う

Status: planned
Priority: P1
Requirement IDs: DA-PREVIEW-001
Updated: 2026-07-18
Depends on: `20260718-weekly-planning-approval-validation-session-binding.md`
Product decision: browser reload後のbehavior-aware仮予定は承認不可とし、再計算を必須にする。

## 1. 背景

2026-07-18の監査で、behavior-aware仮予定はlocalStorageから表示復元される一方、承認に必要なsession runtimeとassumption proposal recordsがreloadで失われることを確認した。

観測事実:

- draft blockとpreviewMetadataはlocalStorageへ保存される。
- `pendingTurn`、`pendingApproval`、`assumptionProposalRecords`はsession-onlyとしてload時に除去される。
- session runtimeはmodule singletonでありreload後はnullになる。
- conversationId付きpreviewはruntime不在時に`session-runtime-unavailable`でfail-closedになる。
- modal close/reopenは同一JavaScript session内なのでruntimeを維持できるが、browser reloadは別契約である。

## 2. 目的

browser reload後のbehavior-aware仮予定を「参考表示はできるが、そのまま承認できない復元案」として明示し、承認操作を出さず、最新条件での再計算を案内する。

## 3. 計画書との対応

- product spec: `docs/weekly-planning/weekly-planning-spec.md`のreviewable apply
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`のreload sanitizeとpreview authorization
- current contract: `docs/ai/weekly-planning-current-contract-status.md` §4–5
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-PREVIEW-001

## 4. Entry conditions

- validation session binding taskを完了し、実conversationIdでruntime availabilityを判定できるようにする。
- UIがapproval applicationと別の簡易判定を再実装しないよう、application層でapproval availabilityを分類する入口を決める。
- legacy metadataなしblockは現行互換経路を維持する。

## 5. 対象ファイル

- 変更候補:
  - `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.ts`またはapproval availability用pure helper
  - `src/components/NaturalLanguageAssistant.tsx`
  - 必要なら`src/components/WeeklyPlanningQuickEntryModal.tsx`
  - storage/load test
- 新規: 必要ならapproval availability型とpure classifier
- テスト: save→reload相当runtime clear→表示/承認可否、close/reopen回帰

## 6. 現在の処理経路

```text
saveWeeklyPlanningState
→ draftBlocks + previewMetadataを保存
→ reload
→ loadWeeklyPlanningStateでsession-only情報を除去
→ draftは表示
→ approve click
→ runtime unavailable
→ generic errorで拒否
```

## 7. 確認済みの事実

- localStorageへproposal recordsを保存しないことは現行の明示的なsecurity boundaryである。
- runtimeをlocalStorageから再構築するには、改ざん耐性とserver-side trustを含む追加設計が必要である。
- 現行のserver-side idempotency taskは未実装であり、reload後承認を安全に許可する根拠がない。
- legacy metadataなしblockはruntime不要で承認できるため、本taskで一律禁止しない。

## 8. 未確認事項

- 「最新条件で作り直す」を専用buttonにするか、既存入力欄と明示文だけで再依頼させるか。
- 復元案を個別削除できる既存UIとの文言配置。

## 9. 問題点

現在は承認不能であることを事前表示せず、押下後のgeneric errorで初めて伝えるため、復元表示と操作可能性が一致しない。

## 10. 修正方針

- product decisionとしてB案を採用する。runtime snapshotとproposal recordsをlocalStorageへ追加保存しない。
- application層はdraft群のapproval availabilityを少なくとも`eligible`、`recompute_required`、`blocked`へ分類し、reasonをUIへ公開する。
- behavior metadataにconversationIdがあり、対応runtimeが存在しない、またはconversation/revisionが一致しない復元案は`recompute_required`とする。
- `recompute_required`では承認buttonを非表示またはdisabledにし、「再読み込み前の仮予定です。最新条件で作り直してください。」等の明示文を表示する。
- approval function側のfail-closed guardは維持し、UI判定だけに依存しない。
- 再計算は既存の会話入力・仮予定生成経路を再利用する。自動でAI requestを開始しない。
- modal close/reopenだけでは`recompute_required`へ変更しない。

## 11. 触らない範囲

- runtime/proposal recordsのlocalStorage永続化
- server-side runtime snapshot
- 自動再計算
- legacy metadataなしblockの承認互換
- schedulerとpreview生成条件

## 12. 受け入れ条件

- behavior-aware仮予定を作成しbrowser reload相当のloadを行うと、案は参考表示されるが承認buttonは操作できない。
- UIに再計算が必要な理由と次の操作が表示される。
- approval functionを直接呼んでもfail-closedで保存されない。
- 同一session内のmodal close/reopenでは承認可能状態を維持する。
- 復元案を破棄し、同じ会話条件から新previewを生成した後は承認できる。
- legacy metadataなしblockの承認経路を変更しない。
- 改ざんmetadata、別user、conversation mismatchを承認可能へ昇格しない。

## 13. テスト観点

- unit: approval availability classifierのruntime unavailable/mismatch/eligible分岐。
- integration: state保存→runtime clear→load→UI propsと直接approval拒否。
- component: 承認button非表示またはdisabled、再計算案内表示。
- browser/manual: 作成→reload→案内→再作成→承認。
- regression: modal close/reopen、legacy block、個別削除。
- property/fuzz: storage validatorの既存property testを維持する。

## 14. リスク

- UIだけで判定すると直接callback経路から保存できるため、domain guardを維持する。
- reloadとmodal closeを混同するとPR #5のclose-resume改善を退行させる。
- 再計算によりAI呼出し回数は増えるが、信頼できないlocal snapshotから承認可能runtimeを復元するより安全性を優先する。

## 15. Dependencies

- 先行: `20260718-weekly-planning-approval-validation-session-binding.md`。
- 関連: `20260716-weekly-planning-approval-persistence-and-idempotency.md`。将来server-side snapshotを導入する場合だけ承認可能化を再検討する。
- component fileを変更するcontroller/UI split taskとは直列に統合する。

## 16. Exit conditions

- reload後behavior previewを再計算必須とするproduct decisionは`docs/ai/weekly-planning-current-contract-status.md` §5.1へ記録済みである。実装結果と齟齬が生じた場合だけ同節を更新する。
- focused test、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- Issue #43のbrowser scenarioへreload表示・再計算を同期する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
