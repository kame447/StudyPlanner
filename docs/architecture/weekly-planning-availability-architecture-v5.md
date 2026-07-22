# weeklyPlanning availability / commitment architecture v5

Status: canonical subordinate contract
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
   ├─ authoritative occupied window
   ├─ available window
   ├─ preferred / avoided window
   └─ selected external source
```

## 2. 不変条件

- workloadは作業量であり、availabilityではない。
- temporal constraintはtaskへの時刻条件であり、外部予定そのものではない。
- timetable、existing plans、calendarの内容をAIに再解釈・再生成させない。
- AIはユーザーが明示的に「時間割を使って」「既存予定を考慮して」と述べたsource selectionだけを意味化する。
- sourceのactive ID、event ID、owner、日時、hardnessはdeterministic coreがauthoritative dataから解決する。
- 同じ固定予定をtaskとoccupied windowへ二重計上しない。
- hard occupied windowへ学習work itemを配置しない。
- soft preferenceはfeasibilityを壊さない範囲で最適化へ使う。
- source取得失敗時に「予定なし」と見なさない。

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
→ constraintLevel=soft
```

workloadがあるcommitmentはgeneric work itemへ変換できる。固定区間が明示されている場合、scheduler adapterはそのtaskをfixed commitmentとして扱い、同じtaskから別の可動work itemを重複生成しない。

## 4. Constraint level

すべてのtemporal constraintは次を持つ。

```text
hard | soft | unknown
```

- `hard`: 動かせない予定、利用不可、明示deadline、絶対条件。
- `soft`: 希望、避けたい時間、できれば、優先時間帯。
- `unknown`: 発話だけでは強さを確定できない。

kindだけから強さを無条件推定しない。ただしschema整合として`preferred_window`はsoft、明示的なfixed commitmentはhardを期待し、矛盾はvalidatorまたはcanonical policyで拒否する。

## 5. External source request

AI SemanticTurnDocumentは外部予定の本文ではなく、明示的source requestだけを返す。

```ts
interface SemanticConstraintSourceRequest {
  localId: string;
  kind: 'timetable' | 'existing_plans' | 'calendar';
  selector: 'active';
  requestedAction: 'use' | 'stop_using';
  sourceText: string;
}
```

曖昧な「予定を見て」は一つのsourceへ勝手に確定しない。AIはuncertaintyを返すか、recent public contextで参照先が一意の場合だけrequestを返す。

## 6. Authoritative resolution

coreはsource requestを検証後、owner-bound dataから次を生成する。

```ts
interface ConstraintSourceSelectionFact {
  id: string;
  kind: 'timetable' | 'existing_plans' | 'calendar';
  selector: 'active';
  status: 'selected' | 'deselected';
  sourceRequestFactId: string;
}

interface AvailabilityWindowFact {
  id: string;
  kind: 'occupied' | 'unavailable' | 'available' | 'preferred' | 'avoided';
  startDateTime: string;
  endDateTime: string;
  constraintLevel: 'hard' | 'soft';
  sourceKind:
    | 'user_commitment'
    | 'timetable'
    | 'existing_plan'
    | 'calendar'
    | 'life_routine';
  sourceRef: string;
  ownerId: string;
}
```

AIは`AvailabilityWindowFact`を直接生成しない。

## 7. Duplicate prevention

- user-declared taskからfixed windowを生成する場合、sourceRefはtask/constraint fact IDとする。
- external sourceから生成する場合、sourceRefはauthoritative event IDとする。
- `(sourceKind, sourceRef, startDateTime, endDateTime)`をdedupe keyとする。
- existing planが会話内taskとしても参照された場合、public source refが一致すれば一つへ統合する。

## 8. Scheduler input

schedulerは次を同時に受け取る。

```text
GenericPlanningWorkItem[]
AvailabilityWindowFact[]
TaskRelationFact[]
PlanningWindowFact
```

- work itemは進める量と所要時間を表す。
- availability windowは配置可能/不可能時間を表す。
- relationは順序・依存・優先を表す。
- planning windowはschedule horizonを表す。

## 9. Failure behavior

- external source unavailable: readinessへ`constraint_source_unavailable`を返す。
- source request unresolved: sourceを選択せず質問する。
- invalid owner/source ref: whole importを拒否する。
- partial source fetch:取得済みだけでpreviewを作らず、source completenessを確認する。
- timezone/date conversion failure: occupied windowを捨てずpreviewをblockする。

## 10. Migration

旧`LifeConstraint`は次へ移す。

```text
fixed_event / commute / meal / bath / sleep
→ user commitment task + temporal constraint

unavailable
→ availability window

buffer
→ scheduler policy / soft availability

constraintSourcesInUse
→ ConstraintSourceSelectionFact
```

旧dataに係り先やhardnessが不足する場合は推測せずmigration uncertaintyを作る。
