Status: **historical backlog / not current queue**
Current DoR: ../../architecture/weekly-planning-dialogue-architecture-v4.md

D1〜D7 below retain concrete evidence, priority, start conditions, and reasons for deferral. They must not be opened as current implementation tasks without a new v4-approved task.

# weeklyPlanning deferred backlog(タスクmd化を保留した既知問題)

> **Historical wording / current handling.** 本文中のP4、P5、P6、P7、P9、D1〜D7は旧段階名でありcurrent queueではない。当時のD1〜D3系列は現在のDA0a〜DA3cへ再編された。current queueはv4とroadmap冒頭を参照し、ここから直接taskをopenしない。

2026-07-10 の週間計画機能 全体レビュー(実コード・実行検証ベース)で確認したが、**現時点では実装タスクmdに切らない**と判断した項目の記録。再調査せずに参照できるよう、問題の所在と根拠を残す。

- 運用: ここの項目を着手する際は、必ずその時点の実コードを再調査してから `docs/ai/tasks/*.md` に切り出す(roadmap §5 の手順)。本文書は方向性の記録であり、Codex に直接渡さない。
- 関連文書: `docs/ai/strategy/weekly-planning-roadmap.md`(Phase 定義)、`docs/ai/strategy/weekly-planning-review-20260710-index.md`(本レビューの全体索引)
- 最終更新: 2026-07-10

---

## D1. legacy fallback が constraint 回答を偽タスク化する

- **概要**: `intake/weeklyPlanningLegacyFallback.ts` の revision merge(branch B)は、非 exam の weekly intent で毎ターン `sourceTurns` 全体を legacy parser(`mergeWeeklyPlanningRevision`)で再解釈し `state.tasks` を丸ごと置換する。実行確認: 「来週、英語を3時間、数学を2時間」→「睡眠は23時から6時、食事は各30分です」で `tasks` に偽タスク「食事は各です」が生成される。constraint 系の semantic state と task 抽出が同じ発話を二重解釈している。
- **優先度**: Medium(非 exam フローは draftRequest が常に null のため配置への実害はなく、対話品質の問題に留まる)
- **今触らない理由**: Phase 9.8 TODO として単一境界関数に隔離済みで、R1 の regression set(`weeklyPlanningLegacyFallback.test.ts`)が現挙動を意図的に固定している。いま挙動を変えると R1 で守った通常予定/週間計画ルートの回帰リスクの方が大きい。
- **着手条件**: R3(進捗単位の一般化)で非 exam フローに draft 生成を許す設計を始めるとき。その時点で「fallback は tasks_or_goals 未充足のときだけ走る」等の縮小を**先に**タスク化する(fallback が constraints 確立後の state を汚染したまま draft 化すると事故になるため)。
- **2026-07-10 更新(対話設計調査)**: 縮小の第一段(command 由来 tasks の保護 guard + `tasksSource` marker)は対話 Stage 3(`docs/ai/tasks/superseded/20260710-weekly-planning-dialogue-stage3-goal-acceptance.md`（historical path）)が先行消化する。fallback の全面縮小・撤去は引き続き本項の範囲。
- **関連 Phase**: R3 / roadmap §8「二重化リスク」/ 対話親設計(`docs/architecture/weekly-planning-dialogue-architecture.md`)§3(parser 分類: legacy fallback は rules モード暫定維持)

## D2. 非 exam フローが draft を作れず dead end になる

- **概要**: `createWeeklyDraftRequestFromIntakeState` は yearRange + field_first priority + year_field_chunk unitRate が揃わないと null を返す(exam prep 専用)。実行確認: 「来週、英語を3時間、数学を2時間」フローは、rules モードでは constraint 表現が拾えず `life_constraints` を無限再質問、AI モードでも最終的に `cannot_create_draft`(「条件の整合性が取れず…」)に落ちる。
- **優先度**: Medium(機能ギャップとしては大きいが、roadmap に文書化済みの既知スコープ)
- **今触らない理由**: exam prep 専用であることは roadmap §1・§2 に明記された意図的な現在地であり、単発の修正ではなく R3 の型設計(`unitKind` / `TaskProgressScope`)を要する。
- **着手条件**: R3 のタスク分解(roadmap §3 Phase R3 の 1→2→3 の順)。あわせて「情報不足と条件矛盾の分類分離」(R2初期-2 の残余: 構造的に draft 化できないフローを「整合性が取れず」と言わない)を R3-3(ready 条件の段階的緩和)に含める。
- **2026-07-10 更新(対話設計調査)**: 本項のうち**会話レベルの受理**(目標を state.tasks へ受理し対話を前進させる)は対話 P4(旧 Stage 3)が、**「未対応」の正直な応答**(`explain_capability_gap`)は対話 P3(旧 Stage 2)が先行消化する。
- **2026-07-11 更新(draft-first 再構成)**: 親設計の **P5(非 exam preview bridge)** が「tasks → 暫定量つき work items → 既存 generator」の最小経路を先行消化する予定(I1・I2・P3・P4 完了後に task md を切る)。**unitKind の本一般化・ready 条件の体系的緩和は引き続き本項 = R3 の範囲**で変更なし。
- **関連 Phase**: R3 / R2初期-2 / 対話親設計 v3 §7(P5)

## D3. 外側 PlanningState の message 系が dead code(メッセージ状態の二重定義)

