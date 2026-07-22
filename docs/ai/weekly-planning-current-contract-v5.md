# weeklyPlanning current contract v5

Status: canonical / active for semantic v5 migration
Updated: 2026-07-22

- Architecture: [weekly-planning-dialogue-architecture-v5.md](../architecture/weekly-planning-dialogue-architecture-v5.md)
- Availability architecture: [weekly-planning-availability-architecture-v5.md](../architecture/weekly-planning-availability-architecture-v5.md)
- Migration roadmap: [weekly-planning-semantic-v5-roadmap.md](strategy/weekly-planning-semantic-v5-roadmap.md)
- Active task and decision log: [20260722-weekly-planning-generic-semantic-v5-migration.md](tasks/20260722-weekly-planning-generic-semantic-v5-migration.md)
- Legacy status overlay: [weekly-planning-current-contract-status.md](weekly-planning-current-contract-status.md)

この文書はsemantic v5移行に関する最優先contractである。request ownership、preview、approval、storage、personalization、trace等の非競合領域は従来のcurrent contractを継承する。

## 1. 意味解釈境界

- raw user textからtask、quantity、time、relation、correction、decision、明示的な外部予定source requestを生成する主体はsingle AI semantic normalizerだけとする。
- AIは内部mutation commandを選ばない。
- AI出力は`SemanticTurnDocument`であり、database state、reducer command、scheduler requestではない。
- validator、canonicalizer、readiness、dialogue、scheduler、safety層はraw textを再解釈しない。
- provider failure、空応答、不正JSON、schema不一致、全拒否、repair失敗でもparserへfallbackしない。
- repairはJSON/schema修復に限り、一turn最大一回とする。
- failed/rejected turnはaccepted facts、question context、preview、proposal、draftを変更しない。

## 2. 汎用task model

唯一の大枠は`PlanningTask`である。

```text
PlanningTask
├─ category: study | non_study | unknown
├─ title
├─ study details
├─ workloads
├─ effort estimates
├─ temporal constraints
└─ recurrence
```

- 院試、資格試験、大学受験等をtop-level専用型にしない。
- 院試は`category=study`、`purpose=exam`、`contextLabel=大学院入試`として表す。
- 科目、分野、教材、章、単元、技能は`StudyComponent`で表す。
- componentとworkloadの対応を同一object内またはID参照で保持し、配列位置へ依存しない。
- 研究等の分類が不明ならAI境界で`unknown`を許可し、必要性が低ければ即時質問しない。

## 3. 数量と時間

- workloadは作業量を表す。
- effort estimateは所要時間見積りを表す。
- temporal constraintは開始、終了、固定区間、締切、希望、回避時間を表す。
- recurrenceは繰り返し頻度を表す。
- planning windowは計画全体の期間だけを表す。
- task局所の「今週」「明日」等をplanning windowへ昇格させない。
- temporal constraintは`hard | soft | unknown`の強さを持つ。
- kindだけから強さを無条件推定しない。

workloadのquantity roleは次とする。

```text
declared | target | remaining | completed | unknown
```

量が明示されたが総量・残量・今回目標のどれかを確定できない場合は`declared`とする。AIに早期確定を強制しない。

## 4. Availabilityと外部予定source

work demandとavailabilityを分離する。

- user-declaredな研究、仕事、授業、食事、風呂、移動等は通常task＋temporal constraintとして保持する。
- timetable、existing plans、calendarの予定本文をAIに再解釈・再生成させない。
- AIはユーザーの明示的な`use/stop_using` source requestだけを返す。
- coreがactive source、owner、event ID、日時、hardnessをauthoritative dataから解決する。
- source取得失敗やpartial fetchを「予定なし」と見なさない。
- user taskとexternal eventをsource refでdedupeし、同一予定を二重計上しない。

## 5. Canonical state

AI出力をそのまま永続化しない。deterministic coreが`PlanningFactGraph`へ変換する。

- 正式ID、revision、owner、trusted metadataはcoreが発行する。
- local IDは一response内参照に限定する。
- accepted factをtask、study context、component、workload、effort、temporal constraint、recurrence、relation、window、uncertainty、source requestへ分離する。
- authoritative external dataからsource selection factとavailability window factを生成する。
- correctionはstable public fact refを対象にし、対象factだけをsupersedeする。
- deleteは明示的public refを対象にする。
- partial factを保持する。例としてend timeだけが明示された制約を捨てない。
- 一turnのcanonical commitはatomicとし、検証失敗時はrevisionを進めない。

## 6. Readinessと対話

- accepted fact diffからgrounded acknowledgementをdeterministicに生成する。
- 次の質問はreadiness policyが選ぶ。
- previewを止める高影響不足を一度に原則一件だけ確認する。
- AI normalizerはmissing slot、question target、readiness、preview可否を決定しない。
- exam専用rendererと一般rendererを最終的に統合する。

## 7. Scheduler境界

schedulerへ渡す正本はgeneric work demandとavailabilityである。

```text
GenericPlanningWorkItem[]
AvailabilityWindowFact[]
TaskRelationFact[]
PlanningWindowFact
```

work itemは次を持つ。

```text
taskId
componentId
unit code
ordinal range
actual range
estimated minutes
split policy
source fact refs
```

- `exam_year`は単位の一つであり、全work itemの必須fieldではない。
- 「2年分」は具体年度がなくてもordinal rangeへ変換できる。
- 具体年度が必要なpolicyだけactual rangeを要求する。
- estimated minutesが不足する場合は推測せずreadinessへ返す。
- hard availability windowへwork itemを配置しない。

## 8. 維持する安全境界

- conversation、turn、request、revision、selected week ownership
- stale async result rejection
- explicit preview authorization
- hard constraintとavailability validation
- unsaved preview
- explicit UI approval
- approval idempotency
- user-boundary storage
- browser reload後のpreview再計算
- trace privacyとaccount data separation

## 9. 移行規則

- 新旧semantic resultを同一turnでmergeしない。
- 新schemaはshadow評価から開始する。
- production切替はexecutor単位で一括して行う。
- temporary adapterは旧schedulerへ渡す境界だけに置き、新しいcanonical stateへexam構造を戻さない。
- production切替後に旧prompt、command schema、command reducer、exam state、exam adapter、exam rendererを削除する。
- mainへ採用する前にfull tests、build、roleplay、real-eval、七視点監査を行う。

## 10. 現在status

```text
API schema experiment           complete
architecture / contract         documented
stable schema / validator       partial: availability fields pending
PlanningFactGraph               foundation complete; lifecycle pending
shadow normalizer               module complete; production disconnected
generic work demand             foundation complete
availability facts              design only
dialogue policy                 pure module complete; renderer disconnected
production cutover              not started
```
