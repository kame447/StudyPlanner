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

The latest app reply is step 6. Previous reports incorrectly mixed step 4 and step 6.

## Conclusion

The internal graph can now retain goal events, concerns, cross-turn entity identity, workload and recurrence, but the dialogue policy still behaves like slot filling. The problem is not only Japanese wording. The application asks for quantity/effort before determining whether a broad task should be decomposed into schedulable work units.

Fixing only the two Japanese sentences would be a regression patch. The correction must introduce a generic semantic representation for an umbrella task whose work breakdown is still unknown, route that state ahead of quantity/effort questions, and make the renderer ask one answerable conversational question.

## Seven-view audit

### 1. User conversation / answerability

`それぞれ、どれくらい進めたいですか？` asks the user to quantify multiple different tasks at once. `夏休みの課題を半分` is also not enough to answer `合計で何時間` when the constituent subjects/materials are unknown. A tutor would normally establish what remains first, then discuss scope or effort.

Requirement: prefer an answerable decomposition question when the current task is an umbrella/category rather than one concrete schedulable unit. Do not require the user to calculate a synthetic total before the app understands the work.

### 2. Semantic ownership

Code must not detect Japanese labels such as `夏休みの課題`, `宿題`, `卒論`, or `引っ越し準備`. The semantic AI already owns interpretation. It should be able to state that a task is an umbrella whose constituent work is unknown without inventing those constituents.

Use an ordinary semantic uncertainty targeting the task with `field = work_breakdown`. This means: the task identity is understood, but its constituent work is not yet known. It is not a missing quantity and not an application command.

Do not emit this uncertainty for a task the user presents as one concrete schedulable unit.

### 3. Graph / lifecycle

`work_breakdown` must use the existing uncertainty lifecycle rather than introducing a second temporary dialogue state. The uncertainty targets the task fact. A later user answer is interpreted normally; the existing contextual semantic-uncertainty path canonicalizes the resolved delta and removes the exact uncertainty.

Study answers may become subject/material/topic components. Non-study answers may become separate tasks or other semantic structure as interpreted by the AI. Core code must not invent a decomposition.

### 4. Dialogue policy / question ordering

Semantic uncertainty already has higher priority than work-item issues. Therefore `work_breakdown` naturally blocks `missing_schedulable_work` and `missing_effort_estimate` until the user supplies the breakdown.

For `field = work_breakdown`, deterministic fallback should ask what the task consists of / what remains, using the target task label. It must not ask for total time first.

When no breakdown uncertainty exists, ordinary quantity/effort questions remain valid. For multiple concrete tasks, do not ask the user to fill all quantities in one turn; ask for one manageable next piece.

### 5. Renderer / natural Japanese

The renderer prompt is currently generic but under-specified. It says only to produce natural Japanese and treats the deterministic response as a reference. This permits polished slot-filling rather than a tutor-like conversation.

General renderer contract:

- respond to the immediate conversational context, not internal slot names;
- ask one question the user can reasonably answer now;
- do not bundle multiple independent quantities into one `それぞれ` question;
- if undecided state says the work breakdown is unknown, ask for that breakdown before total quantity/effort;
- acknowledge useful context briefly when it helps continuity, but do not mechanically say `把握しました`;
- `referenceResponse` conveys application intent, not required wording or question order.

No scenario-specific example text should be added to the production prompt.

### 6. Regression / generalization audit

Recent semantic fixes are mostly structural (`existingPublicId`, user-context delta/provenance, event-vs-deadline consistency). Those are general contracts.

One recurrence fix is too narrow: the validator currently recognizes only literal canonical periods `daily`, `weekdays`, and `weekends`. The schema supports `daily`, `weekly`, `weekdays`, `weekends`, `times_per_week`, and `custom`. This should be generalized to the semantic recurrence enum/canonical custom form rather than preserving a three-case map introduced for one observed failure.

The production prompt must describe the recurrence invariant generically, not only the observed `毎日2時間` case.

### 7. Testing / observability

Required tests before accepting the fix:

1. Original conversation structure: broad school-work task + another goal -> breakdown question comes before total effort.
2. Same semantic structure with different wording/domain, with no production prompt changes between cases.
3. A concrete single task must not be forced through decomposition.
4. A later decomposition answer resolves the exact uncertainty and retains previously accepted facts.
5. Recurrence consistency covers at least one non-`daily/weekdays/weekends` supported recurrence form.
6. Renderer output is evaluated from the actual transcript, not only `actionKind`/workflow green status.

## Non-goals

- Do not hardcode school subjects or homework labels.
- Do not infer child work items in deterministic code.
- Do not relax grounding or exact-ID validation.
- Do not make every task require decomposition.
- Do not fix only the observed Japanese sentences.
