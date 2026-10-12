import { createEmptyWeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../../semantic/weeklyPlanningSemanticDocumentV5';

export const materialIdentitySource = { conversationId: 'c', turnId: 'initial', semanticLocalId: 'm', sourceText: '数学の問題集を20問進めたい。夜がいい', origin: 'user' as const };
export function materialIdentityState(hasNeed = true) {
  const graph = createEmptyWeeklyPlanningFactGraphV5(); graph.revision = 1;
  graph.tasks = [{ id: 't', category: 'study', title: '数学の問題集を進める', createdRevision: 1, source: materialIdentitySource }];
  graph.components = [{ id: 'm', taskId: 't', parentComponentId: null, role: 'material', label: '数学の問題集', createdRevision: 1, source: materialIdentitySource }];
  graph.workloads = [{ id: 'w', taskId: 't', componentId: 'm', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, createdRevision: 1, source: materialIdentitySource }];
  graph.effortEstimates = [{ id: 'pace', taskId: 't', targetFactId: 'w', kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'approximate', createdRevision: 1, source: materialIdentitySource }];
  graph.temporalConstraints = [{ id: 'preference', taskId: 't', targetFactId: 'm', kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'unspecified', createdRevision: 1, source: materialIdentitySource }];
  graph.uncertainties = [ ...(hasNeed ? [{ id: 'u', targetFactId: 'm', field: 'material_identity', reason: '対象教材が未確定', createdRevision: 1, source: materialIdentitySource }] : []), { id: 'other', targetFactId: 'm', field: 'unrelated', reason: '別の確認', createdRevision: 1, source: materialIdentitySource } ];
  graph.factLifecycles = ['t', 'm', 'w', 'pace', 'preference', ...(hasNeed ? ['u'] : []), 'other'].map((factId) => ({ factId, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
  return graph;
}
export const MATERIAL_IDENTITY_TEXT = '教材は青チャート 数学IIIに訂正します';
export function materialIdentityDocument(shape: 'relabel' | 'reference' | 'addition' | 'modify' | 'replace_new' | 'remove' = 'modify'): WeeklyPlanningSemanticDocumentV5 {
  const ownText = shape === 'reference' ? '同じ数学の問題集のことです' : shape === 'relabel' ? '青チャートのこと' : shape === 'addition' ? '同じ数学の計画に青チャート 数学IIIも追加したい' : MATERIAL_IDENTITY_TEXT;
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [{ localId: 'task', existingPublicId: 't', category: 'study', title: '数学の問題集を進める', decompositionStatus: 'atomic',
      study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [{ localId: 'material', existingPublicId: shape === 'replace_new' || shape === 'addition' ? null : 'm', parentLocalId: null, role: 'material', label: shape === 'reference' ? '数学の問題集' : '青チャート 数学III', workloads: [], durableContextSignals: [], sourceText: ownText }] },
      workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: ownText }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
    corrections: shape === 'modify' || shape === 'replace_new' || shape === 'remove' ? [{ localId: 'correction', target: { kind: 'component', publicId: 'm', localId: null, mention: '数学の問題集' }, operation: shape === 'replace_new' ? 'replace' : shape, replacementLocalId: shape === 'remove' ? null : 'material', sourceText: ownText }] : [], decisions: [], conversationActs: [] };
}
