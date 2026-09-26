# Scheduling domain

Status: canonical domain entry point
Updated: 2026-09-10

このドメインは、StudyPlanner 内の「時間が確定した予定」に関するアプリ全体の責務（app-wide ownership）を扱う。

## Canonical contract

- scheduled-event persistence / occurrence projection: [`architecture/scheduled-event-authority.md`](architecture/scheduled-event-authority.md)
- current operational baseline: [`roadmap/current.md`](roadmap/current.md)

Issue #278 は完了・close 済み。Phase 1/2 は PR #279、Phase 3 canonical persistence は PR #282 で `main` へ統合された。その後の adversarial re-audit で Week consumer だけが timetable template / term を共通 `ScheduleOccurrence` projection へ渡していないことが判明し、最終 follow-up は `f846cfb874c4c26a9bfa355d8c5fe56c911ac705` で `main` に反映された。

最終 follow-up では、Week も Month / Day / AI と同じ occurrence truth を使用し、timetable template 由来の予定は read-only、import 済み Plan は編集可能な canonical 予定として扱い、同一 source の二重表示を防ぐ。exact-head CI / Browser Regression / UI Regression Matrix / UI Quality Automation / Admin Overview Render / Cloudflare deploy がすべて terminal success となった後に #278 を completed で close した。

Firestore Rules は Phase 3 merge 後に repository-owned な WIF workflow から本番へ deploy され、live ruleset read-back まで成功している。Issue #278 用の active implementation branch は現在存在しない。今後の scheduling 変更は、この canonical baseline を前提に、新しい product requirement を所有する Issue で追跡する。

## Responsibility boundary

本ドメインが所有するもの:

- 時間が確定した予定を一つのconcept / persistence authorityとして扱う責任境界
- canonical `ScheduleEvent` の共通予定情報、`busy`、recurrence、source provenance
- `ScheduleOccurrence` のidentity / time semantics / busy semantics
- month / week / day / AI availability が同じ occurrence truth を読むためのprojection contract
- legacy `Plan` / `MonthEvent` から canonical persistence へ移行する際のcutover / recovery invariants

本ドメインが所有しないもの:

- Todo の未確定work lifecycle
- TimetableTemplate 自体の編集・学期・隔週ルール
- Weekly Planning 内部の意味解釈・質問・placement policy
- Actual の学習実績集計
- client/server authorityそのもの

これらは各 owning domain 側で管理を継続し、scheduled occurrence の参照や確定予定の保存が必要な箇所でのみ本ドメインの境界へ接続する。
