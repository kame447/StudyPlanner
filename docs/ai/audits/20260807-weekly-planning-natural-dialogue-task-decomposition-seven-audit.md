# Weekly Planning natural dialogue / task decomposition seven-view audit

Date: 2026-08-07
Branch: `agent/weekly-ai-conversation-eval`

## Triggering conversation

1. User: `来週の勉強計画を一緒に考えてほしいです。`
2. App: `来週に入れたい勉強内容を教えてください。あわせて、どれくらい進めたいかもわかると計画にしやすいです。`
3. User: `夏休みの課題もまだ終わってなくて、2週間後に共通テスト模試もあるので、その勉強も進めたいです。特に数学が結構まずいです。`
4. App: `「夏休みの課題」と「共通テスト模試の勉強」は把握しました。それぞれ、どれくらい進めたいですか？`
5. User: `夏休みの課題は、できれば来週で半分くらいまで進めたいです。模試の方は数学を中心に、毎日2時間くらい取れたらと思ってます。`
6. App: `夏休みの課題を来週で半分くらい進めるには、合計でどれくらい時間がかかりそうですか？`

The latest pre-fix app reply is step 6. Previous reports incorrectly mixed step 4 and step 6.

## First implementation and real-API result

The first generalized attempt added a prompt rule asking the semantic AI to emit a separate `work_breakdown` uncertainty for an umbrella task and changed the generic renderer/fallback so it would not ask several quantities at once.

The same Turn 2 was then rerun from the original clean Turn 1 checkpoint, without changing the user utterance.

Result:

- The renderer improved from `それぞれ、どれくらい進めたいですか？` to `まずは、夏休みの課題と共通テスト模試の勉強のどちらを先に決めたいですか？`.
- The semantic AI still returned `夏休みの課題` as an ordinary task with no `work_breakdown` uncertainty.
- Therefore the application still did not ask for the contents of the broad task.

This proves that prompt wording alone is not a sufficient contract. It also exposes the same failure shape previously seen with durable concerns: asking the model to represent one meaning in a task and then duplicate a second related signal in a distant top-level array is omission-prone.

## Entity-local granularity implementation and real-API result

The second implementation made task granularity a required provider field with three semantic values: `atomic`, `decomposed`, and `needs_breakdown`. Core code structurally derives the ordinary blocking `work_breakdown` uncertainty only from the provider's explicit `needs_breakdown` classification.

The original Turn 2 was rerun again from the same clean Turn 1 checkpoint.

Result:

- semantic AI classified `夏休みの課題` as `needs_breakdown`;
- semantic AI classified `共通テスト模試の勉強` as `atomic` while preserving its Mathematics concern and goal event;
- core derived one `work_breakdown` uncertainty for the homework task;
- app asked: `夏休みの課題は、今どんなものが残っているかをざっくり教えてください。`

This meets the intended question ordering and confirms the classification comes from AI semantic output rather than deterministic Japanese label matching.

## Breakdown-answer real-API failure

The next user answer was:

`数学のワークと古典の課題が残ってます。数学のワークの方が量は多いです。`

The turn was rejected. Raw semantic output showed three independent problems:

1. It failed to materialize the newly stated constituent work under the pending homework target.
2. It copied accepted prior state such as the planning window, prior uncertainty, goal event, concern, and unrelated exam task into a current-turn delta.
3. It misread `数学のワークの方が量は多い` as a scheduling `priority_over` relation. A quantity comparison is not a priority statement.

The first AI response also attempted a task relation whose source was a component, which the existing relation validator correctly rejected. The repair response changed the relation target but still retained stale prior-turn evidence, so grounding correctly rejected the turn.

This means asking the right decomposition question is not sufficient. Resolution of a decomposition question also needs a typed contextual contract.

## Revised conclusion

The internal graph can retain goal events, concerns, cross-turn entity identity, workload and recurrence, and can now detect an umbrella task generically. The remaining failure is the semantic contract for answering a pending breakdown question.

Fixing only this utterance would be a regression patch. The generalized contract is:

- when the pending question is a `work_breakdown` semantic uncertainty, identify its exact target task through `publicStateSummary.uncertainties[*].targetPublicId`;
- the current semantic document must contain the exact target task using `existingPublicId` and current-turn evidence;
- if constituent work is now identified, represent it on that task and classify it `decomposed`;
- if the user clarifies that it is one schedulable unit, `atomic` is a valid resolution;
- if the answer is still insufficient, `needs_breakdown` may remain, but with current-turn evidence rather than copied prior evidence;
- do not repeat unrelated accepted tasks, the planning window, user context, or the old uncertainty merely because they are visible in context;
- task relations remain task-to-task semantic relations. Comparative workload size is not priority/order/dependency without explicit scheduling meaning.

Validator/repair logic may enforce this typed contract because it uses already-structured pending-question and public-ID information. It must not infer semantics from Japanese tokens.

