import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { focusedContextualDecisionState } from '../../../../shared/focusedContextualDecision';
import { createFocusedContextualBindingSnapshotV5, isFocusedContextualBindingCurrentV5 } from './weeklyPlanningFocusedContextualBindingV5';
import { createFocusedContextualBindingGraphFixtureV5, createFocusedContextualBindingInputFixtureV5 } from './weeklyPlanningFocusedContextualBindingV5.testUtils';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import { tryFocusedContextualAnswerRouteV5 } from './weeklyPlanningSemanticFocusedPreRoutesV5';

export const J1_BINDING_PAIRS: Array<[string, (graph: WeeklyPlanningFactGraphV5) => void]> = [
  ['amount', graph => { graph.workloads[0].amount = 30; }],
  ['unit', graph => { graph.workloads[0].unitCode = 'page'; graph.workloads[0].unitLabel = 'ページ'; }],
  ['custom label', graph => { graph.workloads[0].unitCode = 'custom'; graph.workloads[0].unitLabel = '冊'; }],
  ['task', graph => { graph.tasks[0].title = '物理'; }],
  ['component target', graph => { graph.components[1].label = '第2章'; }],
  ['parent', graph => { graph.components[0].label = '赤チャート'; }],
  ['range', graph => { graph.workloads[0].rangeStart = '21'; graph.workloads[0].rangeEnd = '40'; }],
  ['opaque range', graph => { graph.workloads[0].rangeStart = 'A'; graph.workloads[0].rangeEnd = 'K'; }],
  ['role', graph => { graph.workloads[0].quantityRole = 'unknown'; }],
  ['period', graph => { graph.workloads[0].perOccurrence = true; graph.workloads[0].periodExpression = '毎日'; }],
];

