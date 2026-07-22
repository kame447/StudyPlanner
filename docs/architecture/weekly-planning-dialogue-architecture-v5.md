# weeklyPlanning 対話アーキテクチャ v5

Status: canonical / active
最終更新: 2026-07-22

- Current contract: [weekly-planning-current-contract-status.md](../ai/weekly-planning-current-contract-status.md)
- Current roadmap: [weekly-planning-roadmap.md](../ai/strategy/weekly-planning-roadmap.md)
- Active migration task: [20260722-weekly-planning-generic-semantic-v5-migration.md](../ai/tasks/20260722-weekly-planning-generic-semantic-v5-migration.md)
- Product specification: [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md)
- Roleplay tests: [weekly-planning-roleplay-test-plan.md](../testing/weekly-planning-roleplay-test-plan.md)

この文書はv4のsemantic pipeline、typed command、exam compatibilityを置き換える。request ownership、preview、approval、storage、security等の非競合部分は継承する。

## 1. 目的

週間計画を院試・過去問専用構造から切り離し、次の利用者を同一modelで扱う。

- 資格試験
- 大学・高校・中学受験
- 学校の授業、宿題、定期試験
- 語学、読書、演習、復習、日常的な自主学習
- 研究、仕事、家事、移動等の非学習task
- 学習taskと非学習taskが混在する一日の計画

中心概念は試験でも年度でもなく、task、component、workload、時間制約、関係である。

## 2. 全体pipeline

```text
raw user turn + recent conversation + public structured context
  → single AI semantic normalizer
  → SemanticTurnDocument
  → closed schema / runtime validation
  → deterministic reference validation / canonicalization
  → atomic PlanningFactGraph commit
  → deterministic fact diff / readiness / dialogue policy
  → unified renderer
  → explicit preview authorization gate
  → generic work item compiler
  → scheduler / feasibility
  → unsaved preview
  → explicit UI approval
  → durable save
```

## 3. 不変条件

- raw user textから新しい意味factを生成する主体はsingle AI semantic normalizerだけとする。
- AI出力後にregex、keyword、数値抽出、近似一致でraw user textを再解釈しない。
- AIはcommand、reducer operation、missing slot、readiness、question target、preview、scheduler、approval、saveを決定しない。
- provider failure、空応答、不正JSON、schema不一致、全候補拒否、repair失敗でもparserへfallbackしない。
- failed/rejected turnはaccepted fact、question context、preview、proposal、draft artifactを変更しない。
- AI出力のlocal IDは同一response内の参照だけに使用し、正式ID、revision、owner、trusted metadataはcoreが発行する。
- partial factを不完全だからという理由だけで破棄しない。
- planning window、task局所期間、deadline、時刻制約、反復、所要時間見積りを混同しない。
- 院試、資格試験、大学受験等をtop-level専用型にしない。
- exam yearはworkload unitの一つであり、scheduler全体の必須軸にしない。
- 新旧semantic resultを同一turnでmergeしない。
- hard constraint、request ownership、stale rejection、approval、storage、securityをAI出力より優先する。

## 4. SemanticTurnDocument

AIが一turnについて返す意味文書である。これはdatabase stateでもreducer commandでもない。

```ts
interface SemanticTurnDocument {
  schemaVersion: string;
  planningIntent: 'create_plan' | 'update_plan' | 'discuss' | 'unknown';
  planningWindow: SemanticPlanningWindow | null;
  tasks: SemanticTask[];
  relations: SemanticRelation[];
  uncertainties: SemanticUncertainty[];
  corrections: SemanticCorrection[];
  decisions: SemanticDecision[];
}
```

### 4.1 Task

```ts
interface SemanticTask {
  localId: string;
  category: 'study' | 'non_study' | 'unknown';
  title: string;
  study: SemanticStudyDetails | null;
  workloads: SemanticWorkload[];
  effortEstimates: SemanticEffortEstimate[];
  temporalConstraints: SemanticTemporalConstraint[];
  recurrence: SemanticRecurrence[];
  sourceText: string;
}
```

`unknown`はAI境界で許可する。分類がschedulerへ影響しない場合は即時質問せず、一般taskとして保持できる。

### 4.2 Study details

```ts
interface SemanticStudyDetails {
  purpose:
    | 'exam'
    | 'course'
    | 'homework'
    | 'self_study'
    | 'practice'
    | 'review'
    | 'habit'
    | 'research'
    | 'other'
    | 'unknown';
  contextLabel: string | null;
  components: SemanticStudyComponent[];
}
```

