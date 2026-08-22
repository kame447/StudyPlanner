# [Goal] R1 残作業: legacy fallback の regression 棚卸しと安全な薄化・意味論整理の設計

このmdは4フェーズ構成の goal 用タスクmdである。**goal mode で実行する場合でも、本mdに書かれた範囲を超えないこと。** md内で「将来候補」「別作業」「設計判断が必要」とした項目は、Phase 4 で設計調査対象として明示された範囲を除き、調査であっても勝手に進めない。対象外の問題を見つけた場合は、修正・調査をせず「発見事項」として報告するだけにする。

**このgoalの目的は、いきなり挙動を変えることではない。** まず regression の不足を洗い出し(Phase 1)、必要な現状固定テストを追加し(Phase 2)、そのうえで挙動変更ゼロで安全に薄化できる箇所だけを実装し(Phase 3)、挙動変更が必要な意味論整理は設計案の提示で停止する(Phase 4)。

## 背景

R1(command boundary の完成と reducer 薄化)のうち、command 化と reducer 本体の整理は完了した。reducer(`intake/weeklyPlanningIntakeReducer.ts`)に残る非 command 経路は、隔離済みの legacy fallback 呼び出し1箇所だけである。

一方、fallback そのもの(`intake/weeklyPlanningLegacyFallback.ts` の branch A / branch B)には、意味論上の未解決事項が残っている: 初回/継続ターンの判定が `previousState` の truthiness に依存し、pipeline 経由と reducer 直呼びで初回ターンの挙動が分かれる。branch B が発火すると tasks が埋まるのに `tasks_or_goals` missing が残る不整合も観察済みである。これらは挙動変更を伴うため、regression を先に厚くしてから扱う。

## 現在完了済みの作業(前提)

- command 化済み: `set_exam_scope` / `set_planning_range` / constraints 系 / priority / progress / unit rate / `note_progress_boundary` / `note_uncertainty` / `note_no_fixed_events`(payload 整理済み)。
- fallback は `intake/weeklyPlanningLegacyFallback.ts` へ隔離済み(`applyLegacyWeeklyPlanningFallback`)。regression は reducer 直呼び7件(`__tests__/weeklyPlanningLegacyFallback.test.ts`)+ pipeline 経由3件(`pipeline/weeklyPlanningIntakePipeline.test.ts` の「legacy fallback via pipeline」describe)。
- priority missing ブロックは `weeklyPlanningMissingStatus.ts` の `applyPriorityMissingState`(`finalizeState` 冒頭)へ移設済み。発火1+非発火2の固定テストあり。
- 既知の失敗: `scheduling/placementScoring.test.ts` 1件(本goalの範囲外)。

## 残っている問題

1. **初回/継続ターンの意味論が暗黙**: branch B の条件 `previousState && intent === 'weekly_study_planning'` は「会話が2ターン目以降か」ではなく「呼び出し元が truthy な previousState を渡したか」で決まる。pipeline は `previousState ?? createInitialPlanningIntakeState()` を渡すため、初回ターンでも truthy になる。
2. **pipeline / reducer 直呼びの差分**: 同一入力(planning range + 複数 duration)で、reducer 直呼び(undefined)は tasks 空、pipeline 経由は branch B 発火で tasks が埋まる。両方とも regression で固定済みだが、どちらが正かは未決定。
3. **branch B と missing の不整合**: branch B が tasks を埋めても `missing` の `tasks_or_goals` は残り、status が `needs_scope` になる(pipeline テスト3で観察・固定済み)。tasks の実体と missing 判定がずれている。
4. **regression の穴(候補)**: branch B のガード方向の対照(examPrepScope なしの weekly intent 状態で revision が tasks を置換するケース)、`assessWeeklyPlanningRequest` の `kind` 別の missing 挙動、pipeline 経由の2ターン目(state 引き継ぎあり)での fallback 挙動、`previousText = sourceTurns.join('、')` に依存する merge 挙動など。正確な穴の一覧は Phase 1 で確定する。
5. **fallback module 内の可読性**: branch A / branch B が1関数に直列で入っており、分岐条件が named 述語になっていない。意味論整理(Phase 4 以降)の前に、挙動を変えない範囲で構造を読みやすくできる余地がある。

## 対象ファイル

