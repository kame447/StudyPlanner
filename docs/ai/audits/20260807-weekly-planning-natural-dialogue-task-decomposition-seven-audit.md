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

## Revised conclusion

The internal graph can retain goal events, concerns, cross-turn entity identity, workload and recurrence, but the dialogue policy still behaves like slot filling unless the semantic layer explicitly represents task granularity.

Fixing only the Japanese sentences would be a regression patch. Repeating stronger prompt instructions to force an extra uncertainty array entry would also be fragile.

The revised design is entity-local:

- every provider-returned task explicitly classifies its planning granularity;
- the classification is one of `atomic`, `decomposed`, or `needs_breakdown`;
- `atomic` means the utterance presents one schedulable work unit or no meaningful planning decomposition is needed;
- `decomposed` means the current semantic result already identifies constituent work;
- `needs_breakdown` means the AI identifies a collection/project/category whose independently schedulable constituents are still unknown;
- core code does not infer this from Japanese text; it only converts the explicit `needs_breakdown` semantic classification into the existing blocking uncertainty lifecycle.

This avoids asking the model to duplicate the same semantic judgment into two disconnected output locations.

## Seven-view audit

### 1. User conversation / answerability

`それぞれ、どれくらい進めたいですか？` asks the user to quantify multiple different tasks at once. `夏休みの課題を半分` is also not enough to answer `合計で何時間` when the constituent subjects/materials are unknown. A tutor would normally establish what remains first, then discuss scope or effort.

Requirement: prefer an answerable decomposition question when the current task is an umbrella/category rather than one concrete schedulable unit. Do not require the user to calculate a synthetic total before the app understands the work.

The fallback improvement `どちらを先に決めたいですか？` is better than a multi-slot quantity question but is not sufficient: choosing a task is not the same as decomposing it.

### 2. Semantic ownership

Code must not detect Japanese labels such as `夏休みの課題`, `宿題`, `卒論`, or `引っ越し準備`. The semantic AI owns interpretation.

The provider schema should force an explicit task-local granularity judgment instead of relying on a second optional semantic action:

- `atomic`
- `decomposed`
- `needs_breakdown`

The prompt defines those states generically. It must not contain the triggering scenario vocabulary.

A deterministic normalization step may derive the ordinary `work_breakdown` uncertainty from `needs_breakdown` because that conversion is structural, not language interpretation. It may not change `atomic` to `needs_breakdown` based on task title or raw user text.

### 3. Graph / lifecycle

`work_breakdown` continues to use the existing uncertainty lifecycle rather than introducing a second dialogue state. The derived uncertainty targets the exact task fact.

A later user answer is interpreted normally; the existing contextual semantic-uncertainty path canonicalizes the resolved semantic delta and removes the exact uncertainty.

Study answers may become subject/material/topic components. Non-study answers may become separate tasks or other semantic structure as interpreted by the AI. Core code must not invent child work items.

The task-local granularity field is a semantic transport field; it does not become a scheduler Fact by itself.

### 4. Dialogue policy / question ordering

Semantic uncertainty already has higher priority than work-item issues. Therefore a derived `work_breakdown` uncertainty naturally blocks `missing_schedulable_work` and `missing_effort_estimate` until the user supplies the breakdown.

For `field = work_breakdown`, deterministic fallback should ask what the task consists of / what remains, using the target task label. It must not ask for total time first.

When no breakdown uncertainty exists, ordinary quantity/effort questions remain valid. For multiple concrete tasks, do not ask the user to fill all quantities in one turn; ask one manageable next question.

### 5. Renderer / natural Japanese

The renderer prompt was generic but under-specified. It only requested natural Japanese and treated deterministic text as a reference, so it could polish slot filling without changing the conversational burden.

General renderer contract:

- respond to immediate conversational context, not internal slot names;
- ask one question the user can reasonably answer now;
- do not bundle multiple independent quantities into one `それぞれ` question;
- when `work_breakdown` is undecided, ask for the contents of that work before total quantity/effort;
- acknowledge useful context briefly when it helps continuity, but do not mechanically say `把握しました`;
- `referenceResponse` conveys application intent, not required wording or question order.

No scenario-specific example text should be added to the production renderer prompt.

### 6. Regression / generalization audit

Recent semantic fixes are mostly structural (`existingPublicId`, user-context delta/provenance, event-vs-deadline consistency). Those are general contracts.

One actual regression-specific implementation was found: recurrence consistency recognized only `daily`, `weekdays`, and `weekends`, even though the Stable V5 schema supports `daily`, `weekly`, `weekdays`, `weekends`, `times_per_week`, and `custom`. This has been generalized to the schema enum plus canonical `custom:*`, while non-recurring period expressions remain unaffected.

For task decomposition, production prompts must not contain triggering labels. Tests must assert that the generic semantic contract works on structurally similar wording with no prompt change between cases.

### 7. Testing / observability

Required before accepting the fix:

1. Original conversation, rerun from the clean Turn 1 checkpoint: broad school-work task + another goal -> breakdown question comes before total effort.
2. Same semantic structure with different wording/domain, with no production prompt changes between cases.
3. A concrete single task must classify as non-breakdown and must not be forced through decomposition.
4. A later decomposition answer resolves the exact uncertainty and retains previously accepted facts.
5. Recurrence consistency covers supported non-`daily/weekdays/weekends` forms and does not classify a one-time period as recurrence.
6. Renderer output is evaluated from the actual transcript, not only workflow status.
7. Inspect raw semantic output to confirm the provider, not deterministic text matching, chose task granularity.

## Non-goals

- Do not hardcode school subjects or homework labels.
- Do not infer child work items in deterministic code.
- Do not relax grounding or exact-ID validation.
- Do not make every task require decomposition.
- Do not fix only the observed Japanese sentences.
