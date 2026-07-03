# [Goal] R1 command boundary 整理の残作業を依存順に完了させる

このmdは単発の実装タスクmdではなく、**複数タスクを束ねる goal md** である。Claude/Fable はこの goal を親として Stage ごとの調査・設計・タスク切り出しを行い、Codex は切り出された個別タスク(または本mdで直接指定された Stage)だけを実装する。roadmap Phase R1(command boundary の完成と reducer 薄化)の完了が目標。

## 背景

weeklyPlanning intake は parser → `ParsedWeeklyPlanningCommand` → adapter → reducer の境界へ段階移行してきた。R1-1〜R1-3 と pipeline regression までで、reducer に残る自然言語解釈は大幅に減ったが、まだ command boundary に乗っていない処理・特殊分岐・テスト不足が残っている。細かい単発タスクを毎回切るより、残作業を一括で調査・整理し、依存順に潰す。

## 完了済み作業(前提)

| 完了項目 | 記録 |
| --- | --- |
| progressHint の command 化(`note_progress_boundary`) | `tasks/closed/20260702-weekly-planning-progress-hint-command.md` |
| uncertainty 正規表現の command 化(`note_uncertainty`) | `tasks/closed/20260702-weekly-planning-uncertainty-command.md` |
| reducer 直呼びの legacy fallback regression 7件 | `tasks/closed/20260702-weekly-planning-legacy-fallback-regression.md`(R1-3 handoff note 付き) |
| fallback の `intake/weeklyPlanningLegacyFallback.ts` への隔離 | `tasks/closed/20260702-weekly-planning-legacy-fallback-isolation.md` |
| pipeline 経由の fallback regression 3件(truthiness 乖離の固定込み) | `tasks/closed/20260702-weekly-planning-pipeline-fallback-regression.md` |

fallback は reducer 7件 + pipeline 3件 = 計10件の regression で固定済み。

## 残っている問題

1. **`hasExplicitNoFixedEvents` が command boundary 外**: reducer(`weeklyPlanningIntakeReducer.ts:321`)が parser 層の boolean 関数(`weeklyPlanningConstraintParsing.ts:137`、「固定予定ない」等の正規表現)を直接呼び、`missing` から `fixed_events` を直接除去している。隔離済み fallback を除けば、reducer に残る最後の自然言語由来の直接分岐。
2. **legacy fallback 本体が残存**: 隔離・固定は済んだが、branch A / branch B 自体は生きている。縮小・置換は挙動変更を伴うため未着手。
3. **pipeline / reducer 直呼びの previousState 乖離は「固定」されたが「未解決」**: pipeline は初回ターンでも truthy な初期 state を渡すため branch B が発火し得る(pipeline テスト3で固定済み)。初回/継続の意味論をどう定義し直すかは設計判断が必要。
4. **branch B 発火時の不整合(観察済み)**: pipeline テスト3で、branch B が tasks を埋めても `missing` に `tasks_or_goals` が残り status が `needs_scope` になる。tasks の実体と missing 判定がずれている。
5. **regression 不足**: `hasExplicitNoFixedEvents` の reducer 経由直接固定(現状は roleplay の `noFixedEvents` ターン経由の間接カバーのみ)、`assessWeeklyPlanningRequest` の `kind !== 'ready'` 系分岐、reducer 末尾の priority missing 追加ブロックの条件。
6. **軽微**: Codex 追加テストの日本語が `\uXXXX` エスケープ表記(fallback 直呼びテスト7件目、pipeline テスト3件)で可読性が低い。

## 実コード上の調査対象

- `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts` — `hasExplicitNoFixedEvents` 分岐、末尾の priority missing 追加ブロック、`applyWeeklyPlanningUserTurn` の残存 orchestration
- `src/features/weeklyPlanning/intake/weeklyPlanningLegacyFallback.ts` — branch A / branch B の現条件
- `src/features/weeklyPlanning/intake/weeklyPlanningConstraintParsing.ts` — `hasExplicitNoFixedEvents` の正規表現と、他の constraint command との関係
- `src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts` — missing / status / questions の決定ロジック(priority missing ブロックの移設先候補)
- `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts` — `previousState ?? createInitialPlanningIntakeState()`
- テスト: `__tests__/weeklyPlanningLegacyFallback.test.ts`、`__tests__/weeklyPlanningIntakeEdgeCases.test.ts`、`pipeline/weeklyPlanningIntakePipeline.test.ts`(既存カバレッジの正確な把握)

## 実装候補(Stage 構成)

### Stage 1: 現状固定テストの補完(テストのみ・挙動変更なし)

- 1a. `hasExplicitNoFixedEvents` の reducer 経由挙動を直接固定する(マッチする表現で `fixed_events` missing が除去される / マッチしない表現では除去されない / 否定でない「予定がある」系で誤発火しない)。
- 1b. 既存カバレッジの棚卸し: edge cases / roleplay / pipeline テストが R1 残存箇所(上記「残っている問題」1〜5)をどこまで押さえているかを整理し、この goal md への追記または報告として記録する。

### Stage 2: `hasExplicitNoFixedEvents` の command 化(挙動変更なしリファクタ)

