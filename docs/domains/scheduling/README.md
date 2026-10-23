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

## Active work

- [Restore the accepted major event on Undo](work/month-event-undo-latest-handoff.md) — local two-reference correction with real-Local persistence and progress regression coverage; publication/native pending.

- [Calendar recurrence evaluation](work/calendar-recurrence-evaluation-handoff.md) — reuse the selected occurrence rule; exact-content publication verification in progress.

- [Yearly quick entry](work/yearly-quick-entry-handoff.md) — schedule type ordering and annual structured recurrence, including persistence and scoped edits.

- [Compact event label picker](work/schedule-color-label-picker-handoff.md) — replaces the always-visible color chips from merged #663 with a one-line label below the time fields; local implementation and focused checks, publication/native verification pending.

- [Event editor selection and optional fields](work/event-editor-selection-handoff.md) — add wording, selection cue, color chips, and reversible disclosure; focused checks passed, combined/visual verification pending.

- [Recurring general-event edit scope](work/20261014-recurring-edit-scope.md) — restore single/future selection while preserving earlier occurrences; local implementation verified, publication/native gates pending.
- [Month-event save range validation](work/month-event-save-range-handoff.md) — local correction aligning persistence admission with existing multi-day editor validation; publication and native execution pending.

- [Day grid native selection](work/day-grid-native-selection-handoff.md) — PR #648; suppress accidental native text selection in the Day grid while preserving editors and schedule gestures.
- [Day timetable visibility and occurrence cancellation](work/day-timetable-occurrence-controls-handoff.md)
- [Narrow canonical schedule projection reads](work/20261013-schedule-projection-reads.md) — Issue #542; local targeted-recovery read reduction, with production frequency and deployed index verification separate.
- [Class detail, attendance, and associated schedules](work/20261013-class-detail-attendance.md) — active local-only feature; independent attendance evidence and an optional lesson reference on existing canonical schedules.

- [Continuous radial flick selection](work/radial-continuous-flick-handoff.md) — local same-finger selection, gesture ownership and capability-limited haptics; native acceptance pending.

- [Final explicit-date deletion](work/recurring-last-date-delete-handoff.md) — local fix for a deleted final date reappearing after reload; existing storage/IDs retained, focused verification and old-reader evidence recorded.

- [Week spanning-event keyboard access](work/week-spanning-keyboard-handoff.md) — Issue #780; named native action buttons, with read-only timetable and plan tap behavior preserved. Local verification passes; native browser acceptance remains pending.
