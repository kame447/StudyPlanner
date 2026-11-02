// Only adapts typed, accepted meaning to V5's proposal policy. Records stay in the
// one VNext state and are updated by the transaction; no V5 intake state is persisted.
// Tests: LearningStrategy positive/negative decisions, duration gate and supersession.
import {
  createInitialPlanningIntakeState,
  evaluateWeeklyPlanningLearningStrategyProposalsV5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningVNextV5Boundary';
import type { VNextProposalDecision, WeeklyPlanningVNextProjection, WeeklyPlanningVNextState } from './weeklyPlanningVNextTypes';
import { createVNextLineageResolver, withCurrentVNextReferences } from './weeklyPlanningVNextWorkIdentity';

export function evaluateVNextLearningStrategy(params: {
  state: WeeklyPlanningVNextState;
  projection: Pick<WeeklyPlanningVNextProjection, 'owners'>;
  turnId: string;
  decision?: VNextProposalDecision;
}) {
  const resolver = createVNextLineageResolver(params.state.graph);
  const graph = withCurrentVNextReferences(params.state.graph, id => resolver.leafOf(id) ?? id);
  const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
  const contexts = graph.studyContexts.filter(fact => active.has(fact.id));
  const workloads = graph.workloads.filter(fact => active.has(fact.id));
  const changedTasks = new Set([...contexts, ...workloads].filter(fact => fact.createdRevision === graph.revision).map(fact => fact.taskId));
  const document: WeeklyPlanningSemanticDocumentV5 = {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss', planningWindow: null,
    tasks: graph.tasks.filter(task => active.has(task.id) && changedTasks.has(task.id)).flatMap(task => {
      const study = contexts.find(fact => fact.taskId === task.id);
      if (!study) return [];
      return [{ localId: task.id, category: task.category, title: task.title,
        study: { purpose: study.purpose, contextLabel: study.contextLabel, activityKind: study.activityKind, components: [] },
        workloads: workloads.filter(fact => fact.taskId === task.id).map(fact => ({ localId: fact.id,
          quantityRole: fact.quantityRole, amount: fact.amount, unitCode: fact.unitCode, unitLabel: fact.unitLabel,
          rangeStart: fact.rangeStart, rangeEnd: fact.rangeEnd, perOccurrence: fact.perOccurrence,
          periodExpression: fact.periodExpression, sourceText: fact.source.sourceText })),
        effortEstimates: [], temporalConstraints: [], recurrence: [], sourceText: task.source.sourceText }];
    }),
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [],
    decisions: params.decision ? [{ localId: 'proposal_answer', target: { kind: 'proposal', publicId: params.decision.proposalId,
      localId: null, mention: null }, decision: params.decision.decision, sourceText: 'bound presented proposal answer' }] : [],
  };
  const identities = [...graph.tasks, ...graph.workloads].map(fact => [fact.id, fact.id]);
  return evaluateWeeklyPlanningLearningStrategyProposalsV5({
    previousState: { ...createInitialPlanningIntakeState(), learningStrategyProposalRecords: params.state.learningStrategyProposalRecords },
    document, localToFactId: Object.fromEntries(identities),
    compilation: { status: 'needs_resolution', input: null,
      issues: params.projection.owners.flatMap(owner => owner.question?.code === 'missing_effort_estimate' && owner.question.forWork
        ? [{ domain: 'work_item' as const, code: 'missing_effort_estimate', blocking: true, factId: owner.question.forWork.definingFactId }] : []) },
    effortEstimates: graph.effortEstimates.filter(fact => active.has(fact.id)),
    workloadSupersessions: Object.fromEntries(graph.factLifecycles.flatMap(entry => entry.supersededByFactId ? [[entry.factId, entry.supersededByFactId]] : [])),
    graphRevision: graph.revision, turnId: params.turnId, presentedProposalId: params.decision?.proposalId ?? null,
  });
}
