# weeklyPlanning availability / commitment architecture v5

Status: canonical subordinate contract / foundation implemented
最終更新: 2026-07-22

- Parent architecture: [weekly-planning-dialogue-architecture-v5.md](weekly-planning-dialogue-architecture-v5.md)
- Schema overview: [weekly-planning-semantic-schema-v5.md](weekly-planning-semantic-schema-v5.md)
- Current contract: [weekly-planning-current-contract-v5.md](../ai/weekly-planning-current-contract-v5.md)
- Active migration task: [20260722-weekly-planning-generic-semantic-v5-migration.md](../ai/tasks/20260722-weekly-planning-generic-semantic-v5-migration.md)
- External source retry task: [20260722-weekly-planning-external-source-atomic-retry.md](../ai/tasks/20260722-weekly-planning-external-source-atomic-retry.md)
- Specific date / personalization task: [20260722-weekly-planning-specific-date-and-personalization-profile.md](../ai/tasks/20260722-weekly-planning-specific-date-and-personalization-profile.md)

## 1. 目的

汎用task/workload modelだけでは、睡眠、食事、通学、仕事、授業、固定予定、特定日の例外、既存plan、時間割、calendar、利用不可時間をschedulerへ安全に渡せない。本書は「何を進めるか」「いつ実行できるか」「いつ空いているか」を分離する。

```text
PlanningFactGraph
├─ work demand
│  ├─ task
│  ├─ component
│  ├─ workload
│  └─ effort estimate
├─ task-specific date/time
│  ├─ fixed commitment
│  ├─ allowed date
│  └─ excluded date
└─ plan-wide availability
   ├─ user-declared unavailable / available
   ├─ whole-day unavailable
   ├─ preferred / avoided window
   ├─ authoritative occupied window
   └─ selected external source
```

## 2. 不変条件

- workloadは作業量であり、availabilityではない。
- temporal constraintは特定taskの時刻条件である。
- task date ruleは特定taskの実行可能日・除外日であり、時刻条件ではない。
- plan-wide availabilityは特定taskを持たない時間条件である。
- user declarationはAIのsemantic factとして受け、coreがtimezone/date contextを解決する。
- timetable、existing plans、calendarの内容をAIに再解釈・再生成させない。
- AIはユーザーが明示的にsourceの使用・停止を求めた事実だけを意味化する。
- sourceのactive ID、event ID、owner、日時、hardnessはdeterministic coreがauthoritative dataから解決する。
- 同じ固定予定をtaskと可動work itemへ二重計上しない。
- 特定日除外で固定予約が消えても、そのtaskを可動work itemへ戻さない。
- hard occupied/unavailable windowへwork itemを配置しない。
- soft preferenceはfeasibilityを壊さない範囲で最適化へ使う。
- source取得失敗時に「予定なし」と見なさない。
- source取得成功時の空配列は「登録予定なし」の正常結果とする。
- pagination等の途中結果を上位層へ公開しない。
- validator、resolver、scheduler adapterは日本語の日時表現を再解析しない。
- 外部予定取得失敗を理由にconversationやaccepted factsを破棄しない。

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

## 4. Task-specific date rules

特定taskだけに適用する日付条件は、時刻制約とは別のfactにする。

```text
英単語は24日だけやる
→ allowed_date = 2026-07-24

25日は英単語をやらない
→ excluded_date = 2026-07-25
```

```text
TaskDateRuleFact
├─ taskId
├─ kind: allowed_date | excluded_date
├─ dateExpression
├─ constraintLevel: hard
├─ source
└─ createdRevision
```

規則:

- dateExpressionはclosed canonical vocabularyだけを受ける。
- clockとnamed time periodを持たせない。
- hardだけを許可する。
- allowed dateが複数あれば和集合とする。
- excluded dateは実行可能日から差し引く。
- 同じtask・同じ日がallowed/excludedの両方ならblocking conflictとする。
- custom dateを後段で再解析しない。
- planning window外の日付を別の日へ補正しない。
- fixed commitmentの展開後にも同じdate ruleを適用する。

```text
毎日18時に夕食
ただし25日は入れない
→ 25日以外のreservationだけを生成
```

## 5. User-declared availability

特定taskを持たない空き・利用不可・希望・回避時間は`SemanticAvailabilityDeclaration`として意味化する。

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

