# legacy fallback 経路を専用モジュールへ隔離し reducer 本体を薄くする(挙動変更なし)

## 背景

`applyWeeklyPlanningUserTurn`(`intake/weeklyPlanningIntakeReducer.ts`)の末尾には、command boundary に乗っていない legacy fallback が2分岐残っている(`TODO(Phase 9.8)` コメント付き)。R1-2(`docs/ai/tasks/closed/20260702-weekly-planning-legacy-fallback-regression.md`)でこの2分岐の現挙動を固定する regression テスト(`__tests__/weeklyPlanningLegacyFallback.test.ts`、6件)が整備され、隔離リファクタの安全網ができた。roadmap Phase R1-3 として、この fallback を現挙動を変えずに専用モジュールへ切り出し、reducer 本体から旧 weekly parser への直接依存をなくす。

## 目的

reducer 末尾に残る legacy fallback branch A / branch B を、**現挙動を変えずに**専用関数(専用モジュール)へ隔離し、`applyWeeklyPlanningUserTurn` 本体を薄くする。fallback の入出力境界(特に `previousState` の truthiness に依存する分岐条件)をコード上明示し、将来の fallback 縮小・ルート分岐変更の足場を作る。

## 計画書・roadmapとの対応

- spec: §12(責務分離の基盤整備)
- roadmap: Phase R1-3(legacy fallback の隔離。R1-2 完了済みが前提)
- ガイド: `docs/ai/weekly-planning-pipeline-guide.md` §3(reducer に自然言語解釈を増やさない)、§6(legacy fallback 経路の整理)

## R1-2 で固定済みの regression(このタスクの安全網)

`__tests__/weeklyPlanningLegacyFallback.test.ts` の6件。**期待値を一切変えずに green を維持すること。**

1. branch A 突入: 「来週、英語を3時間、数学を2時間」→ intent / tasks(unit 'minutes'、amount 分換算)/ missing `['life_constraints']`
2. branch A 非突入: 週キーワードなし → intent `unknown`、tasks 空
3. branch A 非突入: 時間言及なし + `set_exam_scope` が intent を確定(2条件同時成立ケース)
4. branch A スキップ: `set_planning_range` 成立時(**`previousState: undefined` が前提条件**。後述)
5. branch B merge: revision で tasks が title ベース merge される(「あと物理」タイトルは現挙動として固定済み)
6. branch B 非突入: exam prep intent の状態では branch B の intent 条件が落ちる

## 今回隔離する fallback の現在の条件

`applyWeeklyPlanningUserTurn` 末尾(uncertainty / `hasExplicitNoFixedEvents` 処理の後、priority missing 追加の前)にある。

### branch A(初回 assess fallback)

- 条件: `nextState.intent === 'unknown' && looksLikeWeeklyPlanningRequest(userText)`
- 処理: `assessWeeklyPlanningRequest({ selectedDate, text })` → `intent: 'weekly_study_planning'` 設定、`assessment.tasks` を `mapWeeklyAmountUnit` で `StudyTaskScope[]` に写像、`assessment.kind !== 'ready'` のとき `missing` に `life_constraints` 追加。

### branch B(revision merge fallback)

- 条件: branch A の else-if で `previousState && nextState.intent === 'weekly_study_planning'`
- 処理: `mergeWeeklyPlanningRevision({ previousText: previousState.sourceTurns.join('、'), revisionText: userText })` → `revision.tasks.length > 0 && !nextState.examPrepScope` のときだけ `tasks` を merge 結果で置換。

依存 import: `looksLikeWeeklyPlanningRequest` / `assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision`(`../weeklyPlanningTransforms`)、および fallback 専用 helper `mapWeeklyAmountUnit`(reducer 内 private)。

## previousState に関する注意(R1-2 引き継ぎ)