describe('J1 typed graph to bound contextual input', () => {
  it('derives the complete parent chain and excludes formal IDs/provenance', () => {
    const input = createFocusedContextualBindingInputFixtureV5();
    const snapshot = createFocusedContextualBindingSnapshotV5(input)!;
    expect(snapshot.context).toMatchObject({ purpose: 'focused_contextual_answer_v2', inputRevision: 8,
      state: { pendingQuestion: { target: { task: { category: 'study', title: '数学' },
        componentChain: [{ role: 'material', label: '青チャート' }, { role: 'chapter', label: '第1章' }],
        workload: { quantityRole: 'declared', amount: 20, unitCode: 'problem', unitLabel: '問' } } } } });
    expect(JSON.stringify(snapshot.context)).not.toContain('private-id');
    expect(JSON.stringify(snapshot.context)).not.toContain('fixture-private-provenance');
    expect(snapshot.localBinding).toContain('workload-private-id');
    expect(isFocusedContextualBindingCurrentV5(snapshot, input)).toBe(true);
  });
  it.each(J1_BINDING_PAIRS)('retains %s in the actual provider state projection', (_axis, change) => {
    const first = createFocusedContextualBindingInputFixtureV5();
    const graph = createFocusedContextualBindingGraphFixtureV5();
    change(graph);
    const second = createFocusedContextualBindingInputFixtureV5(graph);
    const a = createFocusedContextualBindingSnapshotV5(first)!;
    const b = createFocusedContextualBindingSnapshotV5(second)!;
    expect(b).not.toBeNull();
    expect(first.userText).toBe(second.userText);
    expect(focusedContextualDecisionState(a.context)).not.toEqual(focusedContextualDecisionState(b.context));
  });
  it('distinguishes a custom unit label without changing its unit code', () => {
    const graph = createFocusedContextualBindingGraphFixtureV5(); graph.workloads[0].unitCode = 'custom';
    const a = createFocusedContextualBindingSnapshotV5(createFocusedContextualBindingInputFixtureV5(graph))!;
    graph.workloads[0].unitLabel = 'セット';
    const b = createFocusedContextualBindingSnapshotV5(createFocusedContextualBindingInputFixtureV5(graph))!;
    expect(a.context.state.pendingQuestion.target.workload.unitCode).toBe(b.context.state.pendingQuestion.target.workload.unitCode);
    expect(focusedContextualDecisionState(a.context)).not.toEqual(focusedContextualDecisionState(b.context));
  });
  it.each(['stale', 'missing', 'foreign', 'cycle', 'duplicate', 'canonical mismatch', 'inactive', 'duplicate lifecycle'])(
    'does not create Jev context from %s refs', fault => {
      const input = createFocusedContextualBindingInputFixtureV5();
      const summary = input.publicStateSummary!;
      const components = summary.components as Array<Record<string, unknown>>;
      if (fault === 'stale') summary.graphRevision = 9;
      if (fault === 'missing') components.pop();
      if (fault === 'foreign') components[0].taskPublicId = 'other-task';
      if (fault === 'cycle') components[0].parentComponentPublicId = components[1].publicId;
      if (fault === 'duplicate') components.push({ ...components[0] });
      if (fault === 'canonical mismatch') input.committedGraph!.workloads[0].amount = 99;
      if (fault === 'duplicate lifecycle') input.committedGraph!.factLifecycles.push({ ...input.committedGraph!.factLifecycles[0] });
      if (fault === 'inactive') input.committedGraph!.factLifecycles[0].status = 'removed';
      expect(createFocusedContextualBindingSnapshotV5(input)).toBeNull();
    },
  );
  it('keeps equivalent local-ID renaming out of semantic payload but detects late reference changes', () => {
    const input = createFocusedContextualBindingInputFixtureV5();
    const first = createFocusedContextualBindingSnapshotV5(input)!;
    const graph = structuredClone(input.committedGraph!);
    const old = graph.workloads[0].id; graph.workloads[0].id = 'renamed-workload';
    graph.factLifecycles.find(entry => entry.factId === old)!.factId = 'renamed-workload';
    const renamed = createFocusedContextualBindingInputFixtureV5(graph);
    const second = createFocusedContextualBindingSnapshotV5(renamed)!;
    expect(focusedContextualDecisionState(first.context)).toEqual(focusedContextualDecisionState(second.context));
    expect(isFocusedContextualBindingCurrentV5(first, renamed)).toBe(false);
  });
  it('sends complete parent/material context to focused Luna for the same pending answer', async () => {
    const capture = async (parentLabel: string) => {
      const graph = createFocusedContextualBindingGraphFixtureV5();
      graph.components[0].label = parentLabel;
      const input = createFocusedContextualBindingInputFixtureV5(graph);
      const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn(async () => JSON.stringify({
        decision: 'fallback', effortTarget: null, effortMeasurement: null,
        minutes: null, precision: null, quantityRole: null,
      })) };
      const result = await tryFocusedContextualAnswerRouteV5(new WeeklyPlanningSemanticNormalizerRunV5(client, input));
      expect(result).toBeNull();
      expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
      const request = vi.mocked(client.createChatCompletion).mock.calls[0][0];
      const message = request.messages.find(item => item.role === 'user');
      expect(message).toBeDefined();
      return JSON.parse(String(message!.content)).pendingQuestion.boundTarget;
    };
    const blue = await capture('青チャート');
    const red = await capture('赤チャート');
    expect(blue.componentChain).toEqual([
      { role: 'material', label: '青チャート' },
      { role: 'chapter', label: '第1章' },
    ]);
    expect(red.componentChain[0].label).toBe('赤チャート');
    expect(red).not.toEqual(blue);
    expect(blue.workload).toMatchObject({ quantityRole: 'declared', amount: 20, unitCode: 'problem' });
    expect(JSON.stringify(blue)).not.toContain('private-id');
    expect(JSON.stringify(blue)).not.toContain('fixture-private-provenance');
  });

  it('does not send incomplete pending-target context to focused Luna', async () => {
    const input = createFocusedContextualBindingInputFixtureV5();
    (input.publicStateSummary!.components as unknown[]).shift();
    const client = { createChatCompletion: vi.fn(async () => '{}') };
    const result = await tryFocusedContextualAnswerRouteV5(new WeeklyPlanningSemanticNormalizerRunV5(client, input));
    expect(result).toBeNull();
    expect(client.createChatCompletion).not.toHaveBeenCalled();
  });

  it.each(['revision', 'presentation', 'target value'])('rejects a role reply after late %s drift', async fault => {
    const input = createFocusedContextualBindingInputFixtureV5();
    const client = { createChatCompletion: vi.fn(async () => {
      if (fault === 'revision') input.publicStateSummary!.graphRevision = 9;
      if (fault === 'presentation') (input.publicStateSummary!.pendingQuestion as Record<string, unknown>).actionId = 're-presented-question';
      if (fault === 'target value') input.committedGraph!.workloads[0].amount = 99;
      return JSON.stringify({ decision: 'quantity_role_answer', effortTarget: null, effortMeasurement: null,
        minutes: null, precision: null, quantityRole: 'remaining' });
    }) };
    const result = await tryFocusedContextualAnswerRouteV5(new WeeklyPlanningSemanticNormalizerRunV5(client, input));
    expect(result).toMatchObject({ status: 'rejected', document: null,
      diagnostics: { validationErrors: ['focused-contextual:stale-binding'] } });
    expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(input.committedGraph!.workloads[0].quantityRole).toBe('declared');
  });
});