例:

```text
大学院入試  → purpose=exam, contextLabel=大学院入試
TOEIC       → purpose=exam, contextLabel=TOEIC
英会話習慣  → purpose=habit, contextLabel=英会話
```

### 4.3 Component

科目、分野、教材、topic、章、節、技能等を一つの構造で表す。

```ts
interface SemanticStudyComponent {
  localId: string;
  parentLocalId: string | null;
  role: 'subject' | 'field' | 'material' | 'topic' | 'chapter' | 'section' | 'skill' | 'custom';
  label: string;
  workloads: SemanticWorkload[];
  sourceText: string;
}
```

配列順による対応付けを禁止し、workloadは対象taskまたはcomponentの内側に保持する。

### 4.4 Workload

何をどれだけ進めるかを表す。

```ts
interface SemanticWorkload {
  quantityRole: 'declared' | 'target' | 'remaining' | 'completed' | 'unknown';
  amount: number;
  unitCode:
    | 'minute'
    | 'hour'
    | 'page'
    | 'problem'
    | 'word'
    | 'lesson'
    | 'chapter'
    | 'section'
    | 'exam_year'
    | 'mock_exam'
    | 'session'
    | 'custom';
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  periodExpression: string | null;
  sourceText: string;
}
```

`declared`は量が述べられたが、総量、残量、今回目標のどれかを確定できない場合に使う。

### 4.5 Effort estimate

作業量と所要時間を分離する。

```ts
interface SemanticEffortEstimate {
  targetLocalId: string;
  kind: 'total_duration' | 'duration_per_unit' | 'session_duration';
  minutes: number;
  unitCode: string | null;
  precision: 'exact' | 'approximate' | 'unspecified';
  sourceText: string;
}
```

### 4.6 Temporal constraint

```ts
interface SemanticTemporalConstraint {
  targetLocalId: string;
  kind:
    | 'earliest_start'
    | 'latest_end'
    | 'fixed_interval'
    | 'deadline'
    | 'preferred_window'
    | 'avoid_window';
  dateExpression: string | null;
  startTime: string | null;
  endTime: string | null;
  precision: 'exact' | 'approximate' | 'unspecified';
  sourceText: string;
}
```

例:

```text
20時から       → earliest_start
15時くらいまで → latest_end + approximate
明日まで       → deadline
週末にまとめる → preferred_window
```

### 4.7 Recurrence

```ts
interface SemanticRecurrence {
  targetLocalId: string;
  kind: 'daily' | 'weekly' | 'weekdays' | 'weekends' | 'times_per_week' | 'custom';
  count: number | null;
  days: string[];
  sourceText: string;
}
```

`毎日30分`はrecurrence=dailyとworkload=30 minute/perOccurrenceへ分ける。

### 4.8 Planning window

計画全体をscopeする表現だけを入れる。

```text
今週の計画を立てたい → planningWindow=今週
英単語を今週300語   → workload.periodExpression=今週
```

### 4.9 Relation

```ts
interface SemanticRelation {
  kind: 'before' | 'after' | 'depends_on' | 'priority_over' | 'sequence';
  fromLocalId: string;
  toLocalId: string;
  sourceText: string;
}
```

## 5. AI semantic normalizerの責務

- current user turn、直近会話、public state summary、active public referencesを読む。
- 明示されたtask、component、quantity、time、relation、correction、decisionを構造化する。
- 係り先を保ち、分野別数量を位置配列へ分離しない。
- 不明な値を補完しない。
- 相対日付をsymbolic expressionとして返し、具体日付を勝手に決定しない。
- correctionはpublic semantic refまたは会話内local IDを対象にする。
- state mutation command、private ID、readiness、質問文、preview claimを返さない。

AI repairはschema/JSON出力修復に限り、一turnにつき最大一回とする。repair後も不正ならfail closedする。

## 6. Deterministic semantic core

### 6.1 Runtime validator

- closed object shape
- schema version
- enum、number、time format
- local ID一意性
- parent、target、relation参照
- cycle、self relation
- categoryとstudy detailsの整合
- workload amountとunit
- source evidenceの存在

raw user textから不足factを補わない。

### 6.2 Canonicalizer

SemanticTurnDocumentをPlanningFactGraphへ変換する。