- `note_no_fixed_events` command(payload なしに近い最小形 + sourceText / sourceSegment / confidence)を追加し、`note_uncertainty` と同型の3点セット(parse / adapter(必要なら passthrough)/ reducer case)で reducer の直接分岐を置換する。
- 適用位置(main command batch 後)を変える場合は挙動等価の根拠を確認する。等価にできなければ現位置のまま command 化だけ行う。
- 前提: Stage 1a のテストが green で存在すること。

### Stage 3: reducer 末尾の priority missing ブロックの整理(挙動変更なしで可能な場合のみ)

- `examPrepScope && unitRates && priorityPolicy unknown && ...` → `priority_policy` missing 追加のブロックは日本語を見ていないが、状態遷移ルールが reducer 本体に直書きされている。`finalizeState` / `weeklyPlanningMissingStatus.ts` への移設が挙動等価で可能かを調査し、可能なら移設、不可能なら理由を記録して現状維持。
- 前提: 移設対象の条件を固定するテスト(Stage 1b で不足が判明した場合は追加)。

### Stage 4: fallback 縮小と初回ターン意味論の設計(設計のみ・実装しない)

- branch B の「truthy previousState で初回でも発火」を維持するか、明示的な初回/継続判定(例: `sourceTurns` 長、明示引数)に置き換えるかの設計案を作る。問題4(tasks が埋まっても `tasks_or_goals` missing が残る)の扱いも含める。
- **挙動変更を伴うため、設計案の提示で停止し、ユーザー判断を仰ぐ。** 承認された場合のみ別タスクmdとして切り出す。

## 依存順序

```text
Stage 1a(hasExplicitNoFixedEvents テスト固定)
  -> Stage 2(command 化)          … テスト先行原則
Stage 1b(カバレッジ棚卸し)        … 1a と並行可
  -> Stage 3(priority ブロック整理)… 不足テストを 1b で発見してから
Stage 4(設計のみ)                 … 1〜3 と独立に着手可、実装はユーザー承認後
```

- Stage 1a → 2 が主経路。**production code を変更する Stage は、対象挙動の regression テストが先に存在することを必須条件とする。** テストが足りなければ、実装より先に現状固定テスト追加を優先する。
- Stage 2 と 3 は別コミット(別作業単位)にする。1つの作業で混ぜない。

## 受け入れ条件(goal 全体)

- `applyWeeklyPlanningUserTurn` 本体から、fallback 呼び出し1箇所を除く自然言語由来の直接分岐が消えている(`hasExplicitNoFixedEvents` の直接判定が command 経由になっている)。
- production code の変更はすべて、事前に存在する regression テストの green 維持で裏づけられている(期待値の変更・削除・skip なし。`scheduling/placementScoring.test.ts` の既知失敗1件を除く)。
- Stage 3 は移設した場合も現状維持の場合も、判断根拠が記録されている。
- Stage 4 の成果物は設計文書(この goal md への追記、または `docs/ai/strategy/` 配下)であり、実装を含まない。
- 各 Stage の完了ごとに、テスト・build・`git diff --check` / `--stat` / `git status -sb` が報告されている。

## 触らない範囲

- UI / CSS、`scheduling/`(placement scoring・availability・draft 生成アルゴリズム)、`preview/`、保存・承認導線、`shouldSavePlan: false` の維持。
- 通常予定導線と `looksLikeWeeklyPlanningRequest` の仕様変更。
- 「あと物理」タイトル正規化などの parser 挙動改善(R2 で扱う)。
- `scheduling/placementScoring.test.ts` の既知失敗1件。
- 既存 regression テスト(fallback 10件ほか)の入力・期待値。
- Stage 4 の実装(設計のみ)。

## 停止条件

以下のいずれかに該当したら作業を止め、状況を報告してユーザー判断を仰ぐ。

- 挙動変更なしでは Stage 2 / 3 を達成できないと判明したとき。
- regression テストが存在しない挙動を変更する必要が出たとき(先にテスト追加へ切り替えるか、判断を仰ぐ)。
- 変更対象が `intake/` と対応テストの外(scheduling / UI / transforms 本体など)へ波及したとき。
- Stage 4 の設計案が完成したとき(実装に進まない)。

## Codex/Fableへの実装指示

- **Fable**: この goal を親として、Stage 単位で実コードを再調査してからタスクmd(または Stage 直接指示)を用意する。Stage 1b の棚卸し結果は報告に含め、Stage 3 / 4 の判断材料にする。goal 実行時は、作業報告に Fable 自身の使用モード(中/高)と、Codex 実行時の推奨モード(中/高)の両方を明記する。
- コミットメッセージは `feat: 日本語の説明` の形式で統一する(英語メッセージは使わない)。
- **Codex**: 指示された Stage の範囲だけを実装する。Stage をまたがない。`docs/ai/codex-task-guide.md` に従い、作業後に対象テスト、`npm run test:run src/features/weeklyPlanning`、`npm run build`、`git diff --check`、`git diff --stat`、`git status -sb` を報告する。テスト新設時は既存の `note_uncertainty` / `note_progress_boundary` の3点セットとテストを参照実装とする。日本語文字列は `\uXXXX` エスケープではなく生の日本語で書く。
- git add / commit / push は、ユーザーが明示した範囲以外では行わない。
- 各 Stage 完了ごとにユーザーの確認・承認を得てから次へ進む。完了した Stage の記録はこの goal md に残し、goal 全体が完了したら本mdを `docs/ai/tasks/closed/` へ移す。