- `runWeeklyPlanningIntakePipeline`(`pipeline/weeklyPlanningIntakePipeline.ts:45`)は `input.previousState ?? createInitialPlanningIntakeState()` を渡すため、**pipeline 経由では初回ターン相当でも reducer の `previousState` 引数は truthy** になる。
- そのため branch B は、ユーザー体験上は初回相当の入力でも発火し得る(previousText は空文字)。branch B の発火条件は「会話が2ターン目以降か」ではなく「呼び出し元が truthy な previousState を渡したか」である。
- regression テスト4(setup command 優先)は `previousState: undefined` の reducer 直呼びであることが前提条件になっている(truthy を渡すと branch B が同一ターンで発火し `tasks: []` が壊れる)。**このタスクでは truthiness の意味論を一切変えない。** 隔離後の関数も、`previousState`(`PlanningIntakeState | undefined`)をそのまま受け取り、同じ `previousState &&` 判定を維持する。初回/継続の判定境界を「明示的な引数として見える」ようにするのが目的であり、判定ロジックの変更(例: sourceTurns 長での初回判定への置換)は**やらない**(挙動が変わるため別タスク)。

## examPrepScope ガード未到達問題(R1-2 引き継ぎ)

R1-2 の exam prep regression(テスト6)は、branch B 内部の `!nextState.examPrepScope` ガードの直接検証ではない。exam prep フローでは intent が `exam_prep_planning` のため branch B の intent 条件自体が落ちており、ガードには到達していない。

このタスクでは、隔離と同時にこのガードを直接検証する regression を1件追加する: `intent: 'weekly_study_planning'` かつ `examPrepScope` ありの `PlanningIntakeState` を**テスト内で手組みで構築**し(reducer ターンの積み上げでは作りにくいため object literal でよい。`sourceTurns` に前ターン相当の文字列を入れる)、revision 相当のターンを適用して `tasks` が置換されないことを固定する。期待値は現在の実装を実行して観察した結果から書くこと。

## 変更対象候補

- 新規: `src/features/weeklyPlanning/intake/weeklyPlanningLegacyFallback.ts`
  - 例: `applyLegacyWeeklyPlanningFallback(params: { state: PlanningIntakeState; previousState: PlanningIntakeState | undefined; userText: string; context: WeeklyPlanningIntakeContext }): PlanningIntakeState`
  - branch A / branch B の分岐と処理、`mapWeeklyAmountUnit` をこのモジュールへ移す。
  - `TODO(Phase 9.8)` コメントもこのモジュールへ移す(削除しない)。
  - `previousState` の truthiness が分岐条件であることを短いコメントで明示する(pipeline は常に truthy を渡す旨を含める)。
- 変更: `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`
  - fallback 2分岐と `mapWeeklyAmountUnit` を削除し、新モジュールの関数呼び出し1箇所に置き換える。
  - `../weeklyPlanningTransforms` からの `looksLikeWeeklyPlanningRequest` / `assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` import を reducer から除去する(新モジュール側へ移動)。
- テスト: `src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts`
  - 既存6件は**期待値・入力とも変更しない**。
  - examPrepScope ガード直接検証の1件を追加する(前節)。
  - 任意(推奨): pipeline 経由の初回ターンで branch B が発火し得ることを固定するケースを1件追加する(`runWeeklyPlanningIntakePipeline` を `previousState` なしで呼び、regression テスト4と同じ入力を与えて、reducer 直呼びとの差分を現挙動どおり固定する。期待値は必ず観察してから書く)。作業量が大きくなる場合は見送り、報告に記載する。

## 触らない範囲

- **挙動変更の一切**: 分岐条件、`previousState` の truthiness 意味論、`mapWeeklyAmountUnit` の写像、missing 追加条件を変えない。
- `weeklyPlanningTransforms.ts` 本体(`looksLikeWeeklyPlanningRequest` / `assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` の実装)。`looksLikeWeeklyPlanningRequest` の仕様変更は別タスク。
- revision merge のタイトル改善(「あと物理」の接続詞正規化)— 別タスク。
- `hasExplicitNoFixedEvents` の command 化 — 別タスク。
- `scheduling/placementScoring.test.ts` の既知失敗1件 — 別タスク(触らず報告に記載)。
- `pipeline/weeklyPlanningIntakePipeline.ts` の `previousState ?? createInitialPlanningIntakeState()` — 変更しない(テストから呼ぶのは可)。
- 既存 regression テスト6件の入力・期待値、既存 fixture の値。
- command 層(`weeklyPlanningCommandTypes.ts` / adapter / 各 parser)、`scheduling/`、`preview/`、`dialogue/`、UI / CSS、保存・承認導線、`shouldSavePlan: false` の維持。

