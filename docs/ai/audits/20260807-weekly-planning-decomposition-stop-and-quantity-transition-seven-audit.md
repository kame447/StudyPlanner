# Decomposition stop / quantity transition seven-view audit

Date: 2026-08-07

## Observed conversation

After the broad-task breakdown was successfully resolved:

- accepted parent task remained one exact task;
- concrete components `数学のワーク` and `古典の課題` were attached to it;
- old `work_breakdown` uncertainty was removed.

The app nevertheless replied:

`まずは数学のワークの中身を、どんな内容に分かれているか教えてください。`

This asks for another decomposition although no `work_breakdown` uncertainty exists. The scheduler state only lacks schedulable quantity/workload.

## Seven views

1. Conversation: once concrete work items are known, repeatedly asking “what is inside this?” is burdensome and unnatural. The next answerable question should normally be amount/range for one concrete item.
2. Semantic state: only an active `work_breakdown` uncertainty authorizes another decomposition question. Absence of that uncertainty means the semantic layer has not declared breakdown as the blocker.
3. Scheduler state: `missing_schedulable_work` means no schedulable amount/range exists. It must not be reinterpreted by the renderer as “decompose further”.
4. Targeting: if active components exist without workload, select one concrete component and ask its amount/range. If no components exist, ask one atomic task. Do not ask all items at once.
5. Renderer: `work_breakdown` and `missing_schedulable_work` are distinct intents. Renderer may phrase them naturally but may not change one into the other.
6. Regression/generalization: no labels such as homework, workbook, subject names, or study-specific keywords are used in deterministic selection. The boundary is graph structure + question code only.
7. Testing: verify a decomposed task with two components asks quantity/range for one component; a task with active `work_breakdown` still asks breakdown; multiple items are handled one at a time; actual real-API transcript must not ask another decomposition after the uncertainty is resolved.

## Generalized fix

- Change `missingSchedulableWorkQuestion` to inspect the active graph.
- Prefer the first active component with no workload and ask `「label」は、どこまで進めたいですか？ページ数・問題数・範囲など、分かる形で教えてください。` as deterministic intent.
- If no such component exists, ask one task rather than all tasks.
- Renderer prompt explicitly states: only `work_breakdown` may ask for further decomposition; `missing_schedulable_work` asks amount/range for one existing work item.
- Keep `work_breakdown` priority above scheduler issues.
