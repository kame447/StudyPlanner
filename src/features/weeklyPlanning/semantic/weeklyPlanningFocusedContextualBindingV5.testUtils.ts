import { createFocusedContextualBindingSnapshotV5 } from './weeklyPlanningFocusedContextualBindingV5';
import type { BoundFocusedContextualDecisionContext } from '../../../../shared/focusedContextualDecision';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from './weeklyPlanningSemanticPublicStateV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from './weeklyPlanningSemanticNormalizerContractsV5';

export function createFocusedContextualBindingGraphFixtureV5(): WeeklyPlanningFactGraphV5 {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.revision = 8;
  const source = { conversationId: 'j1-fixture-conversation', turnId: 'j1-fixture-turn',
    semanticLocalId: 'j1-fixture', sourceText: 'fixture-private-provenance', origin: 'user' as const };
  graph.tasks.push({ id: 'task-private-id', category: 'study', title: '数学', source, createdRevision: 8 });
  graph.components.push(
    { id: 'material-private-id', taskId: 'task-private-id', parentComponentId: null, role: 'material', label: '青チャート', source, createdRevision: 8 },
    { id: 'chapter-private-id', taskId: 'task-private-id', parentComponentId: 'material-private-id', role: 'chapter', label: '第1章', source, createdRevision: 8 },
  );
  graph.workloads.push({ id: 'workload-private-id', taskId: 'task-private-id', componentId: 'chapter-private-id',
    quantityRole: 'declared', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null, source, createdRevision: 8 });
  graph.factLifecycles = [...graph.tasks, ...graph.components, ...graph.workloads]
    .map(fact => ({ factId: fact.id, status: 'active' as const, createdRevision: 8, terminalRevision: null, supersededByFactId: null }));
  return graph;
}

export function createFocusedContextualBindingInputFixtureV5(
  graph: WeeklyPlanningFactGraphV5 = createFocusedContextualBindingGraphFixtureV5(),
  userText = 'その20問は残りです。',
): WeeklyPlanningSemanticNormalizerInputV5 {
  const validation = validateWeeklyPlanningFactGraphValueV5(graph);
  if (!validation.graph) throw new Error(`Invalid J1 fixture: ${validation.errors.join(',')}`);
  return {
    userText, traceRequestId: 'j1-current-turn', committedGraph: validation.graph,
    publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5({
      pendingQuestion: { questionCode: 'quantity_role_unresolved', targetFactId: graph.workloads[0].id,
        graphRevision: graph.revision, actionId: 'j1-question-8' },
    }, validation.graph),
  };
}

/** Valid bound context for existing isolated provider/dispatch fault tests. */
export function createBoundFocusedContextualContextFixtureV5(options: {
  requestId?: string; inputRevision?: number; currentUserText?: string;
} = {}): BoundFocusedContextualDecisionContext {
  const context = structuredClone(createFocusedContextualBindingSnapshotV5(createFocusedContextualBindingInputFixtureV5())!.context);
  context.requestId = options.requestId ?? 'fixture-contextual';
  context.inputRevision = options.inputRevision ?? 7;
  context.state.pendingQuestion.target.sourceRevision = context.inputRevision;
  context.state.currentUserText = options.currentUserText ?? 'private-input';
  return context;
}

export function focusedContextualSourceMessagesFixtureV5(context: unknown, fallbackText: string) {
  const value = context as BoundFocusedContextualDecisionContext | undefined;
  return [{ role: 'user' as const, content: value?.purpose === 'focused_contextual_answer_v2'
    ? JSON.stringify({ currentUserText: value.state.currentUserText, pendingQuestion: {
        questionCode: value.questionCode, questionTargetWorkload: value.state.pendingQuestion.target.workload,
      } }) : fallbackText }];
}
