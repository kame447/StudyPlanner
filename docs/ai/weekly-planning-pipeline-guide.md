# weeklyPlanning パイプライン改善ガイド

> **ステータス: パイプライン境界の運用ガイド。** parser / command / adapter / reducer / scheduler の安全境界は維持する。ただし §3 と §5 の「LLM は抽出・質問文生成に限定」「質問の対象は deterministic が固定する」という通常対話方針は [親設計 v4](../architecture/weekly-planning-dialogue-architecture-v4.md) に superseded された。AI dialogue planner は検証済み snapshot と allowed actions の範囲で対話を主導する。

このドキュメントは、`docs/weekly-planning/weekly-planning-spec.md`(以下 spec)が示す週間学習計画機能の最終方針へ、現在の実装を段階的に近づけるための開発ガイドである。単なる AI 運用ルールではなく、StudyPlanner の週間学習計画機能をどの順番で、どの責務境界を守りながら育てるかを定める。

## 1. 目的と文書の位置づけ

| 文書 | 役割 |
| --- | --- |
| `docs/weekly-planning/weekly-planning-spec.md` | 上位方針。機能の最終的な方向性(メンター対話型、6等分再配分、生活プロファイル、進捗記録、再計画、仮予定承認)を示す。一気に実装対象にしない。 |
| `docs/architecture/planning-pipelines-overview.md` | 現状マップ。通常予定ルートと週間計画ルート、二系統の scheduler、型と関数の対応表。 |
| `docs/architecture/weekly-planning-responsibility-separation.md` | 責務分離の設計メモ。command boundary の段階導入案(Phase 9.4b / 9.5)を含む。 |
| このガイド | spec と現実装の間を埋める改善方針。責務境界の規範、改善テーマ、タスク分割方針。 |
| `docs/ai/tasks/*.md` | 実行単位。Codex が1回の中規模作業で潰せる実装ブリーフ。 |

運用の分担:

- Claude/Fable: spec と現実装の差分調査、問題整理、タスク分解、タスクmd作成。原則実装しない。
- Codex: タスクmdに書かれた範囲だけを実装する(`docs/ai/codex-task-guide.md` 参照)。

## 2. 現在のパイプラインの形

新 intake パイプライン(会話型週間計画)の流れ:

```text
userText
-> applyWeeklyPlanningUserTurn (intake/weeklyPlanningIntakeReducer.ts)
-> PlanningIntakeState
-> createWeeklyDraftRequestFromIntakeState (intake/weeklyPlanningDraftRequestAdapter.ts)
-> createRemainingWorkItemsFromDraftRequest (intake/weeklyPlanningRemainingWorkItems.ts)
-> createWeeklyDraftCandidatesFromRemainingWorkItems (scheduling/weeklyDraftCandidateGenerator.ts)
-> createWeeklyPlanningPreviewBlocks (preview/weeklyPlanningPreviewBlocks.ts)
-> preview -> draft promotion -> 一括承認 -> savePlanDraft
```

全体は `pipeline/weeklyPlanningIntakePipeline.ts` が束ね、UI 入口は `src/components/NaturalLanguageAssistant.tsx`。

このほかに旧 availability-aware path(`weeklyPlanningTransforms.ts`, `scheduling/availabilitySlots.ts`, `scheduling/placementScoring.ts`)が併存する。二系統の統合は長期課題であり、個別タスクで明示されない限り触らない。

command 境界は導入が進んでいる:

- `intake/weeklyPlanningCommandTypes.ts` に `ParsedWeeklyPlanningCommand` として 8 command が定義済み: `add_unavailable`, `add_fixed_event`, `update_life_constraint`, `set_priority_policy`, `mark_completed_units`, `set_unit_rate`, `set_exam_scope`, `set_planning_range`。
- Phase 9.7 までで、constraints 系・priority・progress・unit rate に加え `set_exam_scope` / `set_planning_range` も command path へ移行済み。reducer はこれらを `case 'set_exam_scope'` / `case 'set_planning_range'` として apply する。
- `intake/weeklyPlanningCommandAdapter.ts` が command payload を domain 型(`LifeConstraint`, `StudyProgress`, `UnitRateEstimate` など)へ変換する。

