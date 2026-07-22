# weeklyPlanning availability / commitment architecture v5

Status: canonical subordinate contract / foundation implemented
最終更新: 2026-07-22

- Parent architecture: [weekly-planning-dialogue-architecture-v5.md](weekly-planning-dialogue-architecture-v5.md)
- Current contract: [weekly-planning-current-contract-v5.md](../ai/weekly-planning-current-contract-v5.md)
- Active migration task: [20260722-weekly-planning-generic-semantic-v5-migration.md](../ai/tasks/20260722-weekly-planning-generic-semantic-v5-migration.md)

## 1. 目的

汎用task/workload modelだけでは、睡眠、食事、通学、仕事、授業、固定予定、既存plan、時間割、calendar、利用不可時間をschedulerへ安全に渡せない。本書は「何を進めるか」と「いつ空いているか」を分離する。

```text
PlanningFactGraph
├─ work demand
│  ├─ task
│  ├─ component
│  ├─ workload
│  └─ effort estimate
└─ availability / commitment
   ├─ user-declared commitment task
   ├─ user-declared availability / unavailable window
   ├─ authoritative occupied window
   ├─ available window
   ├─ preferred / avoided window
   └─ selected external source
```

## 2. 不変条件

- workloadは作業量であり、availabilityではない。
- temporal constraintは特定taskへの時刻条件であり、計画全体の空き時間宣言や外部予定そのものではない。
- user-declared availabilityはAIのsemantic declarationとして受け、coreがtimezone/date contextを解決してwindowへ変換する。
- timetable、existing plans、calendarの内容をAIに再解釈・再生成させない。
- AIはユーザーが明示的にsourceの使用・停止を求めた事実だけを意味化する。
- sourceのactive ID、event ID、owner、日時、hardnessはdeterministic coreがauthoritative dataから解決する。
- 同じ固定予定をtaskとoccupied windowへ二重計上しない。
- hard occupied/unavailable windowへ学習work itemを配置しない。
- soft preferenceはfeasibilityを壊さない範囲で最適化へ使う。
- source取得失敗時に「予定なし」と見なさない。
- validator、resolver、scheduler adapterは日本語の日時表現を再解析しない。

## 3. User-declared commitment

ユーザーが会話内で述べる研究、仕事、食事、風呂、移動、授業等は通常の`PlanningTask`として保持する。

```text
18時から19時まで夕食
→ non_study task
→ fixed_interval temporal constraint
→ constraintLevel=hard

寝る前に英単語
→ study task/component
→ preferred_window temporal constraint
→ namedTimePeriod=before_sleep
→ constraintLevel=soft
```

固定区間が明示されたtaskはtask ID付きreservationへ変換する。scheduler adapterは同じtaskを別の可動work itemとして重複配置しない。

## 4. User-declared availability

特定taskを持たない空き・利用不可・希望・回避時間は`SemanticAvailabilityDeclaration`として意味化する。

```ts
interface SemanticAvailabilityDeclaration {
  localId: string;
  kind: 'available' | 'unavailable' | 'preferred' | 'avoided';
  dateExpression: string | null;
  namedTimePeriod:
    | 'morning'
    | 'afternoon'
    | 'evening'
    | 'night'
    | 'before_sleep'
    | 'before_meal'
    | 'after_meal'
    | `custom:${string}`
    | null;
  startTime: string | null;
  endTime: string | null;
  recurrenceKind:
    | 'daily'
    | 'weekly'
    | 'weekdays'
    | 'weekends'
    | 'custom'
    | null;
  days: string[];
  constraintLevel: 'hard' | 'soft' | 'unknown';
  sourceText: string;
}
```

例:

```text
平日は18時まで勉強できない
→ kind=unavailable
→ recurrenceKind=weekdays
→ endTime=18:00
→ constraintLevel=hard

土日の午前中がやりやすい
→ kind=preferred
→ recurrenceKind=weekends
→ namedTimePeriod=morning
→ constraintLevel=soft

明日は20時以降空いている
→ kind=available
→ dateExpression=tomorrow
→ startTime=20:00
```

`dateExpression`と`namedTimePeriod`を混ぜない。午前中、寝る前等は日付ではなく時間帯である。

## 5. Closed date/time vocabulary

AI境界で次へ正規化する。

```text
dateExpression:
  today | tomorrow | day_after_tomorrow | this_week | next_week
  | YYYY-MM-DD
  | custom:<原文>

namedTimePeriod:
  morning | afternoon | evening | night
  | before_sleep | before_meal | after_meal
  | custom:<原文>
```

