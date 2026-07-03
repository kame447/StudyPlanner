# pipeline 経由の legacy fallback 初回ターン挙動を固定する(テストのみ)

## 背景

R1-2 で reducer 直呼び(`applyWeeklyPlanningUserTurn`)経由の legacy fallback regression テスト(`__tests__/weeklyPlanningLegacyFallback.test.ts`、7件)を追加し、R1-3 で fallback branch A / branch B を `intake/weeklyPlanningLegacyFallback.ts` へ隔離した。

一方、`runWeeklyPlanningIntakePipeline`(`pipeline/weeklyPlanningIntakePipeline.ts`)は `input.previousState ?? createInitialPlanningIntakeState()` を渡すため、**pipeline 経由では初回ターンでも reducer の `previousState` 引数が常に truthy** になる。reducer 直呼び(`undefined` 渡し)とは branch B の発火条件が異なり得るのに、pipeline 経由で初回ターンを通した場合の fallback 挙動はまだどのテストにも固定されていない。R1-3 の任意項目として見送られた残作業である。

## 目的

`runWeeklyPlanningIntakePipeline` 経由の初回ターン(previousState なし)について、legacy fallback の挙動を現挙動どおりテストで固定する。特に branch A(assess 経路)が pipeline 経由でも維持されていることと、reducer 直呼びとの `previousState` truthiness 差分が生む挙動を明示的に記録する。**production code は一切変更しない。**

## 計画書・roadmapとの対応

- spec: §12(責務分離の基盤整備)
- roadmap: Phase R1(legacy fallback 整理の残項目)。R1-2 / R1-3 の引き継ぎ事項の完了。
- 参照: `docs/ai/tasks/closed/20260702-weekly-planning-legacy-fallback-regression.md` の「Closed note: R1-3 handoff」、`docs/ai/tasks/closed/20260702-weekly-planning-legacy-fallback-isolation.md`

## 対象ファイル