## 3. 責務境界(規範)

この境界は weeklyPlanning の予定作成パイプラインに関わるすべてのタスクで守る。タスクmdを書くときも、この境界に違反する修正方針を書かない。

### parser(`src/features/weeklyPlanning/intake/weekly*Parsing.ts`)

- 自然言語入力を読む唯一の層。日本語の表現ゆれ、正規表現、日付・時間帯・量・単位の抽出はここに閉じる。
- 出力は command(`ParsedWeeklyPlanningCommand`)へ寄せていく。当面 domain 型を直接返す helper が残るのは許容するが、新規追加分は command 生成を優先する。
- `PlanningIntakeState` を参照・更新しない。

### command types(`intake/weeklyPlanningCommandTypes.ts`)

- 構造化された意図を表す。stateless で、現在の state を持たない。
- `sourceText` / `sourceSegment` / `confidence` を持たせ、regression test と将来の LLM 評価に使えるようにする。

### adapter(`intake/weeklyPlanningCommandAdapter.ts`)

- command payload を domain 型、または reducer 適用用の値へ変換する。
- 日本語文言、正規表現、入力文そのものを見ない。`sourceText` は透過的に引き回すだけで、内容を解釈しない。

### reducer(`intake/weeklyPlanningIntakeReducer.ts`)

- command を state に適用する。merge ルール、missing / ambiguity の更新、finalize が責務。
- 自然言語解釈を増やさない。現在 reducer 内に残っている parser 的処理(後述)は縮小方向で扱い、新しい表現対応を reducer に直接足さない。

### scheduler(`src/features/weeklyPlanning/scheduling/`)

- 正規化済みの条件(remaining work items、constraints、busy intervals)をもとに配置する。
- 自然言語 parsing を入れない。会話 state、missing / clarification の文章、保存・承認の副作用も持たない。
- 候補生成後に post-filter で隠すのではなく、slot 探索前に避ける。

## 4. spec と現実装の主なギャップ

タスク化の起点になる差分。詳細な調査は Skill(`weekly-planning-pipeline-scout`)の手順で行う。

1. **自然言語入力の対応範囲が狭い。** parser が拾える表現(unavailable、fixed event、priority、進捗、unit rate)は spec §5 の想定入力(範囲、締切、完了条件、分割単位、順序制約)より狭い。進捗単位も過去問年度に寄っており、ページ・語数・問題番号・レポート工程(責務分離文書 §9 の一般化案)は未対応。
2. **reducer に parser 的責務が一部残る。** exam scope / planning range を含む主要経路は command 化済みだが、`weeklyPlanningIntakeReducer.ts` にはまだ `parseProgressHint` の直接呼び出し、uncertainty 判定の正規表現(`知らない分野.*時間かかる` 等)、旧 `assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision` fallback が残っており、これらの経路では reducer が日本語を見ている。残存例はここに列挙したものに限らず、タスク化の際は必ず実コードで現状を確認する。
3. **メンター対話・質問制御が spec 水準に達していない。** spec §5–6 の「1ターン1〜3問」「質問するべき度」「選択肢提示」「分からないを有効回答にする」は、dialogue 層(`dialogue/weeklyPlanningDialogueManager.ts`)で部分的にしか表現されていない。
4. **生活プロファイルの保持がない。** spec §4 のメモリ(睡眠・食事・予定種別バッファ・確認履歴)は未実装。constraints は毎回の会話で入力する前提になっている。
5. **進捗記録・再計画・見積もり補正が未着手。** spec §7–8, §11 に対応する実装はほぼない(`planning-pipelines-overview.md` §10 の未実装リスト参照)。
6. **テストが仕様全体を覆っていない。** roleplay / edge case / pipeline テストは存在するが、spec の章を系統立ててカバーする構成にはなっておらず、reducer fallback 経由の挙動や境界違反(adapter が入力文を見ない等)を守るテストが薄い。

## 5. 改善テーマ一覧(spec 章との対応)

spec を一気に実装せず、以下のテーマへ分解して扱う。各テーマはさらに複数のタスクmdに割る。

