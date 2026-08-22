# legacy fallback 経路の regression テストを整備する(テストのみ)

## 背景

`applyWeeklyPlanningUserTurn`(`intake/weeklyPlanningIntakeReducer.ts`)には、command boundary に乗っていない legacy fallback が2分岐残っている(`TODO(Phase 9.8)` コメント付き)。将来この fallback を隔離・薄化(roadmap R1-3)し、さらに通常予定/週間計画ルートの分岐(`looksLikeWeeklyPlanningRequest`)を見直すには、現在の挙動をテストで固定しておく必要がある。

調査の結果、fallback の関数単体(`assessWeeklyPlanningRequest` 等)は `weeklyPlanningTransforms.integration.test.ts` でテストされているが、**reducer 経由で fallback 分岐を通る regression テストは存在しない**。roleplay / persona テストはすべて `set_planning_range` / `set_exam_scope` command で intent を確定させるため、fallback 分岐に入らない。

## 目的

legacy fallback の2分岐(初回 assess と revision merge)について、reducer 経由の入出力を現在の挙動どおりテストで固定する。**プロダクションコードは一切変更しない。** このテストが green のまま維持されることが、後続の fallback 隔離タスク(R1-3)の安全網になる。

## 計画書・roadmapとの対応

- spec: §12(責務分離の基盤整備)
- roadmap: Phase R1-2(legacy fallback 経路の regression テスト整備)。R1-3(fallback 隔離)と、将来の `looksLikeWeeklyPlanningRequest` 分岐変更の前提タスク。
- ガイド: `docs/ai/weekly-planning-pipeline-guide.md` §4(command 化されていない経路)、§7(ルート分岐変更は regression set 整備が先)

## 対象ファイル

- 変更: なし(プロダクションコードは変更禁止)
- 新規:
  - `src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts`
- テスト: 上記新規ファイルのみ。既存の `weeklyPlanningIntakeEdgeCases.test.ts` は約690行あるため、そこには追加しない。

## 現在の処理経路

`applyWeeklyPlanningUserTurn` の末尾近く(command 適用と `hasExplicitNoFixedEvents` / uncertainty 処理の後)に、次の2分岐がある。

### 分岐A: 初回 assess fallback

- 条件: `nextState.intent === 'unknown' && looksLikeWeeklyPlanningRequest(userText)`
- `looksLikeWeeklyPlanningRequest`(`parsing/weeklyPlanningText.ts:85`)は「`今週|来週|週間|週` を含み、かつ `N時間` の言及が2回以上」で true。
- true の場合 `assessWeeklyPlanningRequest` を呼び、`intent: 'weekly_study_planning'` を設定、`assessment.tasks` を `mapWeeklyAmountUnit`(minutes/words/pages/problems はそのまま、passages→lessons、chapter→chapters、items/material/years→unknown)で `StudyTaskScope[]` に写像して `tasks` に入れる。`assessment.kind !== 'ready'` のときだけ `missing` に `life_constraints` を追加する。
- **重要**: この分岐は setup command(`set_planning_range` / `set_exam_scope`)適用後に評価される。同一ターンの入力が `set_planning_range` にもマッチする場合、intent が先に `weekly_study_planning` になるため分岐Aはスキップされる。

### 分岐B: revision merge fallback

- 条件: `previousState` が存在し、かつ `nextState.intent === 'weekly_study_planning'`(分岐Aの else if)
- `mergeWeeklyPlanningRevision({ previousText: previousState.sourceTurns.join('、'), revisionText: userText })` を呼ぶ。
- `revision.tasks.length > 0 && !nextState.examPrepScope` のときだけ `tasks` を merge 結果で置き換える。examPrepScope がある場合(exam prep フロー)は何もしない。

## 問題点

- この2分岐を reducer 経由で検証するテストがゼロであり、fallback の隔離・薄化(R1-3)や `looksLikeWeeklyPlanningRequest` の変更を行うと、挙動が静かに変わっても検出できない。
- 分岐Aと setup command の優先関係(同一ターンで planning range が取れた場合に fallback がスキップされる)は暗黙の挙動であり、どこにも固定されていない。

## 修正方針

**テストのみを追加する。** 新規テストファイル `weeklyPlanningLegacyFallback.test.ts` に、以下の観点で現在の挙動を固定するテストを書く。

期待値は必ず**現在の実装を実行して観察した結果**から書くこと。挙動が仕様として疑わしく見えても、このタスクでは修正せず、テストは現挙動に合わせ、疑問点は作業報告に記載する。

1. **分岐Aに入るケース**: `createInitialPlanningIntakeState()` + 「来週、英語を3時間、数学を2時間」のような入力(週キーワード + `N時間`×2、かつ planning range / exam scope にマッチしない文言)で、`intent` が `weekly_study_planning` になり、`tasks` にタイトル・amount・unit が入ること。`missing` への `life_constraints` 追加有無も現挙動どおり固定する。
2. **分岐Aに入らないケース**:
   - 週キーワードなし(「英語を3時間、数学を2時間」)→ intent は `unknown` のまま、tasks は空。
   - `N時間` が1回以下(「今週末で院試過去問の残りを進めたい」)→ 分岐Aに入らない。
