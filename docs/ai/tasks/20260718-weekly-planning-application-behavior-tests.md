# 週間計画アプリケーション層の挙動テストを整備する

Status: planned
Priority: P1
Requirement IDs: DA-TURN-001, DA-PREVIEW-001
Updated: 2026-07-18
Depends on: `20260718-weekly-planning-app-orchestration-extraction.md`(completed)

## 1. 背景

2026-07-18の全体監査で、App分離時に追加された唯一のテスト`weeklyPlanningAppOrchestrationArchitecture.test.ts`がソース文字列の`toContain`検査のみであることを確認した。

観測事実:

- `useWeeklyPlanningApplication.ts`と`weeklyPlanningApprovalApplication.ts`を対象とする挙動テストが存在しない(`grep`で確認。importするテストは文字列検査のみ)。
- 下層(reducer、turn controller、approval domain、storage)には単体テストがあるが、application層の結合部で起きる問題 — 保存副作用による週切替、reset競合、userId非対称、捏造検証入力 — はすべてテストの隙間に落ちており、監査で見つかったMAJOR問題は既存1163テストで1件も検出されない。
- 既存テストは`savePlanDraft`を副作用のない純粋mockで代替しており、実物の副作用(selectedDate変更等)を再現しない。

## 2. 目的

application層の結合挙動(実reducer + 実storage(mock localStorage) + 副作用を再現するfake保存関数)を検証するテストharnessが存在し、20260718系の各修正taskがこのharness上で受け入れ条件を検証できる。

## 3. 計画書との対応

- product spec: none(テスト整備)
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`(module ownership)
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-TURN-001, DA-PREVIEW-001

## 4. Entry conditions

- 既存のテスト基盤(`weeklyPlanningPreviewSessionLifecycle.test.tsx`のreact-test-renderer + localStorage mockパターン)を流用できるか確認する。
- 20260718系修正taskとの順序を決める(harness先行が望ましいが、各taskへ最低限のテストを含める形でも可)。

## 5. 対象ファイル

- 変更: なし(production codeを変更しない)
- 新規:
  - `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.test.tsx`
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.test.ts`
  - 必要なら`src/features/weeklyPlanning/testUtils/`へfake保存関数・localStorage harness
- テスト: 上記そのもの

## 6. 現在の処理経路

```text
App → useWeeklyPlanningApplication
→ useWeeklyPlanningState(実reducer + localStorage)
→ submitWeeklyPlanningControlledTurn / approveWeeklyPlanningDraftBlocks
→ savePlanDraft(注入)
```

## 7. 確認済みの事実

- 現状の文字列検査テストはimportの別名・再輸出で無力化され、挙動退行を検出しない(tripwireとしては残す価値がある)。
- 全テスト1163件・production buildは37b1146で成功。

## 8. 未確認事項

- react-test-rendererの継続利用可否(React versionとの整合)。

## 9. 問題点

- 責務分離の受け入れ条件が「文字列がどのファイルにあるか」でしか固定されておらず、分離後のglue層が無防備。

## 10. 修正方針

テストのみを追加する。最低限、次のシナリオを固定する。

1. 二重送信: `submitTurn`連打で2回目が`accepted: false`になり、状態が1turn分しか進まない。
2. 週変更中のstale result: 送信中に`selectedDate`を別週へ変更→完了resultが破棄され、旧週の状態が汚染されない。
3. 承認の部分失敗→再試行: 1item失敗→再承認で失敗分のみ保存され、成功済みは`skipped_duplicate`または既存operation再利用になる。
4. 承認中reset競合: 保存await中の`resetSession`後の状態(現行挙動をcharacterizationとして固定し、`20260718-weekly-planning-approval-inflight-interruption.md`の修正時に期待値を更新する)。
5. 保存関数の副作用: `savePlanDraft`相当のfakeが`selectedDate`変更を再現し、週切替時の現行挙動を固定する(同様にcharacterization)。
6. userId切替: userId変更後に旧userの状態・sessionが引き継がれない。
7. ledger round-trip: `onOperationCompleted`→localStorage保存→再mountでの読み込み。

## 11. 触らない範囲

- production code全般(バグを見つけても修正せず、対応する修正taskへ報告する)
- 既存テストの削除・書き換え(文字列検査テストは残す)

## 12. 受け入れ条件

- 上記シナリオ1〜7がテストとして存在し、現行mainで全て成功する(characterizationは現行挙動を固定)。
- 各テストがmock文字列検査ではなく、実reducer・実storage経由の状態遷移を検証している。
- テスト実行時間が既存suiteを著しく悪化させない(目安: application層テスト合計で数秒以内)。

## 13. テスト観点

- unit: approval application(fake依存注入、React不使用)。
- integration: hook全体(react-test-renderer + localStorage mock)。
- browser/manual: なし(Issue #43が担当)。
- regression: 本harness自体が回帰網になる。
- property/fuzz: 不要(既存のsession state propertyテストを維持)。

## 14. リスク

- characterizationテストが現行バグを「正」として固定するため、各修正taskで期待値更新を忘れない。テスト内へ対応するtask名をコメントで残す。

## 15. Dependencies

- 先行: なし。20260718系修正taskより先に着手することを推奨する(修正の受け皿になる)。
- 並行変更禁止: なし(テストのみ)。

## 16. Exit conditions

- 全test、TypeScript、production build、`git diff --check`が成功する。
- 追加したシナリオ一覧と、characterizationとして固定した現行バグの一覧を最終報告へ記載する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
