import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  validateWeeklyPlanningCurrentTurnProvenanceV5,
} from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';

// Captured semantic responses from Real correction run 36195230208, inlined so
// this deterministic regression never depends on the artifact or a credential.
const currentUserText = "水曜日だけは19時から21時ではなく、20時から21時に変更してください。";

const observedRecentConversation = [
  {
    "role": "user",
    "content": "来週、数学の問題集を20問進めたいです。1問10分くらいです。平日は19時から21時が空いています。"
  },
  {
    "role": "assistant",
    "content": "来週、数学の問題集を20問、1問10分くらいで進めたいのですね。平日は19時から21時が空いています。どの範囲・問題を進める予定ですか？"
  }
] as Array<{ role: 'user' | 'assistant'; content: string }>;

const observedPublicStateSummary = {
  "pendingQuestion": {
    "actionId": null,
    "questionCode": "semantic_uncertainty",
    "targetFactId": "wpf_uncertainty_jqhkume6t7qa",
    "graphRevision": 1,
    "effortMeasurement": null,
    "estimateForWorkloadFactId": null,
    "questionBasis": null
  },
  "tasks": [
    {
      "publicId": "wpf_task_t5pg5jxhxaz",
      "category": "study",
      "title": "数学の問題集"
    }
  ],
  "uncertainties": [
    {
      "publicId": "wpf_uncertainty_jqhkume6t7qa",
      "targetPublicId": "wpf_task_t5pg5jxhxaz",
      "field": "work_breakdown",
      "reason": "task constituents are not yet identified for planning",
      "sourceText": "数学の問題集を20問進めたいです"
    }
  ],
  "lastAssistantMessage": "来週、数学の問題集を20問、1問10分くらいで進めたいのですね。平日は19時から21時が空いています。どの範囲・問題を進める予定ですか？"
};

const observedInitialDocument = {
  "schemaVersion": "weekly-planning-semantic-v5",
  "planningIntent": "update_plan",
  "planningWindow": null,
  "tasks": [],
  "relations": [],
  "availabilityDeclarations": [
    {
      "localId": "availability_remainder_mon_tue_thu_fri",
      "kind": "available",
      "dateExpression": null,
      "namedTimePeriod": null,
      "startTime": "19:00",
      "endTime": "21:00",
      "recurrenceKind": "custom",
      "days": [
        "weekday:monday",
        "weekday:tuesday",
        "weekday:thursday",
        "weekday:friday"
      ],
      "constraintLevel": "hard",
      "capacityMinutes": null,
      "sourceText": "水曜日だけは19時から21時ではなく、20時から21時に変更してください。"
    },
    {
      "localId": "availability_wednesday_updated",
      "kind": "available",
      "dateExpression": null,
      "namedTimePeriod": null,
      "startTime": "20:00",
      "endTime": "21:00",
      "recurrenceKind": "weekly",
      "days": [
        "weekday:wednesday"
      ],
      "constraintLevel": "hard",
      "capacityMinutes": null,
      "sourceText": "水曜日だけは19時から21時ではなく、20時から21時に変更してください。"
    }
  ],
  "constraintSourceRequests": [],
  "userContextFacts": [],
  "uncertainties": [],
  "corrections": [
    {
      "localId": "correction_wednesday_availability",
      "target": {
        "kind": "availability_declaration",
        "publicId": "wpf_availability_xr045vqzrjav",
        "localId": null,
        "mention": "平日は19時から21時が空いています"
      },
      "operation": "replace",
      "replacementLocalId": "availability_remainder_mon_tue_thu_fri",
      "sourceText": "水曜日だけは19時から21時ではなく、20時から21時に変更してください。"
    }
  ],
  "decisions": []
} satisfies WeeklyPlanningSemanticDocumentV5;

const observedRepairDocument = {
  "schemaVersion": "weekly-planning-semantic-v5",
  "planningIntent": "update_plan",
  "planningWindow": null,
  "tasks": [
    {
      "localId": "task_math_workbook",
      "existingPublicId": "wpf_task_t5pg5jxhxaz",
      "decompositionStatus": "needs_breakdown",
      "category": "study",
      "title": "数学の問題集",
      "study": {
        "purpose": "other",
        "activityKind": "problem_solving",
        "contextLabel": null,
        "components": []
      },
      "workloads": [],
      "effortEstimates": [],
      "temporalConstraints": [],
      "recurrence": [],
      "durableContextSignals": [],
      "sourceText": "数学の問題集を20問進めたいです"
    }
  ],
  "relations": [],
  "availabilityDeclarations": [
    {
      "localId": "availability_remainder_mon_tue_thu_fri",
      "kind": "available",
      "dateExpression": null,
      "namedTimePeriod": null,
      "startTime": "19:00",
      "endTime": "21:00",
      "recurrenceKind": "custom",
      "days": [
        "weekday:monday",
        "weekday:tuesday",
        "weekday:thursday",
        "weekday:friday"
      ],
      "constraintLevel": "hard",
      "capacityMinutes": null,
      "sourceText": "水曜日だけは19時から21時ではなく、20時から21時に変更してください。"
    },
    {
      "localId": "availability_wednesday_updated",
      "kind": "available",
      "dateExpression": null,
      "namedTimePeriod": null,
      "startTime": "20:00",
      "endTime": "21:00",
      "recurrenceKind": "weekly",
      "days": [
        "weekday:wednesday"
      ],
      "constraintLevel": "hard",
      "capacityMinutes": null,
      "sourceText": "水曜日だけは19時から21時ではなく、20時から21時に変更してください。"
    }
  ],
  "constraintSourceRequests": [],
  "userContextFacts": [],
  "uncertainties": [
    {
      "localId": "uncertainty_math_workbook_breakdown",
      "targetLocalId": "task_math_workbook",
      "field": "work_breakdown",
      "reason": "task constituents are not yet identified for planning",
      "sourceText": "数学の問題集を20問進めたいです"
    }
  ],
  "corrections": [
    {
      "localId": "correction_wednesday_availability",
      "target": {
        "kind": "availability_declaration",
        "publicId": "wpf_availability_xr045vqzrjav",
        "localId": null,
        "mention": "平日は19時から21時が空いています"
      },
      "operation": "replace",
      "replacementLocalId": "availability_remainder_mon_tue_thu_fri",
      "sourceText": "水曜日だけは19時から21時ではなく、20時から21時に変更してください。"
    }
  ],
  "decisions": []
} satisfies WeeklyPlanningSemanticDocumentV5;