```text
semantic local ID
  → public stable fact ID
  → source fact record
  → revisioned atomic commit
```

正式factは少なくとも次へ分離する。

```text
PlanningTaskFact
StudyContextFact
StudyComponentFact
WorkloadFact
EffortEstimateFact
TemporalConstraintFact
RecurrenceFact
TaskRelationFact
PlanningWindowFact
UncertaintyFact
```

### 6.3 PlanningFactGraph

- accepted factだけを保持する。
- AI raw responseを正本にしない。
- source turn、source excerpt、origin、created revisionを追跡する。
- correctionは対象factをsupersedeし、無関係factを維持する。
- deleteはstable public refを対象とする。
- failed turnはrevisionを進めない。

### 6.4 Assumption proposal

AIは仮定を直接stateへ追加しない。coreが不足fact、uncertainty、readiness policyからproposalを作る。AIは既存public proposalに対する明示decisionの意味だけを返せる。

## 7. Dialogue/readiness

accepted fact diffからdeterministic acknowledgementを作る。acknowledgementは受理したtask、quantity、time、relationだけを短く示す。

質問対象はdeterministic readiness policyが選ぶ。

- previewを止める高影響不足を優先する。
- 一度に原則一件質問する。
- 分類が未確定でも計画可能なら分類質問を後回しにする。
- AI semantic normalizerへ質問選択を委譲しない。

rendererはexam/generalで分岐せず、一つのfact/action contractを使用する。

## 8. Generic work item compiler

```ts
interface PlanningWorkItem {
  id: string;
  taskId: string;
  componentId: string | null;
  label: string;
  unit: {
    code: string;
    ordinal: number | null;
    actualValue: string | number | null;
  };
  estimatedMinutes: number | null;
  splitPolicy: 'atomic' | 'splittable' | 'unknown';
  sourceFactRefs: string[];
}
```

`exam_year`はページ、問題、章、分、session等と同じunitの一つである。具体年度がない「2年分」はordinal 1、2として扱える。具体年度が必要なpolicyだけactualValueを要求する。

estimated minutesが不足する場合、compilerは値を推測せずreadinessへ不足を返す。

## 9. Preview・approval・storage

次はv4以前から継承する。

- explicit user authorization前にschedulerを呼ばない。
- previewは未保存であり、UI approvalまでrepositoryへ保存しない。
- conversation、turn、request、revision、selected weekのownershipを検証する。
- stale preview、pending proposal dependency、owner不一致を拒否する。
- approval operationとitem idempotencyをserver transactionで保証する。
- browser reload後の復元previewは再計算を要求する。
- user-boundary storage envelopeを維持する。

## 10. Migration

### Phase 1: schema and fixtures

- production候補SemanticTurnDocument
- runtime validator
- golden fixtures、property tests、API eval

### Phase 2: PlanningFactGraph

- canonicalizer
- stable IDs
- correction/delete/proposal refs
- old state migration decoder

### Phase 3: shadow normalizer

- production turnを変更せず新normalizerを評価
- parse、rejection、latency、request bytesを観測

### Phase 4: generic work items

- task/component/workload compiler
- existing schedulerへのtemporary adapter
- exam year固定を正本から除去

### Phase 5: dialogue integration

- deterministic acknowledgement
- unified readinessとrenderer
- generic preview metadata

### Phase 6: production cutover

- executorを一括切替
- 同一turnで新旧結果をmergeしない
-旧prompt、command、exam state、adapter、rendererを削除

## 11. 削除対象

移行完了後、次を正本から削除する。

- AIが内部mutation commandを選ぶprompt/schema
- `ExamPrepScope`を中心とするcanonical state
- field配列とprogress配列の位置対応
- `field + year`必須work item/candidate
- exam専用dialogue renderer
- command別validator/reducer/correction replacement command
- production parser/rules semantic fallback

## 12. 検証

最低限次を要求する。

- schema/runtime unit tests
- local ID/ref/cycle property tests
- canonicalizer atomicity tests
- correction isolation tests
- provider failure/no fallback tests
- generic work item tests
- existing preview/approval/security regression
- roleplay evaluation
- opt-in real API evaluation
- full test、TypeScript、build、diff check
- production切替前の七視点監査

## 13. 現在status

- API schema experiment: completed
- architecture v5: documented
- stable production schema: in progress
- PlanningFactGraph: not implemented
- shadow production evaluation: not implemented
- generic work item compiler: not implemented
- production cutover: not started
