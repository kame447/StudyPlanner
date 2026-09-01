# Scheduled event authority

Status: canonical architecture contract
Updated: 2026-09-02
Owner Issue: #278

## Product invariant

StudyPlannerでは「勉強か、勉強以外か」で保存先や表示先を決めない。

時間が確定したユーザー予定は、表示surfaceに依存しない一つのscheduled-event概念として扱う。月・週・日・AI計画は別々の予定truthを再解釈してはならない。

```text
scheduled source data
  ├─ current Plan
  ├─ current MonthEvent
  └─ TimetableTemplate where the consumer needs timetable occupancy
          ↓
ScheduleOccurrence projection
          ↓
  ├─ Month
  ├─ Week
  ├─ Day
  └─ AI occupied-time projection
```

## Current compatibility model

Phase 1/2では既存persistenceを破壊しない。

- `Plan` と `MonthEvent` は既存repositoryから読む。
- `TimetableTemplate` はtemplate lifecycleを維持する。
- `src/domain/scheduleOccurrence.ts` が期間内の発生予定を一度だけ展開するcompatibility boundaryになる。
- consumerは可能な限りこのprojectionのidentity/time semanticsを使う。

`ScheduleOccurrence` は永続化正本ではなくread modelである。

## Identity

Occurrence identityは「source entity + occurrence start」に基づく。

重要な例外として、時間割templateからimport済みのPlanは、templateと別予定として二重計上しない。同じ`sourceId`と同じ発生日を同じlogical occurrenceとして扱い、保存済みPlanを優先する。

表示surfaceが独自IDを再生成してはならない。

## Time semantics

recurrence、excluded date、multi-day span、24:00 / 日跨ぎの意味はsourceごとにconsumerで再実装しない。

- Plan recurrenceは既存のcanonical recurrence helperからoccurrenceへ展開する。
- MonthEvent recurrence / exclusion / multi-day spanはMonthEvent helperからoccurrenceへ展開する。
- downstream consumerは展開済みoccurrenceのstart/endを基準にする。

## Category, kind, busy are separate

意味分類と時間占有は別責任である。

```text
category = study / class / exam / school / cram-school / deadline / other ...
busy = scheduler上で時間を占有するか
source/backing kind = どのdomain recordから来たか
```

`category !== study` を理由に月だけへ送る、`category=deadline` を理由に自動で24時間busyにする、といった機械的ルーティングは禁止する。

現行compatibility期間では、既存Plan / MonthEvent / timetable occurrenceは従来挙動を壊さないためbusy=trueとして投影する。将来のcanonical `ScheduleEvent` persistenceではbusyを明示fieldとして所有し、categoryから推論しない。

## View contract

### Month

- study occurrenceは目標学習時間集計へ使う。
- non-study Plan occurrenceとMonthEvent occurrenceは予定表示へ投影する。
- recurrence / exclusion / multi-day判定をMonthView側で別truthとして再実装しない。

### Week

- saved Planに加えてMonthEvent occurrenceも同じ時間軸へ表示する。
- MonthEventはcompatibility期間では表示専用で、Plan用drag/edit mutationへ流さない。

### Day

- MonthEventの当日表示可否と当日時間sliceは`ScheduleOccurrence`から決める。
- 詳細編集に必要なrich metadataは元MonthEventへ戻って参照してよいが、発生日判定を再解釈しない。

### AI weekly planning

- occupied-time sourceは`ScheduleOccurrence`を経由する。
- MonthEvent-only予定もoccupied sourceから漏らさない。
- recurring Planは保存anchor日だけでなく、planning horizon内のoccurrenceを使う。
- timetable templateとimport済みPlanを二重busyにしない。
- schedulerへ渡す値はevent identity / start / end / busy / source中心とし、title/memo等のstored proseをAI instructionへ昇格させない。

## Ownership / failure

owner mismatchはfail closedする。他ユーザーrecordをoccurrenceとして投影してはならない。

source unavailable / stale semanticsはplanner-data availability ownerを尊重し、取得失敗をauthoritative empty scheduleへ変換してはならない。

## Persistence target

最終形では、時間が確定した予定の共通部分をcanonical `ScheduleEvent` persistenceへ移す。

概念形:

```text
ScheduleEvent common
- id / owner
- title
- start / end
- recurrence
- category
- busy
- source / provenance
- memo

kind=study
- subject / material / planning provenance

kind=general
- location / url / checklist ...
```

Todo、TimetableTemplate、Actualは異なるlifecycleを持つため、この巨大型へ吸収しない。

## Migration invariants

Phase 3 migrationは以下を必須とする。

1. idempotent migration。
2. rollback可能なcompatibility期間。
3. 無期限dual-write禁止。
4. Actual / Todo / weekly-planning provenanceを失わない。
5. recurrence / excluded-date semanticsを変えない。
6. migration再実行でduplicateを作らない。
7. create/edit/deleteが旧truthと新truthへ分裂しない。

Phase 3完了前に旧`month_events` authorityを削除してはならない。
