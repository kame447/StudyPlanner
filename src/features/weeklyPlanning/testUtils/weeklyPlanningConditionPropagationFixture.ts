import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';

export const CONDITION_SETUP = '来週、アルゴリズムイントロダクションを20ページ読むのと、卒業研究ノートを2時間進めたい';
export const CONDITION_PACE = '1ページ3分くらい';
export const CONDITION_FOLLOWUP = '1回1時間くらいで2回に分けたい。どっちも夜がいい';

export function conditionDocument(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...overrides,
  };
}

export function conditionSetupDocument() {
  return conditionDocument({
    planningIntent: 'create_plan',
    planningWindow: { localId: 'week', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' },
    tasks: [
      { id: 'book', title: 'アルゴリズムイントロダクション', amount: 20, unitCode: 'page', unitLabel: 'ページ', activityKind: 'reading', purpose: 'self_study', sourceText: 'アルゴリズムイントロダクションを20ページ読む' },
      { id: 'research', title: '卒業研究ノート', amount: 2, unitCode: 'hour', unitLabel: '時間', activityKind: 'writing', purpose: 'research', sourceText: '卒業研究ノートを2時間進めたい' },
    ].map((task) => ({
      localId: task.id, existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: task.title,
      study: { purpose: task.purpose, activityKind: task.activityKind, contextLabel: null, components: [] },
      workloads: [{
        localId: `${task.id}-amount`, quantityRole: 'target', amount: task.amount, unitCode: task.unitCode,
        unitLabel: task.unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        sourceText: task.sourceText,
      }],
      effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: task.sourceText,
    })),
  });
}

/** Semantic interpretation of the follow-up; no replay of the two accepted workloads. */
export function conditionFollowupDocument(graph: WeeklyPlanningFactGraphV5) {
  return conditionDocument({
    planningIntent: 'update_plan',
    tasks: graph.tasks.map((task, index) => ({
      localId: `existing-${index}`, existingPublicId: task.id, decompositionStatus: 'atomic', category: 'study',
      title: task.title, study: null, workloads: [],
      effortEstimates: task.title === '卒業研究ノート' ? [{
        localId: 'session-size', targetLocalId: `existing-${index}`, kind: 'session_duration', minutes: 60,
        unitCode: 'session', precision: 'approximate', sourceText: '1回1時間くらいで2回に分けたい',
      }] : [],
      temporalConstraints: [{
        localId: `night-${index}`, targetLocalId: `existing-${index}`, kind: 'preferred_window', constraintLevel: 'soft',
        dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null, precision: 'approximate',
        sourceText: 'どっちも夜がいい',
      }],
      recurrence: [], durableContextSignals: [], sourceText: CONDITION_FOLLOWUP,
    })),
  });
}
