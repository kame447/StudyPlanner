import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  validateWeeklyPlanningCurrentTurnProvenanceV5,
} from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';

const citation = '数学20問進めたい';
const fragmentedUserText = '数学20問と理科10問進めたい';
const taskSourceError = 'document.tasks[0].sourceText:not-grounded-in-current-user-text';
const correctionSourceError = 'document.corrections[0].sourceText:not-grounded-in-current-user-text';
const originalAvailabilityTurn = '来週、数学の問題集を30問と英単語を200語進めたいです。平日は19時から21時、土日は10時から12時が空いています。';

function candidate(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan', planningWindow: null,
    tasks: [{
      localId: 'task-current', existingPublicId: null,
      decompositionStatus: 'atomic', category: 'study', title: '新しい課題',
      study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
      workloads: [], effortEstimates: [], temporalConstraints: [],
      recurrence: [], durableContextSignals: [], sourceText: citation,
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  };
}

function availabilityCorrection(
  sourceText: string,
  currentUserText: string,
  replacement: { startTime: string; endTime: string; days: string[] },
): WeeklyPlanningSemanticDocumentV5 {
  return {
    ...candidate(),
    tasks: [],
    availabilityDeclarations: [{
      localId: 'availability-replacement', kind: 'available', dateExpression: null,
      namedTimePeriod: null, startTime: replacement.startTime, endTime: replacement.endTime,
      recurrenceKind: 'weekly', days: replacement.days,
      constraintLevel: 'hard', capacityMinutes: null, sourceText: currentUserText,
    }],
    corrections: [{
      localId: 'availability-correction',
      target: { kind: 'availability_declaration', publicId: 'existing-availability', localId: null, mention: null },
      operation: 'replace', replacementLocalId: 'availability-replacement', sourceText,
    }],
  };
}

const publicSurfaces: Array<[string, Record<string, unknown>]> = [
  ['task title', { tasks: [{ title: citation }] }],
  ['component label', { components: [{ label: citation }] }],
  ['uncertainty source', { uncertainties: [{ sourceText: citation }] }],
  ['durable context value', { userPlanningContext: [{ value: citation }] }],
  ['registered material name', { registeredMaterials: [{ name: citation }] }],
  ['registered material catalog title', { registeredMaterials: [{ catalogTitle: citation }] }],
  ['registered material alias', { registeredMaterials: [{ aliases: [citation] }] }],
  ['registered material subject name', { registeredMaterials: [{ subjectName: citation }] }],
  ['registered material progress unit label', { registeredMaterials: [{ progressUnitLabel: citation }] }],
  ['study context label', { studyContexts: [{ contextLabel: citation }] }],
  ['exam name in planning information', { planningInformation: { exams: [{ name: citation }] } }],
  ['todo title in planning information', { planningInformation: { todos: [{ title: citation }] } }],
  ['availability label', { availabilityDeclarations: [{ label: citation }] }],
  ['workload unit label', { workloads: [{ unitLabel: citation }] }],
  ['grounding expression', { groundingRecords: [{ sourceExpression: citation }] }],
  ['episodic source excerpt', { episodicMemory: { items: [{ sourceExcerpts: [citation] }] } }],
  ['previous assistant text', { lastAssistantMessage: citation }],
  ['future nested public field', { futureContext: { rows: [{ display: { text: citation } }] } }],
];

describe('Issue #152 prompt-context string coverage for ordered fragments', () => {
  it.each(publicSurfaces)('rejects a fragmented source copied from %s', (_name, publicStateSummary) => {
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: candidate(), currentUserText: fragmentedUserText, publicStateSummary,
    })).toContain(taskSourceError);
  });

  it('rejects prior assistant-message fragments through the normalizer validation boundary', async () => {
    let calls = 0;
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() {
        calls += 1;
        return JSON.stringify(candidate());
      },
    };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: fragmentedUserText,
      recentConversation: [{ role: 'assistant', content: citation }],
    });
    expect(result.status).toBe('rejected');
    expect(result.diagnostics.validationErrors).toContain(`initial:${taskSourceError}`);
    expect(result.diagnostics.validationErrors).toContain(`repair:${taskSourceError}`);
    expect(calls).toBe(2);
  });

  it('accepts prior user-message fragments through the normalizer validation boundary', async () => {
    let calls = 0;
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() {
        calls += 1;
        return JSON.stringify(candidate());
      },
    };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: fragmentedUserText,
      recentConversation: [{ role: 'user', content: citation }],
    });
    expect(result.status).toBe('accepted');
    expect(result.diagnostics.validationErrors).toEqual([]);
    expect(calls).toBe(1);
  });

  it('does not let a prior user turn supply missing current-turn evidence', () => {
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: candidate(), currentUserText: '理科10問進めたい',
      recentConversation: [{ role: 'user', content: citation }],
    })).toContain(taskSourceError);
  });

  it.each([
    {
      name: 'Wednesday',
      currentUserText: '水曜日だけは19時から21時ではなく、20時から21時に変更してください。',
      sourceText: '19時21時', startTime: '20:00', endTime: '21:00',
      days: ['weekday:wednesday'],
    },
    {
      name: 'weekend',
      currentUserText: '空き時間を増やします。土日は10時から12時ではなく、10時から15時に変更してください。',
      sourceText: '土日10時12時', startTime: '10:00', endTime: '15:00',
      days: ['weekday:saturday', 'weekday:sunday'],
    },
  ])('accepts the $name correction when only a prior user turn repeats its ordered fragments',
    ({ currentUserText, sourceText, startTime, endTime, days }) => {
      const document = availabilityCorrection(sourceText, currentUserText, { startTime, endTime, days });
      expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
        document, currentUserText,
        recentConversation: [{ role: 'user', content: originalAvailabilityTurn }],
      })).toEqual([]);
      const validated = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), {
        currentUserText,
        recentConversation: [{ role: 'user', content: originalAvailabilityTurn }],
      });
      expect(validated.errors).toEqual([]);
      expect(validated.document?.corrections).toHaveLength(1);
      expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
        document, currentUserText,
        recentConversation: [{ role: 'assistant', content: originalAvailabilityTurn }],
      })).toContain(correctionSourceError);
      expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
        document, currentUserText,
        publicStateSummary: { registeredMaterials: [{ name: originalAvailabilityTurn }] },
      })).toContain(correctionSourceError);
    });

  it('covers a selected starter label while keeping the other prompt roots separate', () => {
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: candidate(), currentUserText: fragmentedUserText,
      selectedStarterTarget: { kind: 'material', id: 'material-1', label: citation, targetDate: null },
    })).toContain(taskSourceError);
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: candidate(), currentUserText: fragmentedUserText,
      publicStateSummary: { registeredMaterials: [{ name: '数学20問', catalogTitle: '進めたい' }] },
    })).toEqual([]);
  });

  it('keeps user-origin evidence valid when no stored leaf contains its ordered fragments', () => {
    const context = {
      registeredMaterials: [{ name: '理科の復習', catalogTitle: '英単語帳', aliases: ['歴史年表'] }],
      planningInformation: { exams: [{ name: '英語の試験' }] },
    };
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: candidate(), currentUserText: fragmentedUserText, publicStateSummary: context,
    })).toEqual([]);
  });

  it('accepts an exact contiguous user restatement even when it also appears in stored context', () => {
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: candidate(), currentUserText: citation,
      publicStateSummary: { registeredMaterials: [{ name: citation }] },
    })).toEqual([]);
  });
});