- `今日`、`明日`、`来週`等の日本語を後段へ渡さない。
- ISO形式だけでなく実在する日付かを検証する。
- 週境界は月曜日始まりとする。
- `custom:`は後段で自然言語解析せず、未解決としてpreviewをblockする。
- named time periodは注入済みpolicyがある場合だけ具体時刻へ解決する。
- 時間帯と明示clockを同じfactへ同時指定しない。

## 6. Constraint level

すべてのtemporal constraintとavailability declarationは次を持つ。

```text
hard | soft | unknown
```

- `hard`: 動かせない予定、利用不可、明示deadline、絶対条件。
- `soft`: 希望、避けたい時間、できれば、優先時間帯。
- `unknown`: 発話だけでは強さを確定できない。

`preferred_window`とavailability `preferred/avoided`はsoftを期待し、明示的なfixed commitmentや`unavailable`はhardを期待する。矛盾する組合せはclosed validatorで拒否する。

## 7. External source request

AIは外部予定の本文ではなく、明示的source requestだけを返す。

```ts
interface SemanticConstraintSourceRequest {
  localId: string;
  kind: 'timetable' | 'existing_plans' | 'calendar';
  selector: 'active';
  requestedAction: 'use' | 'stop_using';
  sourceText: string;
}
```

曖昧な「予定を見て」は一つのsourceへ勝手に確定しない。AIはuncertaintyを返すか、public contextで参照先が一意の場合だけrequestを返す。

## 8. Authoritative resolution

coreはuser declarationまたはsource requestを検証後、owner-bound contextから次を生成する。

```ts
interface ConstraintSourceSelectionFact {
  requestFactId: string;
  kind: 'timetable' | 'existing_plans' | 'calendar';
  selector: 'active';
  status: 'selected' | 'deselected';
  sourceId: string | null;
  ownerId: string;
}

interface AvailabilityWindowFact {
  kind: 'occupied' | 'unavailable' | 'available' | 'preferred' | 'avoided';
  start: { date: string; time: string };
  end: { date: string; time: string };
  timeZone: string;
  constraintLevel: 'hard' | 'soft';
  sourceKind:
    | 'user_declaration'
    | 'user_commitment'
    | 'timetable'
    | 'existing_plan'
    | 'calendar';
  sourceRef: string;
  ownerId: string;
}
```

AIは`AvailabilityWindowFact`を直接生成しない。

## 9. Resolution rules

- user declarationはplanning window内の日付だけへ展開する。
- recurrent weekdays/weekendsは共通calendar resolverで展開する。
- 23:00〜00:30等は翌日終了として保持する。
- named time periodにpolicyが無い場合は時刻を捏造しない。
- external sourceは`complete`の場合だけ一括importする。
- `partial`、`unavailable`、owner mismatch、invalid eventが一件でもあればsource全体を採用しない。
- `stop_using`はeventを取得せずdeselectionだけを生成する。

## 10. Duplicate prevention

- user availabilityのsourceRefはavailability declaration fact IDとする。
- user commitmentのsourceRefはtemporal constraint fact IDとする。
- external sourceのsourceRefはauthoritative event IDとする。
- `(sourceKind, sourceRef, start, end)`をdedupe keyとする。
- task reservationはtask IDを保持し、同じtaskの可動work itemとの重複を防止する。

## 11. Scheduler input

schedulerは次を同時に受け取る。

```text
GenericPlanningWorkItem[]
TaskCommitmentReservation[]
AvailabilityWindowFact[]
TaskRelationFact[]
PlanningWindowFact
```

- work itemは進める量と所要時間を表す。
- task reservationは固定taskの配置を表す。
- availability windowは配置可能/不可能時間を表す。
- relationは順序・依存・優先を表す。
- planning windowはschedule horizonを表す。

## 12. Failure behavior

- user declaration incomplete: partial factを保持し、必要な一項目だけ確認する。
- custom/date resolution failure: declarationを捨てずpreviewをblockする。
- named time period unresolved: 時刻を推測せずpreviewをblockする。
- external source unavailable/partial: 「予定なし」と扱わずpreviewをblockする。
- invalid owner/source ref: source import全体を拒否する。
- invalid planning date/timezone: windowを捨てずpreviewをblockする。

## 13. Migration

旧`LifeConstraint`は次へ移す。

```text
fixed_event / commute / meal / bath / sleep
→ user commitment task + temporal constraint

unavailable
→ user availability declaration または authoritative availability window

buffer
→ scheduler policy / soft availability

constraintSourcesInUse
→ ConstraintSourceSelectionFact
```

旧dataに係り先、日時、hardness、source identityが不足する場合は推測せずmigration uncertaintyを作る。
