import { createEmptyWeeklyPlanningFactGraphV5, type EffortEstimateFactV5, type WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';

export function workloadLifecycleFixture(options: { correction?: boolean; effortKind?: EffortEstimateFactV5['kind'] } = {}): WeeklyPlanningFactGraphV5 {
  const source = { conversationId: 'lifecycle-synthetic', turnId: 'one', semanticLocalId: 'work', sourceText: 'synthetic', origin: 'user' as const };
  const original = { id: 'work', taskId: 'task', componentId: null, quantityRole: 'unknown' as const, amount: 20, unitCode: 'problem' as const, unitLabel: '問',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source, createdRevision: 1 };
  const graph: WeeklyPlanningFactGraphV5 = { ...createEmptyWeeklyPlanningFactGraphV5(), revision: options.correction ? 2 : 1,
    tasks: [{ id: 'task', category: 'study', title: 'synthetic', source, createdRevision: 1 }],
    workloads: [original, ...(options.correction ? [{ ...original, id: 'replacement', quantityRole: 'target' as const, createdRevision: 2 }] : [])],
    effortEstimates: [{ id: 'pace', taskId: 'task', targetFactId: 'work', kind: options.effortKind ?? 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'approximate', source, createdRevision: 1 }],
    correctionIntents: options.correction ? [{ id: 'correction', target: { kind: 'workload', factId: 'work', publicId: 'work', mention: null }, operation: 'replace', replacementFactId: 'replacement', source, createdRevision: 2 }] : [],
  };
  graph.factLifecycles = [...graph.tasks, ...graph.workloads, ...graph.effortEstimates, ...graph.correctionIntents].map(fact => ({ factId: fact.id, status: 'active', createdRevision: fact.createdRevision, terminalRevision: null, supersededByFactId: null }));
  return graph;
}
