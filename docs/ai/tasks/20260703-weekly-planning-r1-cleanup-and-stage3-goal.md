# [Goal] R1 command boundary cleanup: Stage 1a/2 後の整理と priority missing ブロックの移設検討

このmdは2フェーズ構成の goal 用タスクmdである。**goal mode で実行する場合でも、本mdに書かれた範囲を超えないこと。** md内で「将来候補」「別作業」「設計判断が必要」とした項目は、調査であっても勝手に進めない。対象外の問題を見つけた場合は、修正・調査をせず「発見事項」として報告するだけにする。

## 背景

R1(command boundary の完成と reducer 薄化)は、Stage 1a / Stage 2 まで完了し、採用可レビュー済みである。reducer(`intake/weeklyPlanningIntakeReducer.ts`)から自然言語由来の直接分岐は、隔離済みの legacy fallback 呼び出しを除いて消えた。

残るのは、Stage 1a/2 の後始末(dead export・冗長 payload・本md内または作業報告への完了記録)と、R1 Stage 3 相当の reducer 末尾 priority missing 追加ブロックの移設検討である。本mdはこの2つを Phase A / Phase B として扱う。

## 現在完了済みの作業(前提)

- `note_no_fixed_events` command 化(Stage 1a/2、採用可レビュー済み・コミット済み `628a7b3 feat: 固定予定なし表現をcommand経由に移行`): `hasExplicitNoFixedEvents` の reducer 経由 regression(マッチ4件+非マッチ3件)、command 型・parser・adapter・reducer apply の3点セット、reducer からの直接分岐削除。
- fallback は reducer 直呼び7件 + pipeline 3件の regression で固定済み、`intake/weeklyPlanningLegacyFallback.ts` へ隔離済み。
- `note_progress_boundary` / `note_uncertainty` command 化済み。
- 既知の失敗: `scheduling/placementScoring.test.ts` 1件(本goalの範囲外)。

## 残っている問題

1. **`hasExplicitNoFixedEvents` の dead export 化**: Stage 2 後、src 内の参照は定義(`weeklyPlanningConstraintParsing.ts:155`)のみで、production・テストのどこからも import されていない。
2. **`NoteNoFixedEventsCommand.noFixedEvents: true` の冗長 payload**: 常に `true` のリテラル型で、reducer の `? ... : state` の else 枝は到達不能。防御的 payload として残すか削除するかが未判断。
3. **priority missing ブロックが reducer 本体に直書き**: `applyWeeklyPlanningUserTurn` 末尾(fallback 適用後・`finalizeState` 前)に、`examPrepScope あり && unitRates.length > 0 && priorityPolicy.kind === 'unknown' && year_range/completion_direction が missing にない` のとき `missing` へ `priority_policy` / `next_field_after_math` を**直接 mutation**(`nextState.missing = addMissing(...)`)で追加するブロックがある。日本語は見ていないが、missing 決定ロジックが `weeklyPlanningMissingStatus.ts` と reducer 本体に分散している。
4. **このブロックの発火側テストがない**: 現状のカバレッジは `weeklyPlanningRoleplayScenarios.test.ts:180` の否定アサーション(priority 確定後に `next_field_after_math` が残らない)1件のみ。発火条件(4条件が揃うと追加される)と非発火条件(どれか欠けると追加されない)を直接固定するテストは存在しない。
5. **Stage 1a/2 完了記録が未整理**: closed 配下の親 goal md は編集対象外とし、本md内の完了メモまたは作業報告に残す。

## 対象ファイル

- Phase A:
  - `src/features/weeklyPlanning/intake/weeklyPlanningConstraintParsing.ts`(dead export の削除、または残す理由のコメント化)
  - `src/features/weeklyPlanning/intake/weeklyPlanningCommandTypes.ts` / `weeklyPlanningCommandAdapter.ts` / `weeklyPlanningIntakeReducer.ts`(payload 調査。実装は条件付き — 後述)
  - `docs/ai/tasks/20260703-weekly-planning-r1-cleanup-and-stage3-goal.md`(Stage 1a/2 completion memo policy; record in this md or final report, and do not edit the closed parent goal md)