| テーマ | spec 対応 | 主な関係ファイル | 現状メモ |
| --- | --- | --- | --- |
| 自然言語入力の対応範囲拡大 | §5, §2 | `intake/weekly*Parsing.ts`, `weeklyPlanningCommandTypes.ts` | 当面の最重点。表現1群ごとに parser + command + テストで1タスク。 |
| メンター対話型ヒアリング | §5, §13 | `dialogue/`, `intake/weeklyPlanningMissingStatus.ts` | 質問生成と missing 管理の整理。 |
| 質問しすぎ防止 | §6 | `dialogue/weeklyPlanningDialogueManager.ts` | 「質問するべき度」の判定を決定的コードで持つ。 |
| 生活プロファイルの扱い | §4 | `profiling/`, `intake/` | メモリ保持と「前回と同じ前提でよいか」のまとめ承認。保存設計が絡むため小さく切る。 |
| タスク分割と所要時間推定 | §5, §7(前半) | `profiling/studyTaskProfile.ts`, `scheduling/sessionChunking.ts`, `intake/weeklyPlanningUnitRateParsing.ts` | 進捗単位の一般化(責務分離文書 §9)と連動。 |
| 進捗記録 | §8 | 未実装領域 | UI が絡むため、domain 型とデータ経路の設計タスクから始める。 |
| 再計画 | §11 | 未実装領域 | 再計画条件の判定は決定的コードで持つ。トリガー判定と再配置を分けてタスク化。 |
| 仮予定表示と承認 | §10 | `preview/`, `weeklyPlanningReducer.ts` | 基本フローは実装済み。差分改善のみ。UI/CSS はタスクmdで明示されない限り触らない。 |
| LLM使用量を抑える責務分離 | §12 | パイプライン全体 | LLM は parser 相当(意図抽出・質問文生成・説明文)に限定し、配置・計算・判定は通常コード。command boundary がその接続点になる。 |
| テスト戦略 | 全章 | `__tests__/`, `testFixtures/`, 各 `*.test.ts` | spec 章とテストの対応表を作り、欠落章を埋める。fallback 経路の regression を先に固める。 |

## 6. タスク分割方針

- **1タスクmd = Codex が1回の中規模作業で潰せる単位。** 目安として、対象ファイル数個、新規/変更テスト1〜3ファイル。1つのタスクmdに複数の大きな変更を混ぜない。
- **挙動変更とリファクタを分ける。** 「reducer 内の parser を command 化する(挙動変更なし・既存テスト green 維持)」と「新しい表現に対応する(挙動追加・新テスト)」は別タスクにする。
- **command 化の現在地を踏まえて切る。** constraints 系・priority・exam scope・planning range・progress・unit rate は Phase 9.7 までに command path へ移行済み。次の重点は、`parseProgressHint` の直接呼び出し、legacy fallback(`assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision`)、reducer 内に残る直接 parse(uncertainty 正規表現など)の棚卸しと整理である。
- **当面の重点は予定作成パイプライン。** 順番の目安: (1) parser の対応表現拡大、(2) reducer 内の残存 parse・progressHint 経路の command 化、(3) legacy fallback 経路の整理、(4) reducer の command apply への薄化、(5) 各段階でのテスト補強。
- **タスクmdは `docs/ai/task-brief-template.md` に従って書く。** 触らない範囲と受け入れ条件を必ず明記する。

## 7. やらないこと(個別タスクで明示されない限り)

責務分離文書 §12 の方針を引き継ぐ。

- scheduler 本体(slot search / scoring)の大改造、二系統 scheduler の統合。
- UI / CSS の変更。`WeekView` / `DayView` / `DayTimeline` / `NaturalLanguageAssistant` の構造変更。
- 保存導線・承認導線の変更。`shouldSavePlan: false` の維持を崩す変更。
- `PlanningIntakeState` の全面置換、`yearRange` を消す大規模 migration。
- `looksLikeWeeklyPlanningRequest` による通常予定/週間計画ルート分岐の挙動変更(regression set 整備が先)。
- LLM / ML を planning state の直接更新役にすること。