const priorUserSource = '数学の問題集を20問進めたいです';
const sourceError = 'document.uncertainties[0].sourceText:not-grounded-in-current-user-text';
const reasonError = 'document.uncertainties[0].reason:copied-from-stored-context-without-current-mention';

function uncertaintyOnlyDocument(sourceText: string, reason = '確認したい'): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    userContextFacts: [], uncertainties: [{
      localId: 'uncertainty-current', targetLocalId: 'task-local', field: 'work_breakdown',
      reason, sourceText,
    }], corrections: [], decisions: [],
  };
}

describe('Issue #152 prior-user uncertainty provenance', () => {
  it('accepts the exact observed repair while retaining the initial work-breakdown rejection', async () => {
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() {
        const response = calls++ === 0 ? observedInitialDocument : observedRepairDocument;
        return JSON.stringify(response);
      },
    };
    let calls = 0;
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: currentUserText,
      recentConversation: observedRecentConversation,
      publicStateSummary: observedPublicStateSummary,
    });
    expect(result.status).toBe('accepted');
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(result.diagnostics.validationErrors).toContain(
      'document:work-breakdown-target-task-required:target=wpf_task_t5pg5jxhxaz',
    );
    expect(result.diagnostics.validationErrors).not.toContain(`repair:${sourceError}`);
    expect(result.diagnostics.validationErrors).not.toContain(`repair:${reasonError}`);
    expect(result.document?.uncertainties[0]?.sourceText).toBe(priorUserSource);
    expect(calls).toBe(2);
  });

  it('accepts the exact repair document at the full semantic validation boundary', () => {
    const validated = validateWeeklyPlanningSemanticResponseV5(
      JSON.stringify(observedRepairDocument), {
        currentUserText, recentConversation: observedRecentConversation,
        publicStateSummary: observedPublicStateSummary,
      },
    );
    expect(validated.errors).toEqual([]);
    expect(validated.document?.uncertainties).toHaveLength(1);
  });

  it.each([
    ['assistant message', { recentConversation: [{ role: 'assistant' as const, content: priorUserSource }] }],
    ['stored label', { publicStateSummary: { tasks: [{ title: priorUserSource }] } }],
    ['durable value', { publicStateSummary: { userPlanningContext: [{ value: priorUserSource }] } }],
    ['starter metadata', { selectedStarterTarget: { kind: 'material' as const, id: 'material-1', label: priorUserSource, targetDate: null } }],
    ['supplemental text', { supplementalContext: priorUserSource }],
  ])('rejects uncertainty evidence from %s alone', (_name, carrier) => {
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: uncertaintyOnlyDocument(priorUserSource),
      currentUserText,
      ...carrier,
    })).toContain(sourceError);
  });

  it('rejects supplemental overlap even when a prior user turn says the same words', () => {
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: uncertaintyOnlyDocument(priorUserSource), currentUserText,
      recentConversation: [{ role: 'user', content: priorUserSource }],
      supplementalContext: priorUserSource,
    })).toContain(sourceError);
  });

  it('accepts a stored reason that the user personally stated in a prior turn', () => {
    const reason = '教材の範囲を確認したい';
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: uncertaintyOnlyDocument(priorUserSource, reason), currentUserText,
      recentConversation: [{ role: 'user', content: `${priorUserSource}。${reason}` }],
      publicStateSummary: { userPlanningContext: [{ value: reason }] },
    })).toEqual([]);
  });

  it('does not borrow an existing reason from a different target', () => {
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: observedRepairDocument, currentUserText,
      recentConversation: observedRecentConversation,
      publicStateSummary: {
        ...observedPublicStateSummary,
        uncertainties: [{
          ...observedPublicStateSummary.uncertainties[0],
          targetPublicId: 'wpf_task_other',
        }],
      },
    })).toContain(reasonError);
  });

  it('keeps a new workload citation tied to the current turn', () => {
    const document: WeeklyPlanningSemanticDocumentV5 = {
      ...observedRepairDocument,
      tasks: [{
        ...observedRepairDocument.tasks[0],
        workloads: [{
          localId: 'new-workload', quantityRole: 'target', amount: 20,
          unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null,
          perOccurrence: false, periodExpression: null, sourceText: priorUserSource,
        }],
      }],
    };
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document, currentUserText,
      recentConversation: observedRecentConversation,
      publicStateSummary: observedPublicStateSummary,
    })).toContain('document.tasks[0].workloads[0].sourceText:not-grounded-in-current-user-text');
  });

  it('rejects an unrelated stored reason even with genuine prior-user uncertainty evidence', () => {
    const document = uncertaintyOnlyDocument(priorUserSource, '本棚の説明文');
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document, currentUserText,
      recentConversation: [{ role: 'user', content: priorUserSource }],
      publicStateSummary: { userPlanningContext: [{ value: '本棚の説明文' }] },
    })).toContain(reasonError);
  });
});