24日は何も予定を入れない
→ kind=unavailable
→ dateExpression=2026-07-24
→ clockなし
→ constraintLevel=hard
```

`dateExpression`と`namedTimePeriod`を混ぜない。午前中、寝る前等は日付ではなく時間帯である。

## 6. Whole-day unavailable

日付または繰り返しを持つhard unavailableで、clockとnamed time periodがないものは、計画全体の終日利用不可として解決する。

```text
2026-07-24を休みにする
→ start: 2026-07-24 00:00
→ end:   2026-07-25 00:00
```

この例外は一つのtaskだけでなく、全work itemと全可動taskへ適用する。他のavailability種別でclockが欠ける場合は時刻を推測しない。

## 7. Closed date/time vocabulary

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
- `custom:`は後段で自然言語解析せず、未解決としてpreviewを保留する。
- named time periodは注入済みpolicyがある場合だけ具体時刻へ解決する。
- 時間帯と明示clockを同じfactへ同時指定しない。

## 8. Constraint level

すべてのtemporal constraintとavailability declarationは次を持つ。

```text
hard | soft | unknown
```

- `hard`: 動かせない予定、利用不可、明示deadline、絶対条件。
- `soft`: 希望、避けたい時間、できれば、優先時間帯。
- `unknown`: 発話だけでは強さを確定できない。

`preferred_window`とavailability `preferred/avoided`はsoftを期待し、明示的なfixed commitment、task date rule、`unavailable`はhardを期待する。矛盾する組合せはclosed validatorで拒否する。

## 9. External source request

AIは外部予定の本文ではなく、明示的source requestだけを返す。

```text
kind: timetable | existing_plans | calendar
selector: active
requestedAction: use | stop_using
```

曖昧な「予定を見て」は一つのsourceへ勝手に確定しない。AIはuncertaintyを返すか、public contextで参照先が一意の場合だけrequestを返す。

## 10. External source acquisition

外部予定取得結果は成功または失敗だけとする。

```text
success(events, source ID, owner, attempt count)
failure(reason, attempt count)
```

`success(events=[])`は正常な「予定なし」である。`partial`状態は設けない。paginationや複数requestの途中で失敗した場合、取得adapterは途中結果を破棄する。

自動再試行する:

```text
timeout
network_error
rate_limited
server_error
transport exception
```

自動再試行しない:

```text
authentication_error
permission_error
source_not_configured
invalid_response
```

既定は最大3回とする。待機処理は注入可能とし、unit testで実時間待機を発生させない。

## 11. Authoritative resolution

coreはuser declarationまたは取得済みsource snapshotを検証後、owner-bound contextから次を生成する。

```text
ConstraintSourceSelectionFact
AvailabilityWindowFact
TaskCommitmentReservation
ResolvedTaskDateEligibility
```

`ResolvedTaskDateEligibility`はtaskごとに次を持つ。

```text
taskId
allowedDates: string[] | null
excludedDates: string[]
sourceFactIds: string[]
```

`allowedDates=null`は、除外日以外のplanning window内日付で実行可能という意味である。空配列は、明示的allowed ruleはあるがplanning window内に許可日がない状態である。

AIはこれらの解決済みfactを直接生成しない。

## 12. Resolution rules

- user declarationはplanning window内の日付だけへ展開する。
- task date ruleもplanning windowと交差させる。
- recurrent weekdays/weekendsは共通calendar resolverで展開する。
- 23:00〜00:30等は翌日終了として保持する。
- named time periodにpolicyが無い場合は時刻を捏造しない。
- date-only hard unavailableは終日windowへ変換する。
- fixed reservationを生成後、task date ruleで日付を絞る。
- external sourceは`success`の場合だけ一括importする。
- successのeventsが0件でもsource selectionは正常に成立する。
- failure、owner mismatch、invalid eventが一件でもあればsource eventを採用しない。
- external eventは一件でも不正ならそのsource import全体を拒否する。
- `stop_using`はeventを取得せずdeselectionだけを生成する。

## 13. Duplicate prevention

- user availabilityのsourceRefはavailability declaration fact IDとする。
- user commitmentのsourceRefはtemporal constraint fact IDとする。
- task date eligibilityはtask date rule fact IDを保持する。
- external sourceのsourceRefはauthoritative event IDとする。
- `(sourceKind, sourceRef, start, end)`をwindow dedupe keyとする。
- task reservationはtask IDを保持し、同じtaskの可動work itemとの重複を防止する。

## 14. Scheduler input

schedulerは次を同時に受け取る。

```text
GenericPlanningWorkItem[]
TaskCommitmentReservation[]
ResolvedTaskDateEligibility[]
AvailabilityWindowFact[]
TaskRelationFact[]
PlanningWindowFact
```

- work itemは進める量と所要時間を表す。
- task reservationは固定taskの配置を表す。
- task date eligibilityはtask単位の実行可能日・除外日を表す。
- availability windowは計画全体の配置可能/不可能時間を表す。
- relationは順序・依存・優先を表す。
- planning windowはschedule horizonを表す。

## 15. Failure behavior

- user declaration incomplete: 不完全なfactを保持し、必要な一項目だけ確認する。
- custom/date resolution failure: declaration/ruleを捨てずpreviewを保留する。
- named time period unresolved: 時刻を推測せずpreviewを保留する。
- task date allow/exclude conflict: どちらを採用するか一件だけ確認する。
- orphan task date rule: 対象taskを確認する。
- external source failure: 「予定なし」と扱わず、そのsourceを反映した最終previewだけを保留する。
- external source failure中もconversation、accepted facts、他の条件確認を継続する。
- invalid owner/source ref: source import全体を拒否し、入力済み計画内容を保持する。
- invalid planning date/timezone: factを捨てずpreviewを保留する。
- ユーザーが明示的にsourceを使わず進めると決めた場合だけ、そのsource依存を解除する。

## 16. Migration

旧`LifeConstraint`は次へ移す。

```text
fixed_event / commute / meal / bath / sleep
→ user commitment task + temporal constraint

unavailable with date only
→ whole-day availability declaration

unavailable with clock
→ user availability declaration または authoritative availability window

per-task exception date
→ task date rule

buffer
→ scheduler policy / soft availability

constraintSourcesInUse
→ ConstraintSourceSelectionFact
```

旧dataに係り先、日時、hardness、source identityが不足する場合は推測せずmigration uncertaintyを作る。