- 変更: なし(production code は変更禁止)
- 新規: なし
- テスト:
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`(既存ファイルへケース追加)

**注意**: 配置先は pipeline ディレクトリ配下の上記ファイルである。`__tests__/weeklyPlanningIntakePipeline.test.ts` という過去の指定は誤りで、そのようなファイルは存在しない。

## 現在の処理経路

1. `runWeeklyPlanningIntakePipeline` は `previousState ?? createInitialPlanningIntakeState()` を `applyWeeklyPlanningUserTurn` に渡す(`weeklyPlanningIntakePipeline.ts:45`)。初回ターン(呼び出し側が `previousState` を渡さない)でも reducer には truthy な初期 state が入る。
2. reducer 末尾で `applyLegacyWeeklyPlanningFallback({ state, previousState, userText, context })` が呼ばれる(`intake/weeklyPlanningLegacyFallback.ts`)。
   - branch A: `intent === 'unknown' && looksLikeWeeklyPlanningRequest(userText)` → assess。`previousState` の truthiness に依存しない。
   - branch B: else-if `previousState && intent === 'weekly_study_planning'` → revision merge。**pipeline 経由では初回ターンでも `previousState` が truthy のため、同一ターン内の setup command(`set_planning_range` 等)が intent を確定させると branch B が発火し得る**(previousText は `sourceTurns.join('、')` = 空文字)。
3. pipeline は state に加えて `draftRequest` / `decision` などを返す(`WeeklyPlanningIntakePipelineOutput`)。
4. 既存の pipeline テストには `defaultPipelineInput` と `runTurn(previousState, userText)` helper があり、再利用できる。

## 問題点

- pipeline 経由の初回ターンで branch A の assess 挙動(intent / tasks / missing)が維持されていることを固定するテストがない。fallback の今後の縮小時に、pipeline 側の regression を検出できない。
- reducer 直呼び(`undefined`)と pipeline 経由(truthy 初期 state)の差分は R1-2 / R1-3 のレビューで文書とコメントに記録されたが、テストとしては未固定。特に「setup command が intent を確定するターン」で reducer 直呼びでは tasks が空のまま(R1-2 テスト4)だが、pipeline 経由では branch B が発火して tasks が埋まる可能性が高い、という乖離が観察されていない。

## 修正方針

**テストのみを追加する。** `pipeline/weeklyPlanningIntakePipeline.test.ts` に「legacy fallback via pipeline」と分かる describe を追加し、以下を固定する。

期待値は必ず**現在の実装を実行して観察した結果**から決めること。不自然な挙動が見つかっても修正せず、テストは現挙動に合わせ、発見事項として報告する。

1. **branch A 初回ターン(主観点)**: `runTurn(undefined, '来週、英語を3時間、数学を2時間')` で、`output.state` が branch A の assess 経路に入ること。固定する項目:
   - `intent: 'weekly_study_planning'`
   - `tasks`(タイトル・subject・unit・amount・rawText。reducer 直呼びの R1-2 テスト1と同じ結果になるはず — branch A は `previousState` に依存しないため。一致しない場合はそれ自体が発見事項)
   - `missing`(観察どおり。おそらく `['life_constraints']`)
   - `sourceTurns`(入力1件のみ)
   - `status` / `shouldSavePlan: false`
   - pipeline 出力として `draftRequest` が `null` であること(draft_ready ではないため)
2. **branch A 非突入の初回ターン**: `runTurn(undefined, '英語を3時間、数学を2時間')`(週キーワードなし)で intent が `unknown` のまま、tasks が空、`draftRequest` が `null` であること。
3. **truthiness 乖離の固定(引き継ぎ事項)**: `runTurn(undefined, '今日の19時から土日の終わりまで予定立てたい。英語を3時間、数学を2時間')` — reducer 直呼びの R1-2 テスト4と同一入力。pipeline 経由では `previousState` が truthy になるため branch B の発火有無・tasks の中身が reducer 直呼び(tasks 空)と異なる可能性が高い。**先に実行して観察し、観察結果をそのまま固定する。** テスト名またはコメントで「reducer 直呼き(undefined)とは previousState truthiness が異なる経路であり、意図的にその差分を固定している」ことを明記する。

観点3が観察の結果 reducer 直呼びと同一挙動だった場合も、その事実をそのまま固定し、報告に記載する(乖離の有無自体が引き継ぎ事項の答えになる)。

## 触らない範囲

- **production code 全部**: `weeklyPlanningLegacyFallback.ts`、`weeklyPlanningIntakeReducer.ts`、`weeklyPlanningIntakePipeline.ts`(`?? createInitialPlanningIntakeState()` の変更は禁止)、transforms、parsing、scheduling、UI。
- 既存テスト: `__tests__/weeklyPlanningLegacyFallback.test.ts`(R1-2 / R1-3 の7件)、`pipeline/weeklyPlanningIntakePipeline.test.ts` の既存ケースと `defaultPipelineInput` / `runTurn` 等の既存 helper の挙動(helper の再利用は可、変更は不可)。
- 既存 fixture の値(`weeklyPlanningRoleplayCases.ts` など。追加は可、変更は不可)。
- `scheduling/placementScoring.test.ts` の既知失敗1件(範囲外。触らず報告に記載)。
- 「あと物理」タイトル正規化、`looksLikeWeeklyPlanningRequest` 仕様変更、`hasExplicitNoFixedEvents` command 化 — すべて別タスク。

## 受け入れ条件

- `pipeline/weeklyPlanningIntakePipeline.test.ts` に上記観点1〜3のテストが追加され、**production code 無変更**で全ケース green であること。
- 観点1が branch A 経由であることを担保する入力(週キーワード + `N時間`×2、かつ `set_planning_range` / `set_exam_scope` / constraint parser にマッチしない文言)になっていること。
- 観点3のテストに、reducer 直呼びとの差分(または一致)を説明するコメントがあること。
- 既存テストがすべて green のまま(placementScoring の既知失敗1件を除く。期待値の変更・削除・skip なし)。
- `git diff` にテスト追加(と、必要な場合の fixture 追記)以外の変更がないこと。

## テスト観点

「修正方針」の1〜3がそのままテスト観点である。補足:

- assert は `toMatchObject` / 明示的な expect で書き、スナップショットは使わない。
- describe / it 名に「legacy fallback」と「pipeline」を含め、reducer 直呼び側のテスト(`weeklyPlanningLegacyFallback.test.ts`)と対応が取れるようにする。
- 観点1と R1-2 テスト1の期待値が一致した場合、値のコピーで二重管理になるが許容する(pipeline 層の独立した安全網が目的のため)。

## リスク

- 観点3は観察前に期待値を予断できない(branch B が発火して tasks が埋まる可能性が高いが、`mergeWeeklyPlanningRevision` が範囲表現の文言から何を抽出するかは実行するまで不明)。**必ず観察してから期待値を書く**こと。
- 観点1の入力が意図せず他 parser(exam scope・unavailable 等)にマッチすると、fallback 以外の経路を固定してしまう。R1-2 と同じ入力文言(「来週、英語を3時間、数学を2時間」)を使えばこのリスクは回避できる。
- 既存 pipeline テストの `defaultPipelineInput` は `sessionPolicy` を含む。観点1〜3は draft 生成に到達しない想定のため影響しないはずだが、`draftRequest: null` の確認で担保する。
- このテストも「現挙動の固定」であり、branch B の初回発火が仕様として正しいかの判断はしない(判断は roadmap 側)。

## Codexへの実装指示

1. まず `pipeline/weeklyPlanningIntakePipeline.test.ts` の既存 helper(`defaultPipelineInput` / `runTurn`)と、`intake/weeklyPlanningLegacyFallback.ts` の branch A / branch B の条件を実コードで確認する。
2. 観点1 → 2 → 3 の順にテストを書く。各ケースで実行結果を観察してから期待値を確定する。特に観点3は、観察結果(branch B 発火の有無、tasks の中身)をそのまま固定し、reducer 直呼びとの差分をコメントに書く。
3. production code・既存テスト・既存 fixture を一切変更しない。変更が必要に見えた場合は、その旨を報告に書いて止める。
4. 観察で見つかった不自然な挙動(例: branch B が空 previousText で発火する、範囲文言からタスクが抽出される等)は修正せず「発見事項」として報告に列挙する。
5. `docs/ai/codex-task-guide.md` に従うこと: タスクmd外へ広げない、git add / commit / push をしない、作業後に対象テスト(`npm run test:run src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts`)、fallback regression(`npm run test:run src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts`)、`npm run test:run src/features/weeklyPlanning`、`npm run build`、`git diff --check`、`git diff --stat`、`git status -sb` を報告する。
