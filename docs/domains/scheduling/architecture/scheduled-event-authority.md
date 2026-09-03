# Scheduled event authority

Status: canonical architecture contract
Updated: 2026-09-03
Owner Issue: #278

## Product invariant

StudyPlannerでは「勉強か、勉強以外か」で保存先や表示先を決めない。

時間が確定したユーザー予定は、表示surfaceに依存しない一つのscheduled-event概念として扱う。月・週・日・AI計画は別々の予定truthを再解釈してはならない。

Phase 3のtarget architectureは次のとおり。

```text
legacy Plan / MonthEvent
  └─ migration input only
          ↓
   canonical ScheduleEvent persistence
          │
          ├──────────────┐
          │              │
          │       TimetableTemplate
          │       (template lifecycle)
          │              │
          └──────┬───────┘
                 ↓
       ScheduleOccurrence projection
                 ↓
        ├─ Month
        ├─ Week
        ├─ Day
        └─ AI occupied-time projection
```

`ScheduleEvent` が永続化正本、`ScheduleOccurrence` が期間内で実際に発生する予定のread modelである。

## Persistence authority and compatibility boundary

per-user cutover完了後、時間が確定した予定の保存正本は `schedule_events` である。

- legacy `plans` / `month_events` はmigration入力と凍結した復旧証拠として残す。
- migration完了後のcreate/edit/deleteはcanonical `ScheduleEvent` authorityへ送る。
- existing UI / Actual / Todo / weekly-planning codeが必要とする `Plan` / `MonthEvent` shapeはrepository compatibility facadeで投影してよいが、それらを第二の保存正本にしてはならない。
- `TimetableTemplate` は授業予定のtemplate lifecycleを所有し続け、必要な期間だけoccurrenceへ展開する。
- 無期限dual-writeは禁止する。

productionのFirebase repository bundleはlegacy repositoryをmigration inputとして内包し、その外側をScheduleEvent-backed repositoryで包む。callerがlegacy write authorityを選択してはならない。

localStorage fallbackも同じcanonical/legacy分離を使うが、これはdevelopment / localhost用である。複数端末cutoverのtransaction保証はFirestore migration boundaryが所有する。

## Identity

canonical persistence IDはlegacy source kindを含める。

```text
plan:<legacyPlanId>
month-event:<legacyMonthEventId>
```

これにより、旧collection間で同じIDが存在してもcanonical recordは衝突しない。compatibility `Plan` へ戻す際は既存のActual / Todo / weekly-planning provenanceを壊さないためlegacy Plan IDを復元する。

Occurrence identityは「logical source entity + occurrence date」を基準にする。開始時刻は編集可能な属性でありidentityへ含めない。

特に時間割templateからimport済みのPlanはtemplateと別予定として二重計上しない。同じsource occurrenceでは保存済みeventを優先するため、import後に時刻を編集してもtemplate occurrenceが別件として復活しない。

表示surfaceが独自IDを再生成してはならない。

## Time semantics

recurrence、excluded date、multi-day span、24:00 / 日跨ぎの意味はconsumerごとに再実装しない。

- canonical ScheduleEventは既存Plan / MonthEvent semanticsを損失なく保持する。
- compatibility Plan recurrenceは既存canonical recurrence helperからoccurrenceへ展開する。
- compatibility MonthEvent recurrence / exclusion / multi-day spanはMonthEvent helperからoccurrenceへ展開する。
- downstream consumerは展開済みoccurrenceのstart/endを基準にする。

Phase 3はpersistence authorityを変えるが、既存recurrenceの意味を変更するmigrationではない。

## Category, kind, busy are separate

意味分類と時間占有は別責任である。

```text
category = study / class / exam / school / cram-school / deadline / other ...
busy = scheduler上で時間を占有するか
kind/details = study-specific / general-specific additional data
```

`category !== study` を理由に月だけへ送る、`category=deadline` を理由に自動で24時間busyにする、といった機械的ルーティングは禁止する。

`busy` の永続化ownerはcanonical `ScheduleEvent` である。

- legacy Plan / MonthEventにはbusy fieldが存在しなかったため、migration時の未指定は互換性維持のため `true` とする。
- canonicalで明示された `busy=false` はcompatibility Plan / MonthEventへ投影しても保持し、編集後にcategoryから `true` へ推論し直してはならない。
- `ScheduleOccurrence` はそのbusy値を保持する。
- AI occupied-time sourceは `busy=true` occurrenceだけをhard constraintへ変換する。

したがってbusy=falseのdeadline等はcalendar surfaceへ表示できるがschedulerの空き時間を塞がない。

## View contract

### Month

- study occurrenceは目標学習時間集計へ使う。
- non-study occurrenceも予定表示へ投影する。
- recurrence / exclusion / multi-day判定をMonthView側で別truthとして再実装しない。

### Week

- persisted scheduled occurrenceとMonthEvent互換projectionを同じ時間軸へ表示する。
- mutation対象のbacking identityを尊重し、表示用projectionを別種類のmutationへ誤送信しない。

### Day

- 当日表示可否と当日時間sliceは`ScheduleOccurrence`から決める。
- URL / memo / checklist等のrich metadataはbacking compatibility objectへ戻って参照してよいが、発生日判定を再解釈しない。

### AI weekly planning

