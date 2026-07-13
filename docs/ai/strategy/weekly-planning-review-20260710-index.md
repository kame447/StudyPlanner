# 週間計画対話レビュー index

Status: **historical evidence index; v4 queue normalized**
最終更新: 2026-07-14
Current DoR: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Current queue: [weekly-planning-roadmap.md](weekly-planning-roadmap.md)
Canonical roleplay / P7 traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)

## Current status note

このindexは2026-07-10〜13の実コード読解・実行再現・対話設計調査の索引である。旧T1〜T6、S1、P1〜P4、v3 stage、D1〜D7はclosed evidenceまたはhistorical backlogであり、current implementation queueではない。

Requirement ID単位の正はroleplay test plan §4の表である。DA-GOAL-001からDA-EVAL-001までの必須15 ID、owning task、test layer、strict assertion/rubric、current statusを一行ずつ追跡する。P1〜P7 case表だけをtraceabilityの代用にしない。

## Evidence map

| 資料 | 残す証拠 | current判断 |
| --- | --- | --- |
| [weekly-planning-nl-capability-model.md](../../architecture/weekly-planning-nl-capability-model.md) | A〜G、既存plans/timetable capability、intake非対称、GoalIntent proposal | v4のみをDoR |
| [weekly-planning-dialogue-architecture.md](../../architecture/weekly-planning-dialogue-architecture.md) | v3 single interpreter、draft-first、fallback移行根拠 | v4へ読み替え |
| [weekly-planning-dialogue-design-review.md](weekly-planning-dialogue-design-review.md) | W1〜W7、production trace、generic error、grounding不足 | DA0〜DA3c回帰根拠 |
| [weekly-planning-deferred-backlog.md](weekly-planning-deferred-backlog.md) | D1〜D7と優先度/延期理由 | queueへ戻さない |
| [weekly-planning-roadmap.md](weekly-planning-roadmap.md) | current queue、R1〜R8、長期安全境界 | 冒頭Current queueだけがstatusの正 |
| [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md) | WP-DA-001、WP-RP-001、P1〜P7、必須15 Requirement IDs | P7 traceabilityの正 |

## 旧レビュー対応

| 旧項目 | 内容 | current読み替え |
| --- | --- | --- |
| T1 | range reseed、explicit上書き、renderer登録漏れ | state/revision evidence |
| T2 | confirmedSlots silent drop | deterministic transition evidence |
| T3 | AI range calendarDayCount/pending bypass | normalization evidence |
| T4 | clarificationがacceptedを破棄 | response/correction orthogonality |
| T5 | question slot分散 | asked history/allowed topics |
| T6 | multi-slot regression不足 | WP-DA-001/DA3c |
| S1/I1/I2 | grounding、single interpreter、history | v4 turn/snapshot |
| P1/P2/P3/P4 | assumption、preview-first、entry/goal | DA0a/DA0/DA1b |

旧Stage 3 taskのcurrent pathは存在しない。履歴参照は[20260710-weekly-planning-dialogue-stage3-goal-acceptance.md](../tasks/superseded/20260710-weekly-planning-dialogue-stage3-goal-acceptance.md)だけを使い、current taskとして実行しない。

旧文書に残るcurrent-lookingな文言はhistorical markerと同じ段落で読む。current statusはv4、roadmapのCurrent queue、roleplayのP7 Requirement tableを同期させる。
