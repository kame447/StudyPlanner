import { describe, expect, it } from 'vitest';
import { validateWeeklyPlanningDuplicateFactsV5 } from './weeklyPlanningDuplicateFactValidationV5';
import { createWeeklyPlanningSemanticRepairMessagesV5 } from './weeklyPlanningSemanticRepairPromptV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

const window = (localId: string, dateExpression: string | null) => ({
  localId, targetLocalId: 'task-1', kind: 'preferred_window' as const, constraintLevel: 'soft' as const,
  dateExpression, namedTimePeriod: null, startTime: '20:00', endTime: null, precision: 'exact' as const,
  sourceText: '平日は20時以降がいい',
});
function documentWith(windows: ReturnType<typeof window>[]): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan', planningWindow: null,
    tasks: [{ localId: 'task-1', existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: 'book',
      study: null, workloads: [], effortEstimates: [], temporalConstraints: windows, recurrence: [],
      durableContextSignals: [], sourceText: 'book' }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [], conversationActs: [],
  } as WeeklyPlanningSemanticDocumentV5;
}

describe('duplicate facts within one response (live A on e9b62a50)', () => {
  it('reports facts that differ only by localId, such as five undated weekday windows', () => {
    const live = documentWith([1, 2, 3, 4, 5].map((index) => window(`constraint-${index}`, null)));
    expect(validateWeeklyPlanningDuplicateFactsV5(live)).toEqual([2, 3, 4, 5].map((index) =>
      `document.tasks[0].temporalConstraints[${index - 1}]:duplicate-of:0`));
  });
  it('accepts one window per weekday and a single undated window', () => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    expect(validateWeeklyPlanningDuplicateFactsV5(documentWith(days.map((day, index) => window(`w-${index}`, `weekday:${day}`))))).toEqual([]);
    expect(validateWeeklyPlanningDuplicateFactsV5(documentWith([window('only', null)]))).toEqual([]);
  });
  it('asks the repair to date each copy or keep one', () => {
    const messages = createWeeklyPlanningSemanticRepairMessagesV5({
      baseMessages: [{ role: 'system', content: 'normalize' }], invalidResponse: '{}',
      validationErrors: ['document.tasks[0].temporalConstraints[1]:duplicate-of:0'], conversationArchitecture: 'interaction_v1',
    });
    const payload = JSON.parse(messages[messages.length - 1].content) as { requiredChanges: string[] };
    expect(payload.requiredChanges.join('\n')).toContain('Facts that differ only by localId are duplicates');
  });
});