- Phase 1(調査のみ・変更なし):
  - `src/features/weeklyPlanning/intake/weeklyPlanningLegacyFallback.ts`
  - `src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts`
  - `src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts`
  - `src/features/weeklyPlanning/weeklyPlanningTransforms.ts`(`assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` / `looksLikeWeeklyPlanningRequest` を読むだけ。**変更禁止**)
  - 既存テスト: `__tests__/weeklyPlanningLegacyFallback.test.ts`、`pipeline/weeklyPlanningIntakePipeline.test.ts`、`__tests__/weeklyPlanningIntakeEdgeCases.test.ts`
- Phase 2(テストのみ変更):
  - `__tests__/weeklyPlanningLegacyFallback.test.ts`(reducer 直呼び系の追加)
  - `pipeline/weeklyPlanningIntakePipeline.test.ts`(pipeline 経由系の追加)
  - 必要な場合のみ `testFixtures/weeklyPlanningRoleplayCases.ts`(追加のみ。既存値の変更禁止)
- Phase 3(production 変更は次の1ファイルに限定):
  - `src/features/weeklyPlanning/intake/weeklyPlanningLegacyFallback.ts`(構造整理のみ。呼び出し側 `weeklyPlanningIntakeReducer.ts` は import 行の追随が必要な場合のみ)
- Phase 4(変更なし・設計文書のみ)

ここに挙げたファイル以外の production code は変更しない。

## フェーズ構成

### Phase 1: fallback regression の棚卸し(調査のみ)

1. branch A / branch B の分岐条件を軸に、入力パターンのマトリクスを作る。軸の例: intent(unknown / weekly / exam_prep)× `looksLikeWeeklyPlanningRequest` 真偽 × previousState(undefined / truthy 初期 / truthy 継続)× examPrepScope 有無 × 呼び出し経路(reducer 直呼び / pipeline)。
2. 既存 regression(fallback 7件 + pipeline 3件 + edge cases / roleplay の関連ケース)を各セルへマップし、**固定されていないセル**を列挙する。
3. 各未固定セルについて「固定する価値(Phase 4 の意味論変更で挙動が変わり得るか)」を判断し、Phase 2 で追加するテストの一覧を確定して報告する。

### Phase 2: 現状固定テストの追加(テストのみ)

Phase 1 で確定した一覧に従ってテストを追加する。**production code は変更しない。期待値は必ず現在の実装を実行して観察した結果から書く。** 少なくとも次の候補を検討対象に含める(Phase 1 の結果、既にカバー済みと判明したものは省いてよい):

- branch B のガード対照: `intent: 'weekly_study_planning'` かつ examPrepScope **なし**の state に revision ターンを与えると tasks が置換されること(ガードが「効かない」方向の固定。既存の examPrepScope ありテストと対になる)。
- branch B 発火時の不整合の明示固定: tasks が埋まった状態で `missing` に `tasks_or_goals` が残ること(pipeline テスト3の内包アサートを、意味論変更時に必ず気づける形で独立させる)。
- pipeline 経由の2ターン目: 1ターン目の state を `previousState` に渡した revision で、merge 結果と `sourceTurns` の積み上げが現挙動どおりであること。
- `assessWeeklyPlanningRequest` の `kind` 別挙動: `kind !== 'ready'` になる入力が観察で見つかる場合、その missing 挙動を固定する(見つからなければ深追いせず報告)。

### Phase 3: 挙動変更ゼロの薄化(Phase 2 完了が前提)

`weeklyPlanningLegacyFallback.ts` の**内部構造のみ**を整理する。分岐条件・入出力・呼び出し位置・意味論を一切変えない。

- branch A / branch B をそれぞれ named 関数(例: `applyFirstAssessFallback` / `applyRevisionMergeFallback`)へ分割し、分岐条件を named 述語にする。
- `previousState` truthiness が分岐条件であることのコメントを、分割後も対応する場所に残す。
- 全テスト(Phase 2 追加分を含む)が期待値変更なしで green のままであることを確認する。1件でも赤くなったら、テストではなく整理内容を疑う。

### Phase 4: 意味論整理の設計(設計のみ・実装禁止)

以下について設計案を作り、**実装せずに報告して停止する**。この Phase で production code・テストを変更しない。

1. 初回/継続ターンの定義の選択肢比較(少なくとも: pipeline が `previousState` の undefined を透過する案 / reducer が `sourceTurns` 長等で判定する案 / 明示的な `isFirstTurn` 引数を追加する案)。各案について、挙動が変わる regression セル(Phase 1 のマトリクス参照)と必要な期待値変更を列挙する。
2. branch B 発火時の `tasks_or_goals` missing 不整合の解消案(tasks が埋まったら missing を解消する / fallback では missing を触らない、等)と影響範囲。
3. 移行手順の提案(どの順でテストを書き換え、どの順で実装するか)。
4. 推奨案とその理由。