## Seven-view audit

### 1. User conversation / answerability

`それぞれ、どれくらい進めたいですか？` asks the user to quantify multiple different tasks at once. `夏休みの課題を半分` is also not enough to answer `合計で何時間` when the constituent subjects/materials are unknown. A tutor would normally establish what remains first, then discuss scope or effort.

Requirement: prefer an answerable decomposition question when the current task is an umbrella/category rather than one concrete schedulable unit. Do not require the user to calculate a synthetic total before the app understands the work.

The fallback improvement `どちらを先に決めたいですか？` was better than a multi-slot quantity question but was still insufficient: choosing a task is not the same as decomposing it. The entity-local granularity contract fixed this and produced a direct breakdown question in real API execution.

### 2. Semantic ownership

Code must not detect Japanese labels such as `夏休みの課題`, `宿題`, `卒論`, or `引っ越し準備`. The semantic AI owns interpretation.

Every provider-returned task classifies:

- `atomic`
- `decomposed`
- `needs_breakdown`

The prompt defines those states generically and contains no triggering scenario vocabulary. A deterministic normalization step may derive an ordinary `work_breakdown` uncertainty from explicit `needs_breakdown` because that conversion is structural, not language interpretation.

For a pending `work_breakdown` response, validator logic may require exact binding to the target task and a coherent task-local structure. It may not decide what the user's listed items mean based on keywords.

### 3. Graph / lifecycle

`work_breakdown` uses the existing uncertainty lifecycle. The derived uncertainty targets the exact task fact.

A later answer must update the existing task rather than create an unrelated duplicate. The existing contextual semantic-uncertainty path then removes the exact old uncertainty after a valid resolution delta is canonicalized.

Study answers can become subject/material/topic components. Core code must not invent child work items. If future non-study hierarchical decomposition is required, that deserves its own graph-model design rather than overloading study components.

The task-local granularity field is a semantic transport field; it does not become a scheduler Fact by itself.

### 4. Dialogue policy / question ordering

Semantic uncertainty has higher priority than work-item issues. Therefore a derived `work_breakdown` uncertainty blocks `missing_schedulable_work` and `missing_effort_estimate` until resolved.

For `field = work_breakdown`, deterministic fallback asks what the task consists of / what remains. It must not ask for total time first.

After a valid decomposition answer, the app should ask one answerable next question about one concrete work item, not return to a multi-task form-fill prompt.

### 5. Renderer / natural Japanese

The renderer prompt now states generic conversational principles:

- respond to immediate conversational context, not internal slot names;
- ask one question the user can reasonably answer now;
- do not bundle multiple independent quantities into one `それぞれ` question;
- when `work_breakdown` is undecided, ask for its contents before total quantity/effort;
- `referenceResponse` conveys application intent, not required wording or question order.

No scenario-specific example text was added to the production renderer prompt.

Renderer polish cannot compensate for an incorrect application decision. Dialogue policy and semantic resolution must be correct first.

### 6. Regression / generalization audit

One actual regression-specific implementation was found during this audit: recurrence consistency recognized only `daily`, `weekdays`, and `weekends`. It has been generalized to the full Stable V5 recurrence enum plus canonical `custom:*`; a one-time period such as `next_week` is not converted into recurrence.

Task decomposition is now entity-local rather than driven by example phrases. The breakdown-resolution contract is keyed by typed pending-question state and exact public IDs, not scenario text.

A second general semantic invariant is required: quantity/size comparisons must not be upgraded to `priority_over`, `before`, `after`, or dependency without explicit scheduling semantics.

### 7. Testing / observability

Required before acceptance:

1. Original Turn 2 from a clean checkpoint produces a breakdown question before quantity/effort. **Observed pass in real API.**
2. The provider raw JSON, not deterministic code, classifies the broad task `needs_breakdown`. **Observed pass.**
3. A concrete single task does not get forced through breakdown. Covered by structural tests; real alternate case still required.
4. A breakdown answer updates the exact target task, removes/replaces the exact uncertainty, and retains unrelated accepted facts without re-emitting them as current deltas. **Currently failing; fix required.**
5. Quantity comparison does not become scheduling priority without explicit priority meaning. **Currently failing in provider output; contract required.**
6. Same semantic structure with different wording/domain, with no prompt changes between cases. **Still required.**
7. Recurrence consistency covers non-`daily/weekdays/weekends` forms and does not classify one-time periods as recurrence. **Targeted tests pass.**
8. Renderer output is evaluated from actual transcript, not workflow status. **Done for original Turn 2.**

## Non-goals

- Do not hardcode school subjects or homework labels.
- Do not infer child work items in deterministic code.
- Do not relax grounding or exact-ID validation.
- Do not make every task require decomposition.
- Do not fix only the observed Japanese sentences.
- Do not treat a statement about larger workload as user priority unless priority/order is explicit.
