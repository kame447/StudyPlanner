# 週間計画storageのユーザー境界書き込みを保護する

Status: planned
Priority: P2
Requirement IDs: none
Updated: 2026-07-18

## 1. 背景

2026-07-18の全体監査で、ユーザー境界をまたぐlocalStorage書き込みの窓を2件確認した。

観測事実:

- `useWeeklyPlanningState`(`src/features/weeklyPlanning/useWeeklyPlanningState.ts:35-42`)は、load effect(宣言順1番目)とsave effect(2番目)が同一commitで実行される。userId変更直後のcommitでは、load effectが新userの状態をsetした後、save effectが旧render closureの`planningState`(旧userの内容)を新userのkeyへ書き込む。直後の再renderで正しい状態に上書きされるため過渡的だが、その間にタブが終了すると旧userの会話・仮予定が新userのkeyへ残る。
- trace有効構成では`StudyPlannerAppRoot`が認証変化でAppをremountするため発生しないが、trace無効構成(`isWeeklyPlanningTraceFeatureEnabled()`がfalse、またはauth未初期化)ではAppがmountされたままuserIdが変わり得る。
- 承認ledgerは全ユーザー共通の単一key `studyplanner-weekly-approval-ledger-v1`で保存される(`src/features/weeklyPlanning/application/weeklyPlanningApprovalLedgerStorage.ts:7`)。判定時は`userId`でfilterしているため誤動作はないが、同一ブラウザの別ユーザーに操作履歴(previewId、時刻、item数)が残る。

## 2. 目的

旧userの週間計画状態が新userのstorage keyへ書き込まれる窓がなくなる。承認ledgerがユーザー別keyで保存される。

## 3. 計画書との対応

- product spec: none
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`(storage boundary)
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: none

## 4. Entry conditions

- effect実行順とclosureの関係を、React 18のcommit順序で再確認する。
- ledgerのkey分割に伴う既存データのmigration(旧keyからuserId別keyへの振り分け、または読み捨て)方針を決める。

## 5. 対象ファイル

- 変更:
  - `src/features/weeklyPlanning/useWeeklyPlanningState.ts`(save effectへ「直近loadを完了したuserId/week」ガードを追加)
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalLedgerStorage.ts`(userId別key化とmigration)
  - `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`(ledger load/saveへownerIdを渡す)
- 新規: なし
- テスト: userId切替時の書き込み先検証。ledger key分割とmigration。

## 6. 現在の処理経路

```text
userId変更render
→ effect1: loadWeeklyPlanningState(newUser) → replacePlanningState
→ effect2: saveWeeklyPlanningState(newUserId, 旧planningState closure)  ← 窓
→ 再render → effect2: 正しい状態を保存(修復)
```

## 7. 確認済みの事実

- 最終的なstorage状態は自己修復するため、通常操作では顕在化しない。
- `saveWeeklyPlanningState`は`weekStartDate`不一致時に書き込みをskipするガードを既に持つが、userId不一致のガードはない。

## 8. 未確認事項

- anonymous(未ログイン)→ログインの遷移で、'anonymous' keyに実データが載る経路が本当に存在しないか(現状UIは未ログインで週間計画へ到達不能)。

## 9. 問題点

- ユーザー境界のデータ混入は量が少なくても privacy incident として扱いが重い。窓の狭さに依存せず構造的に塞ぐべきである。

## 10. 修正方針

- `useWeeklyPlanningState`にloadを完了したidentity(userId + weekStartDate)をrefで記録し、save effectはidentity一致時のみ書き込む。
- ledgerは`studyplanner-weekly-approval-ledger-v1.<userId>`等のユーザー別keyへ移し、初回loadで旧keyから当該userの分だけを引き継ぐ。旧keyは移行完了後に削除する。

## 11. 触らない範囲

- 状態のschema、storage validation規則
- 承認判定ロジック
- trace storage

## 12. 受け入れ条件

- userId変更直後のcommitで、旧userの状態が新userのkeyへ書き込まれない(effect順を再現するテストで固定)。
- ledgerがユーザー別keyへ保存され、別userのoperationが読み込まれない。
- 既存の単一key ledgerからのmigrationが1回だけ実行され、既存の重複防止(existingOperation再利用)が引き続き機能する。

## 13. テスト観点

- unit: save effectガード。ledger key選択とmigration。
- integration: userId切替シナリオ(`20260718-weekly-planning-application-behavior-tests.md`のharnessを利用)。
- browser/manual: 同一ブラウザで2アカウントを切り替え、localStorageのkey内容を目視確認。
- regression: 通常の保存・復元round-trip、部分失敗再試行。

## 14. リスク

- ledger migrationの失敗は重複保存防止の弱体化につながる。migration失敗時は旧key読み取りへフォールバックし、fail-openにしない。

## 15. Dependencies

- 先行: なし。
- 関連: `20260716-weekly-planning-approval-persistence-and-idempotency.md`(server-side化の際にledger keyの再設計と合流する)。

## 16. Exit conditions

- 全test、TypeScript、production build、`git diff --check`が成功する。
- migration手順と旧keyの扱いを文書化する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