- Phase B:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts`(現状固定テスト追加)
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts` / `weeklyPlanningMissingStatus.ts`(等価性が確認できた場合のみ移設)

ここに挙げたファイル以外の production code は変更しない。

## フェーズ構成

### Phase A: Stage 1a/2 後の軽い整理

1. **`hasExplicitNoFixedEvents` の扱いを確定する。** src / テスト全体を grep して参照ゼロを確認したうえで、次のどちらかを行う:
   - 削除する(参照ゼロなら挙動変更なしの安全な削除。`parseNoFixedEventsSourceSegment` と `parseNoteNoFixedEventsCommand` は残す)。
   - 公開 helper として残す場合は、残す理由(想定利用者)をコメントで明文化する。理由が書けないなら削除を選ぶ。
2. **`noFixedEvents: true` payload の要否を調査する。** 削除する場合の影響範囲(command 型、parser、adapter 関数の存廃、reducer case、テスト)を整理し、推奨を報告する。**変更が型とテストの機械的な追随だけで完結し、挙動変更を伴わないことが確実な場合のみ実装してよい。** 少しでも挙動変更の可能性がある、または判断に迷う場合は、実装せず調査結果の報告で止める。
3. **Stage 1a / Stage 2 の完了記録を本md内の完了メモ、または作業報告に残す**(完了日・変更概要・レビュー結果の1〜3行ずつ)。closed 配下の親 goal md には追記しない。

### Phase B: priority missing ブロックの移設検討(R1 Stage 3 相当)

**テスト先行を厳守する。** 順序:

1. **現状固定テストを追加する。** reducer 経由(`applyWeeklyPlanningUserTurn`)で、少なくとも:
   - 発火ケース: examPrepScope + unit rate が揃い、priority 未確定、`year_range` / `completion_direction` が解消済みのターンで `missing` に `priority_policy` と `next_field_after_math` の両方が追加されること(既存 roleplay helper `applyWeekendExamReadyForLifeConstraints` 相当の状態遷移を参考にする)。
   - 非発火ケース: (a) priorityPolicy が確定済み(`set_priority_policy` 後)、(b) `year_range` が missing に残っている、の少なくとも2条件で追加されないこと。
   - 期待値は必ず現在の実装を実行して観察した結果から書く。
2. **等価性を調査する。** ブロックを `weeklyPlanningMissingStatus.ts`(`finalizeState` 内、status 解決の前)へ移した場合に挙動等価かを確認する。確認すべき点:
   - 現在の実行位置は「fallback 適用後・finalizeState 直前」であり、finalizeState 冒頭に移しても間に他の処理が挟まらないこと。
   - 判定が読む state フィールド(examPrepScope / unitRates / priorityPolicy / missing)が移設後も同じ値であること。
   - 直接 mutation(`nextState.missing = ...`)を immutable な形に直しても結果が変わらないこと。
3. **等価性が確認できた場合のみ移設を実施する。** 手順1のテストと既存テストすべてが期待値変更なしで green のままであることを確認する。
4. **等価性の証明が難しい場合、または現状固定テストが手順1で十分に書けない場合は、移設を実施せず**、何が障害かを発見事項として整理し、次タスク提案(どんなテストや分解が必要か)を報告して止める。

## 各フェーズの受け入れ条件

### Phase A

- `hasExplicitNoFixedEvents` が「削除」または「理由コメント付きで存置」のどちらかに確定している(参照ゼロの確認結果が報告に含まれている)。
- payload 調査の結論(削除推奨/存置推奨と理由)が報告されている。実装した場合は挙動変更なしの根拠と全テスト green。
- Stage 1a/2 の完了記録が、本md内の完了メモまたは作業報告に残されている。closed 配下の親 goal md は編集されていない。
- 既存テストすべて green(placementScoring の既知失敗1件を除く)。

### Phase B

