---
name: weekly-planning-pipeline-scout
description: StudyPlanner の weeklyPlanning パイプラインについて、weekly-planning-spec.md と現実装の差分を調査し、Codex 向け実装タスクmd(docs/ai/tasks/*.md)を作成する。実装はしない。「weeklyPlanning を調査して」「タスクに分解して」「Codex 用のタスクmdを作って」などの依頼で使う。
---

# weekly-planning-pipeline-scout

weeklyPlanning の予定作成パイプラインを調査し、仕様(spec)との差分をタスク単位に分解して、Codex 向け実装ブリーフを作る Skill。

## 役割の前提

- この Skill の成果物は **調査結果とタスクmd** であって、コード変更ではない。
- 実装しない。UI / CSS / save / approval / scheduler 本体を含め、`src/` 以下のファイルは変更しない。
- git add / commit / push はしない。
- 実装は Codex が `docs/ai/codex-task-guide.md` に従って行う。

## 1. 前提資料を読む(この順で)

1. `docs/weekly-planning/weekly-planning-spec.md` — 上位方針。今回の調査対象テーマに対応する章(§)を特定する。
2. `docs/architecture/planning-pipelines-overview.md` — 現状のパイプラインマップと型・関数対応表。
3. `docs/architecture/weekly-planning-responsibility-separation.md` — 責務分離の設計と command boundary の段階導入案。
4. `docs/ai/weekly-planning-pipeline-guide.md` — 改善方針、責務境界の規範(§3)、改善テーマ一覧(§5)、タスク分割方針(§6)。

依頼が特定テーマ(例: unavailable 表現の拡大)に限定されている場合は、spec は該当章だけ精読すればよい。

## 2. 現実装を調査する

主な調査対象:

- `src/features/weeklyPlanning/intake/` — parser 群(`weekly*Parsing.ts`)、command 型(`weeklyPlanningCommandTypes.ts`)、adapter(`weeklyPlanningCommandAdapter.ts`)、reducer(`weeklyPlanningIntakeReducer.ts`)、missing 管理、draft request adapter
- `src/features/weeklyPlanning/scheduling/` — 新 dry-run generator(`weeklyDraftCandidateGenerator.ts`)と旧 path(`availabilitySlots.ts`, `placementScoring.ts`, `sessionChunking.ts`)
- `src/features/weeklyPlanning/profiling/` — task profile / session policy
- `src/features/weeklyPlanning/weeklyPlanningTransforms.ts` — 旧 availability-aware path と承認変換
- `src/features/weeklyPlanning/__tests__/` と各 `*.test.ts`、`testFixtures/` — 既存テストのカバレッジ
- 必要な場合だけ `dialogue/`, `preview/`, `pipeline/`、さらに必要な場合だけ UI(`src/components/NaturalLanguageAssistant.tsx` など)。UI / CSS は原則調査対象外。

調査の中心は予定作成パイプライン、特に:

1. **自然言語入力の対応範囲** — 対象テーマの表現(spec が想定する言い方)を parser に入れたら何が起きるか。どの表現が拾えず、どこで落ちるか。
2. **command 化されていない経路** — exam scope / planning range を含む主要経路は Phase 9.7 までに command 化済み(`set_exam_scope` / `set_planning_range` を含む 8 command)。残っているのは `parseProgressHint` の直接呼び出し、uncertainty 判定の正規表現、旧 `assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` fallback などであり、どの入力がそれらの経路を通るかを実コードで確認する。この一覧自体も古くなり得るため、調査時点の reducer を必ず読む。
3. **責務境界違反** — adapter / reducer / scheduler が日本語文言・正規表現・入力文を見ていないか(規範は pipeline-guide §3)。
4. **テストの妥当性** — 対象テーマの spec 章をカバーするテストがあるか。fallback 経由の挙動、曖昧入力が hard 確定しないこと、regression が守られているか。

処理経路は必ず関数名レベルで追う: `parser → ParsedWeeklyPlanningCommand → adapter → reducer(state merge)→ draft request → remaining work items → scheduler → preview`。どの段で対象データが生まれ、どの段で失われるかを特定する。

## 3. タスクへ分解する

pipeline-guide §6 の分割方針に従う:

- 1タスクmd = Codex が1回の中規模作業で潰せる単位(目安: 対象ファイル数個、テスト1〜3ファイル)。
- 複数の大きな変更を1タスクに混ぜない。「parser に表現を足す」「reducer 内 parse を command 化する」「テストを補強する」は原則別タスク。
- 挙動変更なしのリファクタと、挙動追加を分ける。
- 依存関係があるタスクは順序を明示する(例: command 型追加 → parser 移行 → reducer 薄化)。
- タスクにできない大きな設計判断(型の全面変更、scheduler 統合など)はタスクmdにせず、ユーザーへの報告で「要設計判断」として挙げる。

## 4. タスクmdを書く

- `docs/ai/task-brief-template.md` のテンプレートに従い、`docs/ai/tasks/YYYYMMDD-<slug>.md` として作成する。
- 全セクション必須。特に以下を具体的に書く:
  - **現在の処理経路**: 調査で確認した関数名つきの経路。推測で書かない。
  - **触らない範囲**: UI / CSS / save / approval / scheduler 本体、`shouldSavePlan: false` 維持を、対象にしない限り必ず含める。
  - **受け入れ条件**: 入力例 → 期待される command / state / 候補、の形で検証可能に書く。
  - **テスト観点**: 追加先テストファイルを実在するパスで指定する。
- Codex はタスクmdに書かれた範囲しか実装しない前提で、範囲の輪郭を曖昧にしない。

## 5. 報告する

ユーザーへの最終報告に含める:

1. 調査した範囲と確認できた事実(spec との差分)
2. 作成したタスクmdの一覧と、各タスクの狙い・依存順序
3. タスク化しなかった事項(要設計判断、スコープ外の発見)
4. `git status -sb`(作成したのがタスクmdだけであることの確認)