## 受け入れ条件

- `applyWeeklyPlanningUserTurn` の本体から fallback 2分岐のロジックと `mapWeeklyAmountUnit` が消え、新モジュールの関数呼び出しに置き換わっている。
- reducer が `weeklyPlanningTransforms` の fallback 3関数を直接 import していない(依存が新モジュールに集約されている)。
- 既存の `weeklyPlanningLegacyFallback.test.ts` 6件が、入力・期待値の変更なしで green。
- examPrepScope ガード直接検証テストが追加され green(手組み state で `!nextState.examPrepScope` ガードに実際に到達していること)。
- 既存テストすべて green(placementScoring の既知失敗1件を除く。期待値の変更・削除・skip なし)。
- `TODO(Phase 9.8)` コメントが新モジュールに残っている。

## テスト観点 / 実装時に必ず走らせるテスト

実装後、以下を順に実行しすべて報告する。

```bash
# 1. fallback regression(最重要の安全網)
npm run test:run src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts

# 2. reducer 経由の広い regression
npm run test:run src/features/weeklyPlanning/__tests__/weeklyPlanningIntakeEdgeCases.test.ts
npm run test:run src/features/weeklyPlanning/__tests__/weeklyPlanningRoleplayScenarios.test.ts
npm run test:run src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts

# 3. weeklyPlanning 全体
npm run test:run src/features/weeklyPlanning

# 4. ビルドと diff 確認
npm run build
git diff --check
git diff --stat
git status -sb
```

## リスク

- 隔離時に `nextState` への適用順序(uncertainty / `hasExplicitNoFixedEvents` 処理の後、priority missing 追加の前)を変えると挙動が変わる。呼び出し位置は現在の分岐と同じ場所にすること。
- `previousState` を新関数へ渡し忘れて `baseState` や `nextState` で代用すると、truthiness の意味論が変わり regression テスト4が壊れる(壊れた場合はテストではなく実装を疑うこと)。
- 手組み state によるガード検証テストは、`PlanningIntakeState` の必須フィールドを漏らすと型エラーになる。`createInitialPlanningIntakeState()` を spread して必要フィールドだけ上書きする形が安全。
- pipeline 経由テスト(任意項目)は現挙動の観察が前提。観察せずに期待値を書かないこと。

## Codexへの実装指示

1. まず `applyWeeklyPlanningUserTurn` の fallback 2分岐と `mapWeeklyAmountUnit`、および transforms からの import を実コードで確認する。
2. examPrepScope ガード直接検証テストを**先に**追加し、現実装のまま green を確認する(現挙動の観察→期待値確定)。
3. 新モジュール `weeklyPlanningLegacyFallback.ts` を作成し、fallback ロジックを**そのまま移動**する(書き換え・最適化をしない)。reducer を関数呼び出しに置き換える。
4. すべてのテストが期待値変更なしで green のままであることを確認する。1件でも赤くなったら、テストではなく移動内容(適用順序・引数)を疑う。
5. 任意項目(pipeline 経由の初回ターン固定テスト)は、余力がある場合のみ。追加した/見送った旨を報告に書く。
6. `docs/ai/codex-task-guide.md` に従うこと: タスクmd外へ広げない(looksLike 仕様変更・タイトル正規化・hasExplicitNoFixedEvents・placementScoring 修正はすべて別タスク)、git add / commit / push をしない、上記「実装時に必ず走らせるテスト」の結果をすべて報告する。