## 各フェーズの受け入れ条件

### Phase 1

- 分岐マトリクスと、既存 regression のマップ、未固定セルの一覧、Phase 2 で追加するテスト一覧が報告されている。
- production code・テストに変更がない(`git diff` が空のまま)。

### Phase 2

- Phase 1 の一覧に対応するテストが追加され、**production code 無変更**で全ケース green。
- 既存テストの入力・期待値が変更されていない。
- 観察で確認できなかった項目(例: `kind !== 'ready'` の入力が見つからない)は、その旨が報告されている。

### Phase 3

- fallback module が named 関数・named 述語に分割され、既存+Phase 2 追加テストがすべて期待値変更なしで green。
- 分岐条件・入出力・呼び出し位置が変わっていないことの根拠(diff の説明)が報告されている。

### Phase 4

- 上記4項目を含む設計文書が報告(または本mdへの追記)として提出され、実装に進んでいない。
- 設計完了の時点で停止し、ユーザー判断を待っている。

## 触らない範囲

- UI / CSS、`scheduling/`(placement scoring・availability・draft 生成アルゴリズム)、`preview/`、`dialogue/`、保存・承認導線、通常予定導線、`shouldSavePlan: false` の維持。
- `weeklyPlanningTransforms.ts` の実装(`assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` / `looksLikeWeeklyPlanningRequest` の仕様変更・リファクタ)— 読むのは可、変更は不可。
- **fallback の挙動変更・縮小・削除の実装**(Phase 4 は設計のみ)。`looksLikeWeeklyPlanningRequest` の条件変更、「あと物理」タイトル正規化(R2)。
- `pipeline/weeklyPlanningIntakePipeline.ts` の `previousState ?? createInitialPlanningIntakeState()` の変更(Phase 4 の設計対象だが、実装しない)。
- `scheduling/placementScoring.test.ts` の既知失敗1件。
- 既存 regression テストの入力・期待値(fallback 10件、priority missing 3件、note_no_fixed_events 系ほか)。

## 停止条件

以下のいずれかに該当したら作業を止め、状況を報告してユーザー判断を仰ぐ。

- Phase 2 のテストが既存 helper / fixture では組み立てられない等の理由で書けないとき。
- Phase 3 の整理が、分岐条件・入出力を変えずには実現できないと判明したとき。
- 変更が「対象ファイル」に挙げた範囲の外へ波及したとき。
- 「触らない範囲」の項目に関わる変更・調査(Phase 4 で明示された設計調査を除く)が必要に見えたとき。
- Phase 4 の設計文書が完成したとき(実装に進まない)。
- placementScoring の既知1件以外の新規テスト失敗が出たとき(修正せず報告)。

## テスト観点

- Phase 2 の追加テストは、describe / it 名に「legacy fallback」を含め、reducer 直呼び系は `weeklyPlanningLegacyFallback.test.ts`、pipeline 経由系は `weeklyPlanningIntakePipeline.test.ts` に置く。スナップショットは使わない。日本語文字列は `\uXXXX` エスケープではなく生の日本語で書く。
- 各フェーズ完了時に、対象テスト、`npm run test:run src/features/weeklyPlanning`、`npm run build`、`git diff --check`、`git diff --stat`、`git status -sb` を報告する。
- test / build の実行は Node 22 系で行う(直近の実績: `env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:$PATH ...` を各コマンドに前置。環境が変わっていたら `node -v` で確認してから進める)。

## Codexへの実装指示

- Phase 1 → 2 → 3 → 4 の順に進め、**Phase をまたいで変更を混ぜない**(各 Phase の報告・コミット単位を分けられる状態を保つ)。
- Phase 2 より先に production code を触らない。Phase 3 より先に fallback module を触らない。Phase 4 では何も実装しない。
- 期待値は観察してから書く。不自然な挙動を見つけても修正せず、発見事項として報告する(Phase 4 の設計材料になる)。
- 本mdの範囲外へ広げない。「触らない範囲」「将来候補」に関わる気づきは発見事項として報告するだけにする。
- git add / commit / push はしない。コミットはユーザー指示後に行う。
- `docs/ai/codex-task-guide.md` に従う。