- 発火・非発火の現状固定テストが追加され、**移設の前に** green であること。
- 移設した場合: reducer 末尾からブロックが消え、`weeklyPlanningMissingStatus.ts` 側に等価なロジックがあり、全テストが期待値変更なしで green。等価性の根拠が報告されている。
- 移設しなかった場合: 障害の内容と次タスク提案が報告されている(これも正常な完了として扱う)。

## 触らない範囲

- UI / CSS、`scheduling/`(placement scoring・availability・draft 生成アルゴリズム)、`preview/`、`dialogue/`、保存・承認導線、通常予定導線、`shouldSavePlan: false` の維持。
- **fallback 縮小、pipeline と reducer 直呼びの previousState truthiness の意味論変更、branch B の仕様変更** — Stage 4 以降の設計判断が必要な別作業。調査も含めて進めない。気づきがあれば発見事項に書くだけにする。
- `looksLikeWeeklyPlanningRequest` の仕様変更、「あと物理」タイトル正規化(R2 で扱う)。
- `scheduling/placementScoring.test.ts` の既知失敗1件。
- 既存 regression テスト(fallback 10件、note_no_fixed_events 系14件ほか)の入力・期待値。
- コミット済みの Stage 1a/2 の変更(`628a7b3`)を巻き戻す・書き換えること(本goalはその上に積む)。

## 停止条件

以下のいずれかに該当したら作業を止め、状況を報告してユーザー判断を仰ぐ。

- Phase A の payload 変更、または Phase B の移設が、挙動変更なしでは達成できないと判明したとき。
- Phase B 手順1の現状固定テストが、既存 helper では組み立てられない等の理由で十分に書けないとき。
- 変更が「対象ファイル」に挙げた範囲の外へ波及したとき。
- 「触らない範囲」の項目に関わる変更・調査が必要に見えたとき(発見事項として報告し、進めない)。

## テスト観点

- Phase A: 削除・変更のたびに `npm run test:run src/features/weeklyPlanning` と `npm run build`(tsc 込み)で参照切れがないことを確認する。payload を変更した場合は `note_no_fixed_events` 系14件が期待値変更なしで green であること。
- Phase B: 追加テストは `weeklyPlanningIntakeEdgeCases.test.ts` に置き、describe / it 名に「priority missing」を含める。スナップショットは使わない。移設後は追加テスト+既存の roleplay(`next_field_after_math` の否定アサーション含む)+edge cases+fallback+pipeline がすべて green。
- 各フェーズ完了時に対象テスト、`npm run test:run src/features/weeklyPlanning`、`npm run build`、`git diff --check`、`git diff --stat`、`git status -sb` を報告する。

## Codex/Fableへの実装指示

- Phase A → Phase B の順に進める。**Phase の途中で両フェーズの変更を混ぜない**(報告・コミット単位を分けられる状態を保つ)。
- Phase B は必ず「テスト追加 → green 確認 → 等価性調査 → 移設(可能な場合のみ)」の順で行う。テストより先に production code を触らない。
- 期待値は観察してから書く。不自然な挙動(例: 発火条件の意図が読めない等)を見つけても修正せず、発見事項として報告する。
- 日本語文字列は `\uXXXX` エスケープではなく生の日本語で書く。
- git add / commit / push はしない。コミットはユーザー指示後に行う。
- `docs/ai/codex-task-guide.md` に従う: 本mdの範囲外へ広げない、発見した対象外の問題は報告のみ。

## Phase A Completion Memo

- 2026-07-03 Phase A: `hasExplicitNoFixedEvents` was confirmed as definition-only in src/tests and removed as a dead export. `parseNoFixedEventsSourceSegment` and `parseNoteNoFixedEventsCommand` remain.
- 2026-07-03 Phase A: `NoteNoFixedEventsCommand.noFixedEvents: true` was treated as redundant because the parser returning `note_no_fixed_events` already carries the confirmation. The command type, parser payload, adapter, reducer case, and edge-case expectations were updated mechanically with no intended behavior change.
- 2026-07-03 Phase A: Stage 1a / Stage 2 completion is recorded here; the closed parent goal md is not edited.
