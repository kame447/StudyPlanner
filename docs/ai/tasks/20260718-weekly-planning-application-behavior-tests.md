# 週間計画アプリケーション層の挙動テストを整備する

Status: planned
Priority: P1
Requirement IDs: DA-TURN-001, DA-PREVIEW-001
Updated: 2026-07-18
Depends on: `closed/20260718-weekly-planning-app-orchestration-extraction-completion.md`

## 1. 背景

2026-07-18の監査で、App分離時に追加された`weeklyPlanningAppOrchestrationArchitecture.test.ts`が主にソース文字列の配置を検査しており、application層の結合挙動を固定していないことを確認した。

観測事実:

- `useWeeklyPlanningApplication.ts`と`weeklyPlanningApprovalApplication.ts`を実行する結合テストがない。
- reducer、turn controller、approval domain、storageには単体テストがあるが、hookで依存を組み立てた後の競合は検出できない。
- 既存approvalテストは保存関数を副作用のないmockへ置き換えるため、選択週変更、reset競合、user切替、ledger保存境界を再現しない。
- 2026-07-18監査で見つかった承認系MAJORは、既存1163テストでは検出されなかった。

## 2. 目的

実reducer、実storage境界、制御可能な非同期依存を組み合わせたapplication層テストharnessを追加し、会話・承認・user境界の回帰を挙動として検出できるようにする。

既知バグの壊れた出力を正解として固定しない。M1、M3、M4、M5に対応する回帰assertionは、各修正taskと同じ変更でgreenにする。

## 3. 計画書との対応

- product spec: none(テスト基盤)
- architecture: `docs/architecture/weekly-planning-dialogue-architecture-v4.md`のmodule ownership
- roadmap: `docs/ai/strategy/weekly-planning-roadmap.md` §3
- test contract / Requirement ID: DA-TURN-001, DA-PREVIEW-001

## 4. Entry conditions

- `closed/20260718-weekly-planning-app-orchestration-extraction-completion.md`を確認する。
- `weeklyPlanningPreviewSessionLifecycle.test.tsx`等の既存React test harnessを再利用できるか確認する。
- deferred Promise、mock localStorage、user/week rerenderを決定的に制御できる構成を先に作る。

## 5. 対象ファイル

- 変更: 既存の構造tripwire testは削除しない。
- 新規:
  - `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.test.tsx`
  - `src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.test.ts`
  - 必要なら`src/features/weeklyPlanning/testUtils/`の共通harness
- テスト: 上記

## 6. 現在の処理経路

```text
App
→ useWeeklyPlanningApplication
→ useWeeklyPlanningState(real reducer + localStorage)
→ submitWeeklyPlanningControlledTurn / approveWeeklyPlanningDraftBlocks
→ injected async dependencies
→ approval ledger state / localStorage
```

## 7. 確認済みの事実

- controllerとreducerはref経由で同期的に二重送信を拒否する。
- application hookはcontroller、state hook、approval application、ledger storageを結合する。
- 現在の構造テストは責務の逆流を検出するtripwireとしては残す価値があるが、挙動保証にはならない。
- 監査基準`37b1146`では全テスト1163件とproduction buildが成功している。

## 8. 未確認事項

- 現行React versionで`react-test-renderer`を継続利用するか、既存の別component test基盤を使うか。
- localStorage eventを利用するmulti-tab再現は本taskへ含めず、server-side idempotency taskへ委譲できるか。

## 9. 問題点

責務分離の受け入れ条件が「実装文字列がどのfileにあるか」へ偏っており、application層の依存組み立てと非同期競合が無防備である。

## 10. 修正方針

まず共通harnessを作り、現行で成立すべき次の挙動をpassing testとして固定する。

1. 二重送信: 同一render中の連打でも2回目は`accepted: false`となる。
2. stale turn: 送信中の週変更後に旧resultが新週へcommitされない。
3. 部分失敗再試行: 成功済みitemを再保存せず、失敗分だけを再試行する。
4. controller scope: userIdまたは週が変わった後の次turnは新conversationとして開始する。
5. ledger round-trip: operation保存後のremountで同一userのoperationを復元する。
6. test utility: 保存中にreset、週変更、user変更を差し込めるdeferred saveを提供する。

M1とM5の現行不具合について、壊れた最終状態をpassing assertionとして固定しない。修正taskより先に再現testを置く必要がある場合は、対応task名を付けた`test.todo`等とし、通常suiteの成功条件へ壊れた挙動を組み込まない。利用中のVitestで期待失敗APIを確認せず`test.fails`へ依存しない。

## 11. 触らない範囲

- production codeのバグ修正
- server-side idempotency
- UI文言・CSS
- 既存構造tripwire testの削除

## 12. 受け入れ条件

- application層を実行するunit/integration testと共通harnessが追加される。
- 上記1〜5が現行契約に対するpassing testになる。
- M1/M5の壊れた挙動を正解としてassertするtestが存在しない。
- 後続taskがdeferred save、user/week rerender、localStorageを再実装せず利用できる。
- testは実reducerまたは実storage境界を通り、ソース文字列検査だけで完了しない。

## 13. テスト観点

- unit: approval applicationへの依存注入とoperation更新。
- integration: hook全体、user/week rerender、localStorage round-trip。
- browser/manual: なし。Issue #43が担当する。
- regression: 二重送信、stale discard、partial retry、user scope。
- property/fuzz: 不要。既存session property testを維持する。

## 14. リスク

- React effect順序へ依存するtestは、単なるmock呼出し順ではなく保存keyとstate identityをassertする必要がある。
- test utilityがproduction型を緩めないよう、テスト専用fileに閉じる。

## 15. Dependencies

- 先行: なし。20260718系のproduction修正より先にharnessを作ることを推奨する。
- browser verification pendingのentrypoint taskは、本test基盤着手のblockerではない。
- 並行変更禁止: なし。後続taskが同じtest fileを変更する場合は直列に統合する。

## 16. Exit conditions

- targeted test、週間計画suite、全test、TypeScript、production build、`git diff --check`が成功する。
- 新規harnessの利用方法と、後続taskへ委譲した回帰caseを最終報告へ記載する。
- 完了時はcompletion recordへ統合し、rootから本taskを閉じる。

## 17. 実装担当への指示

1. `docs/ai/weekly-planning-docs-index.md`から現行文書を確認する。
2. `docs/ai/codex-task-guide.md`と`docs/ai/weekly-planning-pipeline-guide.md`に従う。
3. scope外へ広げず、必要なら停止条件として報告する。
4. test結果、変更file、未確認事項を最終報告へ残す。
5. git操作はユーザーから明示された場合だけ行う。
