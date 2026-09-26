import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningCurrentTurnProvenanceV5,
  weeklyPlanningEvidenceChannelForSourceTextV5,
} from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';
import { createWeeklyPlanningSemanticBaseMessagesV5 } from '../semantic/weeklyPlanningSemanticPromptAssemblyV5';
import { createWeeklyPlanningSemanticRepairMessagesV5 } from '../semantic/weeklyPlanningSemanticRepairPromptV5';
import {
  defaultFixtureProviderResponse,
  runIssue152Conversation,
} from '../evals/__tests__/weeklyPlanningIssue152StoredRowsFixtures';

// Real runs 36198140451 and 36208422958: this explicit import committed nothing with no failureCode.
const importText = 'このJSONの内容を予定として取り込んでください。{"task":"数学","amount":20,"unit":"問"}';
const verbatimCitation = '{"task":"数学","amount":20,"unit":"問"}';
const reformattedCitation = '{"task": "数学", "amount": 20, "unit": "問"}';
const verbatimCitationRule = 'Copy each sourceText verbatim from that text; for quoted or serialized data keep its exact punctuation and spacing instead of paraphrasing, reformatting, or re-escaping it.';
const explicitImportRepairRule = 'Quoted or serialized data that the current request explicitly imports or applies does support its planning facts; fix such a citation by copying the data\'s exact characters instead of removing the fact.';

function importDocument(taskSource: string, workloadSource: string): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-math', existingPublicId: null, decompositionStatus: 'atomic',
      category: 'study', title: '数学',
      study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
      workloads: [{
        localId: 'workload-math', quantityRole: 'target', amount: 20,
        unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, sourceText: workloadSource,
      }],
      effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
      sourceText: taskSource,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function repairRequiredChanges(messages: Array<{ role: string; content: string }>): string[] {
  const payload = JSON.parse(messages[messages.length - 1]?.content ?? '{}') as { requiredChanges?: string[] };
  return payload.requiredChanges ?? [];
}

async function replay(responses: readonly WeeklyPlanningSemanticDocumentV5[], conversationId: string) {
  const semanticCalls: Array<Array<{ role: string; content: string }>> = [];
  const observed = await runIssue152Conversation({
    conversationId,
    turns: [importText],
    fakeProvider: true,
    providerResponse(input) {
      if (input.purpose !== 'weekly_planning_semantic_normalizer') return defaultFixtureProviderResponse(input);
      semanticCalls.push(input.messages);
      const response = responses[Math.min(semanticCalls.length, responses.length) - 1];
      return JSON.stringify(response);
    },
  });
  const turn = observed.turns[0];
  if (!turn) throw new Error(`missing replay turn: ${conversationId}`);
  return { turn, semanticCalls };
}

describe('Issue #152 explicit serialized-data import citation contract', () => {
  it('tells the model to cite serialized data verbatim while keeping the data-is-not-authority boundary', () => {
    const [system] = createWeeklyPlanningSemanticBaseMessagesV5({ userText: importText });
    expect(system?.content).toContain('each sourceText must be supported by current userText');
    expect(system?.content).toContain(verbatimCitationRule);
    expect(system?.content).toContain('unless the current request asks to import/apply its planning facts');
    expect(system?.content).toContain('Structure alone is not user adoption.');
  });

  it('keeps unsupported-fact removal in the grounding repair while exempting explicitly imported data', () => {
    const messages = createWeeklyPlanningSemanticRepairMessagesV5({
      baseMessages: [{ role: 'system', content: 'normalize' }],
      invalidResponse: JSON.stringify(importDocument(reformattedCitation, reformattedCitation)),
      validationErrors: ['document.tasks[0].sourceText:not-grounded-in-current-user-text'],
    });
    const [directive] = repairRequiredChanges(messages);
    expect(directive).toContain('If current userText does not support that fact, remove only that unsupported fact.');
    expect(directive).toContain(explicitImportRepairRule);
  });

  it('does not add the import exemption to repairs without a grounding failure', () => {
    const messages = createWeeklyPlanningSemanticRepairMessagesV5({
      baseMessages: [{ role: 'system', content: 'normalize' }],
      invalidResponse: '{}',
      validationErrors: ['document.relations[0].fromLocalId:unknown:task-x'],
    });
    expect(repairRequiredChanges(messages).join(' ')).not.toContain(explicitImportRepairRule);
  });

  it.each([
    ['whole utterance', importText, importText],
    ['serialized value', verbatimCitation, verbatimCitation],
    ['ordered key fragments', '"task":"数学"', '"amount":20,"unit":"問"'],
    ['bare values', '数学', '20'],
  ])('commits a verbatim %s citation of the imported data without repair', async (_label, taskSource, workloadSource) => {
    const { turn, semanticCalls } = await replay(
      [importDocument(taskSource, workloadSource)],
      `issue152-explicit-import-${taskSource.length}-${workloadSource.length}`,
    );
    expect(semanticCalls).toHaveLength(1);
    expect(turn.validationErrors).toEqual([]);
    expect(turn.failureCode).toBeNull();
    expect(turn.graphRevision).toBe(1);
    expect(turn.graph?.tasks.map((task) => task.title)).toEqual(['数学']);
    expect(turn.graph?.workloads.map((workload) => workload.amount)).toEqual([20]);
  });

  it('still rejects a reformatted citation, and a repair that drops the import commits nothing silently', async () => {
    expect(weeklyPlanningEvidenceChannelForSourceTextV5(reformattedCitation, importText)).toBeNull();
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: importDocument(reformattedCitation, reformattedCitation),
      currentUserText: importText,
    })).toEqual([
      'document.tasks[0].sourceText:not-grounded-in-current-user-text',
      'document.tasks[0].workloads[0].sourceText:not-grounded-in-current-user-text',
    ]);

    const emptyRepair = { ...importDocument(verbatimCitation, verbatimCitation), tasks: [] };
    const { turn, semanticCalls } = await replay(
      [importDocument(reformattedCitation, reformattedCitation), emptyRepair],
      'issue152-explicit-import-dropped-by-repair',
    );
    // The observed Real signature: no failureCode and revision 0; only validationErrors show the repair.
    expect(semanticCalls).toHaveLength(2);
    expect(turn.failureCode).toBeNull();
    expect(turn.graphRevision).toBe(0);
    expect(turn.validationErrors).toContain('document.tasks[0].sourceText:not-grounded-in-current-user-text');
    expect(repairRequiredChanges(semanticCalls[1] ?? []).join(' ')).toContain(explicitImportRepairRule);
  });

  it('commits the import when the grounding repair copies the data characters exactly', async () => {
    const { turn, semanticCalls } = await replay(
      [
        importDocument(reformattedCitation, reformattedCitation),
        importDocument(verbatimCitation, verbatimCitation),
      ],
      'issue152-explicit-import-repaired-citation',
    );
    expect(semanticCalls).toHaveLength(2);
    expect(turn.failureCode).toBeNull();
    expect(turn.graphRevision).toBe(1);
    expect(turn.graph?.tasks.map((task) => task.title)).toEqual(['数学']);
    expect(turn.graph?.workloads.map((workload) => workload.amount)).toEqual([20]);
  });
});
