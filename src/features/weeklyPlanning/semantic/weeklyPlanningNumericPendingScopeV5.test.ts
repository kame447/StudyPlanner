import { describe, expect, it, vi } from 'vitest';
import { numericPendingCompleteScopeV5 } from './weeklyPlanningNumericPendingScopeV5';
import { numericFixture, normalizedChoice } from './weeklyPlanningNumericPendingChoiceV5.testUtils';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from './weeklyPlanningSemanticPublicStateV5';
import { tryNumericPendingChoiceRouteV5 } from './weeklyPlanningNumericPendingChoiceV5';
import { prepareNumericPendingCommitV5 } from './weeklyPlanningNumericPendingCommitV5';
import { createSelectionLedger } from '../application/candidateSelection';
import { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';

function fixture(depth = 2) {
  const h = numericFixture(); const pending = h.input.publicStateSummary!.pendingQuestion;
  for (let index = 0; index < depth; index++) h.graph.components.push({
    id: `component-${index}`, taskId: 'task-1', parentComponentId: index ? `component-${index - 1}` : null,
    role: index === 0 ? 'material' : 'chapter', label: index === 0 ? '山地の教材' : `章${index}`,
    source: h.graph.tasks[0].source, createdRevision: 2,
  });
  Object.assign(h.graph.workloads[0], { componentId: depth ? `component-${depth - 1}` : null });
  h.graph.factLifecycles.push(...h.graph.components.map(fact => ({ factId: fact.id, status: 'active' as const,
    createdRevision: 2, terminalRevision: null, supersededByFactId: null })));
  const refresh = () => { h.input.publicStateSummary = createWeeklyPlanningSemanticPublicStateSummaryV5({ pendingQuestion: pending }, h.graph); };
  refresh();
  const scope = numericPendingCompleteScopeV5(h.input);
  if (scope) h.setState({ ...h.state, binding: { ...h.state.binding, scope } });
  return { ...h, get state() { return h.state; }, refresh };
}
describe('D5 complete scope and ancestry', () => {
  it('keeps root-to-target role/label and unit labels, with empty task-bound control', () => {
    expect(numericPendingCompleteScopeV5(fixture().input)).toMatchObject({ unitLabel: '問', task: { title: '数学' },
      componentChain: [{ role: 'material', label: '山地の教材' }, { role: 'chapter', label: '章1' }] });
    expect(numericPendingCompleteScopeV5(fixture(0).input)?.componentChain).toEqual([]);
    expect(numericPendingCompleteScopeV5(fixture(8).input)?.componentChain).toHaveLength(8);
    expect(numericPendingCompleteScopeV5(fixture(9).input)).toBeNull();
  });
  it.each(['parent', 'grandparent', 'role', 'unit label'] as const)('distinguishes %s at the actual Choice request', async axis => {
    const h = fixture(3); const requests: unknown[] = [];
    h.port.choose = async (request, before) => { before(); requests.push(structuredClone(request)); return normalizedChoice(request, 'leaf:2'); };
    expect(await tryNumericPendingChoiceRouteV5(new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion: async () => '' }, h.input), h.port)).not.toBeNull();
    if (axis === 'parent') h.graph.components[1].label = '別の章';
    if (axis === 'grandparent') h.graph.components[0].label = '海辺の教材';
    if (axis === 'role') h.graph.components[0].role = 'topic';
    if (axis === 'unit label') h.graph.workloads[0].unitLabel = '問題';
    h.refresh(); h.setState({ ...h.state, binding: { ...h.state.binding, scope: numericPendingCompleteScopeV5(h.input)! } });
    expect(await tryNumericPendingChoiceRouteV5(new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion: async () => '' }, h.input), h.port)).not.toBeNull();
    expect(requests).toHaveLength(2); expect(requests[0]).not.toEqual(requests[1]);
    expect(JSON.stringify(requests[1])).not.toContain('sourceText');
  });
  it('rejects a parent change after selection without graph effect or consumption', async () => {
    const h = fixture();
    const staged = await tryNumericPendingChoiceRouteV5(new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion: async () => '' }, h.input), h.port);
    expect(staged).not.toBeNull(); h.graph.components[0].label = '海辺の教材'; h.refresh();
    const ledger = createSelectionLedger('owner-1', 'conversation-numeric');
    const plan = prepareNumericPendingCommitV5(staged!, { input: h.input, state: h.state, domainMinutes: h.port.domainMinutes,
      domainPolicyVersion: h.port.domainPolicyVersion, ledger, turnId: 'answer' });
    expect(plan.status).toBe('rejected'); expect(ledger.consumed).toEqual([]); expect(h.graph.effortEstimates).toEqual([]);
  });
  it('rechecks ancestry before the authenticated dispatch boundary', async () => {
    const h = fixture(); const sends = vi.fn();
    h.port.choose = async (request, before) => { h.graph.components[0].label = '海辺の教材'; h.refresh(); before(); sends(); return normalizedChoice(request, 'leaf:2'); };
    expect(await tryNumericPendingChoiceRouteV5(new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion: async () => '' }, h.input), h.port)).toBeNull();
    expect(sends).not.toHaveBeenCalled();
  });
  it.each(['missing', 'foreign', 'inactive', 'oversize', 'cycle'] as const)('never truncates an unsupported %s ancestor', fault => {
    const h = fixture();
    if (fault === 'missing') h.graph.components.shift();
    if (fault === 'foreign') h.graph.components[0].taskId = 'other-task';
    if (fault === 'inactive') Object.assign(h.graph.factLifecycles.find(fact => fact.factId === 'component-0')!, { status: 'removed', terminalRevision: 2 });
    if (fault === 'oversize') h.graph.components[0].label = 'あ'.repeat(171);
    if (fault === 'cycle') h.graph.components[0].parentComponentId = 'component-1';
    h.refresh(); expect(numericPendingCompleteScopeV5(h.input)).toBeNull();
  });
});
