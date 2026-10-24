import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

const userText = '15分。あと英語の締切を金曜にして';
const publicStateSummary = {
  graphRevision: 3,
  pendingQuestion: { questionCode: 'missing_effort_estimate', targetFactId: 'math-workload', graphRevision: 3 },
  tasks: [{ publicId: 'math', category: 'study', title: '数学' },
    { publicId: 'english', category: 'study', title: '英語' }],
  components: [], workloads: [],
};

function response(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [{ localId: 'english-turn', existingPublicId: 'english', category: 'study', title: '英語',
      study: { purpose: 'self_study', contextLabel: null, components: [] }, workloads: [], effortEstimates: [],
      temporalConstraints: [{ localId: 'deadline', targetLocalId: 'english-turn', kind: 'deadline', constraintLevel: 'hard',
        dateExpression: 'weekday:friday', namedTimePeriod: null, startTime: null, endTime: null,
        precision: 'exact', sourceText: '英語の締切を金曜にして' }],
      recurrence: [], sourceText: '英語' }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    uncertainties: [], corrections: [], decisions: [],
  };
}

function invalidResponse() {
  const invalid = response();
  invalid.tasks.push({ ...structuredClone(invalid.tasks[0]), localId: 'math-turn', existingPublicId: 'math', title: '数学',
    sourceText: '15分', temporalConstraints: [],
    workloads: [{ localId: 'wrong-quantity', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: 'unsupported evidence' }] });
  return invalid;
}

async function normalize(first: WeeklyPlanningSemanticDocumentV5, repair: WeeklyPlanningSemanticDocumentV5,
  state: Record<string, unknown> = publicStateSummary, expectedSemanticCalls = 2) {
  let semanticCalls = 0;
  const client = { createChatCompletion: vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async request => {
    if (request.responseFormat?.json_schema.name !== 'weekly_planning_semantic_document_v5') {
      return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    }
    return JSON.stringify(++semanticCalls === 1 ? first : repair);
  }) };
  const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({ userText, publicStateSummary: state });
  expect(semanticCalls).toBe(expectedSemanticCalls);
  return result;
}

describe('compound pending-effort fallback repair (#825)', () => {
  it('does not accept an empty repair that discards the independently valid deadline', async () => {
    const deadline = response();
    expect(validateWeeklyPlanningSemanticResponseV5(JSON.stringify(deadline), { currentUserText: userText, publicStateSummary }).errors).toEqual([]);
    const empty = { ...response(), tasks: [] };
    const result = await normalize(invalidResponse(), empty);
    expect(result.status).toBe('accepted');
    expect(result.document?.tasks.flatMap(task => task.temporalConstraints)).toEqual([
      expect.objectContaining({ kind: 'deadline', dateExpression: 'weekday:friday' }),
    ]);
    expect(result.document?.tasks.map(task => task.existingPublicId)).toEqual(['english']);
    expect(result.document?.tasks[0].effortEstimates).toEqual([]);
    expect(result.diagnostics.algorithmicRepairs).toContain('semantic-repair:retained-independently-validated-task-updates');
  });

  it.each(['unknown binding', 'unsupported evidence', 'noncanonical deadline', 'cross-task operation', 'new task', 'different intent', 'no time question'] as const)
  ('keeps validation/operation boundaries for %s', async kind => {
    const first = invalidResponse();
    const repair: WeeklyPlanningSemanticDocumentV5 = { ...response(), tasks: [] };
    let state: Record<string, unknown> = publicStateSummary;
    if (kind === 'unknown binding') first.tasks[0].existingPublicId = 'unknown';
    if (kind === 'new task') first.tasks[0].existingPublicId = null;
    if (kind === 'unsupported evidence') first.tasks[0].temporalConstraints[0].sourceText = 'unsupported evidence';
    if (kind === 'noncanonical deadline') first.tasks[0].temporalConstraints[0].dateExpression = '金曜';
    if (kind === 'cross-task operation') first.corrections.push({ localId: 'remove', target: { kind: 'task', localId: 'math-turn', publicId: null, mention: null }, operation: 'remove', replacementLocalId: null, sourceText: '15分' });
    if (kind === 'different intent') repair.planningIntent = 'discuss';
    if (kind === 'no time question') state = { ...publicStateSummary, pendingQuestion: null };
    // Existing empty repairs get two no-op completeness attempts when a pending
    // question exists. Representation loss rejects earlier; no question skips it.
    const expectedCalls = kind === 'noncanonical deadline' || kind === 'no time question' ? 2 : 4;
    const result = await normalize(first, repair, state, expectedCalls);
    expect(result.document?.tasks ?? []).toEqual([]);
  });
});