- occupied-time sourceは`ScheduleOccurrence`を経由する。
- general eventもoccupied sourceから漏らさない。
- recurring eventは保存anchor日だけでなくplanning horizon内のoccurrenceを使う。
- timetable templateとimport済みscheduled eventを二重busyにしない。
- busy=false occurrenceはoccupied sourceへ入れない。
- schedulerへ渡す値はevent identity / start / end / source中心とし、title/memo等のstored proseをAI instructionへ昇格させない。

## Ownership / failure

owner mismatchはfail closedする。他ユーザーrecordをoccurrenceとして投影してはならない。

source unavailable / stale semanticsはplanner-data availability ownerを尊重し、取得失敗をauthoritative empty scheduleへ変換してはならない。

migration中は「legacyにもcanonicalにも自由に書ける中間状態」にしない。Firestore marker作成時点でlegacy writeを凍結し、cutoverが完了するまで通常の保存経路はmigration completionを待つかretryable failureにする。

## ScheduleEvent shape

概念形:

```text
ScheduleEvent common
- schema version / id / owner
- title
- date / endDate / startTime / endTime
- recurrence / excluded dates
- category
- busy
- source / legacy provenance
- memo

kind=study
- subject / material / planning provenance

kind=general
- location / url / checklist ...
```

Todo、TimetableTemplate、Actualは異なるlifecycleを持つため、この巨大型へ吸収しない。

## Migration state machine

Firestore cutoverはuser単位のmigration markerで管理する。

```text
marker absent
  │ legacy Plan / MonthEvent are writable
  ↓ transactional acquire
migrating
  │ legacy writes frozen
  │ deterministic canonical backfill
  │ snapshot verification
  ↓
completed
  │ ScheduleEvent is the write authority
  └─ no transition back to migrating
```

重要な競合条件:

1. marker作成はtransactionで行う。markerが先に存在する場合はcurrent migrationだけを再利用する。
2. migration backfillはchunkごとにmarkerを同じFirestore transactionで読む。transactionが `migrating` を確認した場合だけそのchunkを書ける。
3. 別端末が先に `completed` へ進めた場合、遅れていたbackfillはcanonical dataを書かずに終了する。これによりcutover後のユーザー編集を古いlegacy snapshotで上書きしない。
4. canonical snapshotは完了前に再読してdeterministic migration結果と一致することを確認する。
5. 2端末が同じsnapshotを検証済みで同時にcompletionへ到達した場合、同じsource counts / event countの `completed → completed` は冪等として許可できる。countsが異なるcompletionはfail closedする。
6. migration markerなしのcanonical writeは禁止する。marker作成後のlegacy writeも禁止する。
7. completed markerの削除、`completed → migrating`、migration version / operation identityの書換えは禁止する。

### Firestore Rules / client deploy-order compatibility

Firestore RulesとWeb clientは独立したdeploy pipelineを持つため、どちらが先にproductionへ到達しても予定データを壊してはならない。

- clientはmigration開始前に `schedule_event_migrations/{userId}` のread capabilityをprobeする。
- 旧Rulesがまだproductionにあり、このcollection自体が `permission-denied` の場合、その操作だけはlegacy repositoryを唯一のauthorityとして継続する。canonicalへは書かない。
- rollout compatibilityはcacheしない。次の予定操作でcapabilityを再確認し、新Rulesが見えた時点で通常のmarker-first migrationへ進む。
- marker capabilityが読めた後に発生したmigration / verification / canonical write failureをlegacy fallbackで隠してはならない。そこはfail closedする。
- markerが作成された後はRulesがlegacy writeを拒否するため、旧clientと新clientが別truthへ同時書込みすることはない。cutover後に残った旧clientのlegacy write failureは意図したfail-closed behaviorである。

このcompatibilityはdeploy順序を吸収する一時的なcapability gateであり、migration state machineの新しい永続状態でもdual-writeでもない。

## Recovery / rollback strategy

rollbackは「cutover後に旧collectionを再びwrite authorityへ戻す」という意味ではない。それを行うとcanonicalで行われた編集・削除と旧snapshotが直ちにdriftするため禁止する。

Phase 3のrecovery strategyはroll-forwardを基本とする。

- legacy Plan / MonthEventはcutover時点の凍結snapshotとして保持する。
- `migrating` で処理が中断した場合、同じmigration version / deterministic mappingを再実行してcanonical snapshotを再構成・検証する。
- `completed` 後はlegacy write authorityを再有効化しない。
- release rollbackが必要な場合も、ScheduleEvent authorityを理解できる互換コードへ戻すかforward fixする。legacy collectionへ書く旧版をcutover済みuserへ戻す運用はsupported rollbackではない。

これにより復旧可能性を残しながら、旧truthと新truthの同時更新を発生させない。

## Migration invariants

Phase 3 migrationは以下を必須とする。

1. idempotent migration。
2. interruptionから安全にresume / roll-forwardできること。
3. 無期限dual-write禁止。
4. Actual / Todo / weekly-planning provenanceを失わない。
5. recurrence / excluded-date semanticsを変えない。
6. migration再実行でduplicateを作らない。
7. create/edit/deleteが旧truthと新truthへ分裂しない。
8. concurrent migrationがcutover後のcanonical editをstale legacy snapshotで上書きしない。
9. explicit busy semanticsをcategoryから再推論しない。
10. Rules/clientのdeploy順序だけを理由にavailabilityを落としたり、legacyとcanonicalへdual-writeしたりしない。

legacy collectionsの物理削除は本Phaseの必須条件ではない。write authority撤去と復旧証拠の保持を優先し、削除は保存期間・運用方針を別途決定してから行う。