- **概要**: `weeklyPlanningReducer.ts` の `append_message` / `set_last_assistant_message` アクションと `PlanningState.messages` / `lastAssistantMessage` / mode `collecting_tasks` 遷移は、どこからも dispatch されない(grep 確認済み: dispatch 箇所は draft block 系のみ)。実際の会話履歴は `NaturalLanguageAssistant.tsx` のローカル `weeklyPlanningMessages`(useState、非永続)にあり、localStorage に保存される `PlanningState.messages` は常に空。
- **優先度**: Low
- **今触らない理由**: 実害なし。会話履歴の永続化を「する/しない」はプロダクト判断(spec §4 の生活プロファイル保持とも絡む)であり、dead code 削除だけ先行すると R5 で復活させる可能性がある。
- **着手条件**: R5(生活プロファイル保持)の保存設計でユーザー判断を取るとき、会話履歴の扱いを同時に決めて「削除」か「配線」かを1タスクで行う。
- **関連 Phase**: R5

## D4. resolveSchedulingInput の到達不能分岐

- **概要**: `pipeline/weeklyPlanningIntakePipeline.ts` の `planningDayCount` 算出で、`state.range?.calendarDayCount ?? (usesResolvedCalendarWindow ? planningDayCountFromRange(...) : ...)` の `planningDayCountFromRange` 呼び出しは、`usesResolvedCalendarWindow = Boolean(calendarDayCount)` が true のとき `??` の左辺で必ず吸収されるため到達不能。
- **優先度**: Low
- **今触らない理由**: 実害なし。ただし `20260710-weekly-planning-ai-range-normalization.md`(AI 経由 range の calendarDayCount 正規化)の実装内容次第でこの分岐の意味が変わるため、単独で消すより同タスクの実装時に整理する方が安全。
- **着手条件**: ai-range-normalization タスクの実装時に、adapter 正規化で `calendarDayCount` が常に付く前提になったら削除(同タスクの報告事項として扱ってよい)。
- **関連 Phase**: R2-Capability 後続

## D5. clarification ターンの dry-run 実行と decision / preview candidates の整合

- **概要**: `buildPipelineOutput` は decision の種類に関係なく draftRequest → dry-run を実行するため、`answer_clarification` ターンでも `draftCandidates` が non-null になり得て、UI(`NaturalLanguageAssistant.tsx`)は decision を見ずに preview blocks を更新する。draft-ready 状態での聞き返しでは「用語説明 + preview 更新」が同時に起きる。計算の無駄と、decision と表示物の整合を pipeline が保証していない構造の2点。
- **優先度**: Low(現状は同一 state なら同一候補になるため視覚上の実害はほぼない)
- **今触らない理由**: 出力契約(decision.kind と draftCandidates の関係)の設計判断が必要で、UI 側の参照も絡む。単独の小修正で直すと UI との契約が暗黙のまま増える。
- **着手条件**: R4(質問計画)または preview 導線の次の改修で、pipeline output の契約(「どの decision.kind のとき candidates を返すか」)を明文化するタスクとして切る。
- **関連 Phase**: R4 / 仮予定表示・承認テーマ

## D6. scheduler 二系統の統合(旧 availability-aware path と新 dry-run path)

- **概要**: 旧 path(`weeklyPlanningTransforms.ts` + `scheduling/availabilitySlots.ts` + `placementScoring.ts`)と新 path(`weeklyDraftCandidateGenerator.ts`)で slot 探索・busy interval の型が共有されていない。roadmap §2・§8 に記録済みの長期課題。
- **優先度**: Low(最後。roadmap の順序どおり)
- **今触らない理由**: 最高リスクの改造であり、roadmap §7 が「整合設計の文書化なしに着手しない」と明示。
- **着手条件**: R8。着手前に busy interval 型の整合設計文書を作る(R8-4 は「統合ではなく型合わせから」)。
- **関連 Phase**: R8

## D7. weeklyPlanningTransforms.ts(2,234行)の解体

- **概要**: 旧 path の中核 + `looksLikeWeeklyPlanningRequest`(ルート分岐)+ legacy fallback の実体(`assessWeeklyPlanningRequest` / `mergeWeeklyPlanningRevision`)を1ファイルに抱える。新 intake path からは fallback とルート分岐のみが依存。
- **優先度**: Low
- **今触らない理由**: 依存の大半(D1 の fallback、D6 の旧 scheduler)が先に整理される必要がある。`looksLikeWeeklyPlanningRequest` の分岐変更は roadmap §7 で regression set 整備まで凍結中。
- **着手条件**: D1(fallback 縮小)と R3 完了後に、残依存を洗い出して分割タスク化。解体自体を目的にせず、依存が消えた部分から削る。
- **関連 Phase**: R3 完了後〜R8

---

## 記録済みだが本 backlog の対象外(別文書・別タスクで管理)

- レビュー問題1・2・4(missing 再シード / explicit 上書き / renderer 登録漏れ) → `docs/ai/tasks/20260710-weekly-planning-range-reseed-guard-and-start-date-render.md`
- レビュー問題3・5・6、slot registry、複合ターン regression → `docs/ai/tasks/20260710-*.md`(索引: `weekly-planning-review-20260710-index.md`)
- capacity 超過(6等分・1日上限)、実 AI 品質評価、明示 duration / daily target 受理、カレンダー予定の intake 注入 → roadmap §3 R2-S 後続候補・§6 に記録済み(本レビューの新規発見ではないため、ここには重複記載しない)

> **Historical handling:** D1〜D7、P4〜P9、T6、v3 stages remain historical references only.