3. **setup command の優先**: 同一ターンで `set_planning_range` が成立する入力(既存 roleplay fixture の rangeOnly 文言を参考に、`N時間`×2 を含む変形)では、intent が command 側で確定し分岐Aがスキップされること(tasks が assess 由来で埋まらないこと)。
4. **分岐B: revision merge**: 1回目「来週、英語を3時間、数学を2時間」→ 2回目「あと物理を2時間」で、tasks に物理が加わり既存タスクが保持されること(`mergeWeeklyPlanningRevision` の title ベース merge)。
5. **分岐B: examPrepScope ガード**: examPrepScope が確定しているフロー(既存 roleplay の range → exam scope ターンを再利用)で追加ターンを与えても、fallback が `tasks` を上書きしないこと。
6. **共通の不変条件**: 上記すべてで `shouldSavePlan` が `false` のままであること。

テストヘルパーは既存の `__tests__/weeklyPlanningRoleplayTestHelpers.ts`(`context`)と `testFixtures/weeklyPlanningRoleplayCases.ts` を再利用してよい。fixture に手を入れる必要が出た場合は追加のみとし、既存 fixture の値は変更しない。

## 触らない範囲

- **`src/` 以下のプロダクションコード全部**(reducer、transforms、parsing、scheduling、pipeline、UI)。このタスクはテスト追加のみ。テストを書く過程で挙動に疑問が出ても、コードを直さない。
- 既存テストファイルと既存 fixture の値(fixture への追加は可、変更は不可)。
- `TODO(Phase 9.8)` コメント。
- `scheduling/placementScoring.test.ts` の既知の失敗1件(今回の範囲外。触らず報告に記載する)。

## 受け入れ条件

- 新規テストファイルが上記観点1〜6をカバーし、**プロダクションコード無変更**で全ケース green であること。
- 分岐A・分岐Bの両方に、入るケースと入らないケースの双方があること。
- setup command と分岐Aの優先関係を固定するテストが含まれること。
- 既存テストがすべて green のまま(placementScoring の既知失敗1件を除く)。
- `git diff` にテストファイル(と、必要な場合の fixture 追記)以外の変更がないこと。

## テスト観点

上記「修正方針」の1〜6がそのままテスト観点である。補足:

- 期待値のスナップショット化はしない(`toMatchObject` / 明示的な expect で、何を固定しているか読めるようにする)。
- 分岐Aの unit 写像(`mapWeeklyAmountUnit`)は、`時間` 入力での `unit` 値を1ケース固定すれば十分。words/pages 等の写像網羅は不要(extractSimpleWeeklyPlanningTasks の対応範囲に依存するため、深追いしない)。
- 各テストの describe / it 名に「legacy fallback」を含め、R1-3 のときに探しやすくする。

## リスク

- 分岐Aの入力文言が意図せず `set_exam_scope` や constraint parser にマッチすると、fallback ではなく command 経由の挙動を固定してしまう。テスト作成時に、対象ターン適用後の state で「何がその値を作ったか」を確認し、fallback 経由であることを担保する入力を選ぶこと(例: 院試・分野・年度などの語を避ける)。
- `assessWeeklyPlanningRequest` の返す `kind` が入力により `ready` 以外になる条件はこのタスクで網羅しない。観察できた kind の挙動だけ固定し、それ以外は深追いしない。
- テストが現挙動の「バグの固定化」になる可能性があるが、それはこのタスクの意図どおり(現状固定が目的)。疑わしい挙動は報告に列挙し、修正判断は roadmap 側で行う。

## Codexへの実装指示

1. まず `applyWeeklyPlanningUserTurn` の fallback 2分岐(本タスクmdの「現在の処理経路」)を実コードで読み、行位置と条件を確認する。
2. 新規テストファイルを作成し、観点1(分岐Aに入るケース)から順に書く。各ケースで実行結果を観察してから期待値を確定する。
3. 観点3(setup command 優先)は、planning range が成立する入力を `weeklyPlanningRoleplayCases.ts` の既存文言を参考に作る。
4. プロダクションコードは一切変更しない。変更が必要に見えた場合は、その旨を報告に書いて止める。
5. `docs/ai/codex-task-guide.md` に従うこと: タスクmd外へ広げない、git add / commit / push をしない、作業後に対象テスト(`npm run test:run src/features/weeklyPlanning/__tests__/weeklyPlanningLegacyFallback.test.ts`)、`npm run test:run src/features/weeklyPlanning`、`npm run build`、`git diff --check`、`git diff --stat`、`git status -sb` を報告する。あわせて、テスト作成中に見つかった疑わしい挙動(仕様として不自然な点)を「発見事項」として列挙する。

## Closed note: R1-3 handoff

R1-2 の regression test 追加で、legacy fallback には次の注意点があることを確認した。

- pplyWeeklyPlanningUserTurn を reducer 直呼びする場合と、pipeline 経由で呼ぶ場合では、初回ターン相当でも previousState の truthiness がずれる可能性がある。pipeline は初期 state を保持して渡すため、reducer 内の else if (previousState && nextState.intent === 'weekly_study_planning') が初回相当でも成立し得る。
- そのため branch B(revision merge fallback)は、ユーザー体験上は初回相当に見える入力でも発火し得る。R1-3 で fallback を隔離するときは、previousState の有無だけではなく、初回/継続 turn の判定境界を明示する必要がある。
- 今回追加した exam prep regression は、branch B 内部の evision.tasks.length > 0 && !nextState.examPrepScope ガードを直接検証しているわけではない。現状では intent === 'exam_prep_planning' のため branch B の条件自体が成立せず、結果として tasks が上書きされないことを固定している。
- R1-3 で branch B の !nextState.examPrepScope ガードを直接検証したい場合は、intent: 'weekly_study_planning' かつ examPrepScope が存在する state を明示的に組み立てる regression を別途追加するのがよい。
