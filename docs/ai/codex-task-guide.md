# Codex 実装ルール: タスクmdの読み方と作業範囲

このドキュメントは、Codex が `docs/ai/tasks/*.md`(実装タスクブリーフ)を読んで実装するときのルールである。タスクmdは Claude/Fable が調査・分解して作成する。Codex はそこに書かれた範囲だけを実装する。

## 1. 基本原則

- **タスクmdが作業範囲のすべてである。** タスクmdに書かれていない範囲へ勝手に広げない。実装中に別の問題やリファクタ余地を見つけても、修正せず作業報告に「発見事項」として書くだけにする。
- **「触らない範囲」は絶対条件である。** タスクmdの「触らない範囲」に挙がったファイル・挙動は、テストを通すためであっても変更しない。変更しないと受け入れ条件を満たせない場合は、実装を止めて報告する。
- **不明点は勝手に決めない。** タスクmdの記述が曖昧、または現実装と食い違っている場合は、妥当な最小解釈で進めてよいが、解釈した内容を必ず報告に明記する。大きな判断が必要な場合は実装せず報告で止める。

## 2. デフォルトで触らない領域

以下は、タスクmdで対象ファイル・修正方針として明示されていない限り触らない。

- UI コンポーネント(`src/components/` 以下、特に `NaturalLanguageAssistant.tsx`, `WeekView.tsx`, `DayView.tsx`, `DayTimeline`)
- CSS / スタイル
- 保存導線(`savePlanDraft`, `usePlannerDataState`, repository 層)
- 承認導線(draft promotion、一括承認、`weeklyPlanningReducer.ts` の draft block 操作)
- scheduler 本体の大改造(`scheduling/availabilitySlots.ts`, `placementScoring.ts`, `weeklyDraftCandidateGenerator.ts` の slot search / scoring 構造。タスクmdが指定する小さな追加は可)
- `weeklyPlanningTransforms.ts` の旧 availability-aware path
- `PlanningIntakeState` の型の破壊的変更
- 依存パッケージの追加・更新

また、守るべき責務境界(詳細は `docs/ai/weekly-planning-pipeline-guide.md` §3):

- 自然言語(日本語文言・正規表現)を読むのは parser 層だけ。adapter / reducer / scheduler に自然言語解釈を足さない。
- `shouldSavePlan: false` を維持する。自動保存導線を作らない。

## 3. git ルール

- **git add / commit / push はしない。** 変更は working tree に残したままにする。
- branch の作成・切り替え、stash、reset もしない。

## 4. テストとビルド

実装後、以下を順に実行し、結果をすべて報告する。

```bash
# 1. タスクmdの「テスト観点」に対応する対象テスト
npm run test:run <対象テストファイルのパス>

# 2. weeklyPlanning 全体のテスト
npm run test:run src/features/weeklyPlanning

# 3. ビルド(tsc --noEmit を含む)
npm run build

# 4. diff の確認
git diff --check
git diff --stat
git status -sb
```

- 既存テストが red になった場合、それがタスクmdで意図された挙動変更でない限り、実装を修正して green に戻す。意図された変更であれば、期待値更新の理由を報告に書く。
- テストを削除・skip して green にしない。

## 5. 作業報告に含めること

1. 実装した内容の要約(タスクmdのどの修正方針に対応するか)
2. 変更ファイル一覧
3. 受け入れ条件のチェック結果(タスクmdの各条件に対して満たした/満たせなかった)
4. 対象テストの実行結果
5. `npm run test:run src/features/weeklyPlanning` の結果
6. `npm run build` の結果
7. `git diff --check` / `git diff --stat` / `git status -sb` の出力
8. 解釈で埋めた不明点、スコープ外で発見した問題(あれば)
