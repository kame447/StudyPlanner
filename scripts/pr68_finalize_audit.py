from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'pattern not found in {path}: {old[:180]!r}')
    target.write_text(text.replace(old, new, 1))


replace_once(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningAdversarialInput.test.ts',
    "        source: { kind: 'existing_plans' },\n",
    "        source: { kind: 'existing_plans', selector: 'active' },\n",
)

renderer = Path('src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts')
text = renderer.read_text()
anchor = """export function createDialogueRenderInput(params: {
"""
helper = """function priorityPolicyChanged(
  current: PlanningIntakeState['priorityPolicy'],
  previous: PlanningIntakeState['priorityPolicy'] | undefined,
): boolean {
  if (!previous || current.kind !== previous.kind) return true;
  if (current.kind !== 'field_first' || previous.kind !== 'field_first') return false;
  return current.order.length !== previous.order.length
    || current.order.some((field, index) => field !== previous.order[index]);
}

"""
if anchor not in text:
    raise RuntimeError('renderer helper insertion point was not found')
text = text.replace(anchor, helper + anchor, 1)
old = "      priorityOrder: useTurnDelta ? undefined : priorityOrder,\n"
new = "      priorityOrder: priorityPolicyChanged(params.state.priorityPolicy, params.previousState?.priorityPolicy)\n        ? priorityOrder\n        : undefined,\n"
if old not in text:
    raise RuntimeError('renderer priority assignment was not found')
renderer.write_text(text.replace(old, new, 1))

test_path = Path('src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.test.ts')
text = test_path.read_text()
anchor = """  it('includes command-derived goal titles in deterministic accepted facts', async () => {
"""
addition = """  it('acknowledges a priority accepted in the current turn but not an unchanged prior priority', () => {
    const previousState: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      sourceTurns: ['院試の過去問はOSです'],
    };
    const state: PlanningIntakeState = {
      ...previousState,
      priorityPolicy: { kind: 'field_first', order: ['OS'] },
      sourceTurns: [...previousState.sourceTurns, 'OSを優先します'],
    };

    const accepted = createDialogueRenderInput({
      state,
      previousState,
      decision: askScopeDecision(),
    });
    expect(accepted.acceptedFacts.priorityOrder).toEqual(['OS']);

    const nextState: PlanningIntakeState = {
      ...state,
      sourceTurns: [...state.sourceTurns, '固定予定はありません'],
    };
    const unchanged = createDialogueRenderInput({
      state: nextState,
      previousState: state,
      decision: askScopeDecision(),
    });
    expect(unchanged.acceptedFacts.priorityOrder).toBeUndefined();
  });

"""
if anchor not in text:
    raise RuntimeError('renderer test insertion point was not found')
test_path.write_text(text.replace(anchor, addition + anchor, 1))
