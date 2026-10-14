import { expect, it } from 'vitest';
import { c5Graph } from './controller.testUtils';
import { narrowC5EffortBasis } from './basis';
import { validateWeeklyPlanningFactGraphValueV5 } from '../../semantic/weeklyPlanningFactGraphValidatorV5';

function graphWithChain(depth = 2) {
  const graph = c5Graph('ancestor-fixture');
  graph.components = Array.from({ length: depth }, (_, index) => ({
    id: `component-${index}`, taskId: 'task-a', parentComponentId: index ? `component-${index - 1}` : null,
    role: index ? 'chapter' as const : 'material' as const,
    label: index ? `図版${index}` : '海辺の観察帳', source: graph.tasks[0].source, createdRevision: 1,
  }));
  graph.workloads[0].componentId = depth ? `component-${depth - 1}` : null;
  graph.factLifecycles.push(...graph.components.map(fact => ({ factId: fact.id, status: 'active' as const,
    createdRevision: 1, terminalRevision: null, supersededByFactId: null })));
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toEqual([]);
  return graph;
}

it('distinguishes parent material meaning and projects the complete root-to-target labels without private sources', () => {
  const sea = graphWithChain(3); const mountain = structuredClone(sea);
  mountain.components[0].label = '山地の観察帳';
  expect(validateWeeklyPlanningFactGraphValueV5(mountain).errors).toEqual([]);
  const a = narrowC5EffortBasis(sea, 'work-a')!; const b = narrowC5EffortBasis(mountain, 'work-a')!;
  expect(a).not.toBeNull(); expect(b).not.toBeNull(); expect(a).not.toEqual(b);
  expect(a.scope.componentChain).toEqual(sea.components.map(({ role, label }) => ({ role, label })));
  expect(a.sources.map(source => source.id)).toEqual(expect.arrayContaining(sea.components.map(component => component.id)));
  expect(JSON.stringify(a.scope)).not.toContain('private-source-');
});
it('keeps task-bound and depth-eight components eligible, rejects depth-nine instead of truncating', () => {
  expect(narrowC5EffortBasis(graphWithChain(0), 'work-a')?.scope.componentChain).toEqual([]);
  expect(narrowC5EffortBasis(graphWithChain(8), 'work-a')).not.toBeNull();
  expect(narrowC5EffortBasis(graphWithChain(9), 'work-a')).toBeNull();
});
it('keeps exactly 512 UTF8 bytes intact and rejects overflow without slicing', () => {
  const graph = graphWithChain(); graph.components[0].label = '海'.repeat(170) + 'AB';
  expect(narrowC5EffortBasis(graph, 'work-a')).not.toBeNull();
  graph.components[0].label += 'C'; expect(narrowC5EffortBasis(graph, 'work-a')).toBeNull();
});
it.each(['missing', 'cycle', 'foreign', 'inactive'] as const)('rejects an incomplete %s ancestor chain', kind => {
  const graph = graphWithChain();
  if (kind === 'missing') graph.components[1].parentComponentId = 'missing';
  if (kind === 'cycle') graph.components[0].parentComponentId = graph.components[1].id;
  if (kind === 'foreign') graph.components[0].taskId = 'task-b';
  if (kind === 'inactive') Object.assign(graph.factLifecycles.find(fact => fact.factId === graph.components[0].id)!,
    { status: 'retracted', terminalRevision: 3 });
  expect(narrowC5EffortBasis(graph, 'work-a')).toBeNull();
});
it('binds ancestor role, link, source and created revision changes', () => {
  const graph = graphWithChain(3); const before = narrowC5EffortBasis(graph, 'work-a');
  for (const change of ['role', 'link', 'source', 'revision'] as const) {
    const next = structuredClone(graph);
    if (change === 'role') next.components[0].role = 'chapter';
    if (change === 'link') next.components[2].parentComponentId = next.components[0].id;
    if (change === 'source') next.components[0].source.sourceText = 'new private source';
    if (change === 'revision') next.components[0].createdRevision = 2;
    expect(validateWeeklyPlanningFactGraphValueV5(next).errors).toEqual([]);
    const after = narrowC5EffortBasis(next, 'work-a');
    expect(after).not.toBeNull(); expect(after).not.toEqual(before);
  }
});
