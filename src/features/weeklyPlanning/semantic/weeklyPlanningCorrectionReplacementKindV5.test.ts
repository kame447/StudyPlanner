import { describe, expect, it } from 'vitest';
import { validateWeeklyPlanningCorrectionReplacementKindsV5 } from './weeklyPlanningCorrectionReferenceValidationV5';
import { createWeeklyPlanningSemanticRepairMessagesV5 } from './weeklyPlanningSemanticRepairPromptV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

// Live B T4 on dc38e978 (「青チャートのこと」): a correct new material component, also sent as the
// replacement of its task. The canonical owner rejected the kind mismatch after validation.
function liveB4(withCorrection: boolean): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [{
      localId: 'task-existing', existingPublicId: 'wpf_task_math', decompositionStatus: 'decomposed', category: 'study',
      title: '数学の問題集を進める',
      study: { purpose: 'practice', activityKind: 'problem_solving', contextLabel: null, components: [{
        localId: 'component-blue-chart', existingPublicId: null, parentLocalId: 'task-existing', role: 'material',
        label: '青チャート 数学III', workloads: [], durableContextSignals: [], sourceText: '青チャートのこと',
      }] },
      workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
      sourceText: '青チャートのこと',
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], conversationActs: [],
    uncertainties: [], decisions: [],
    corrections: withCorrection ? [{
      localId: 'correction-material', target: { kind: 'task', publicId: 'wpf_task_math', localId: null, mention: '数学の問題集' },
      operation: 'replace', replacementLocalId: 'component-blue-chart', sourceText: '青チャートのこと',
    }] : [],
  } as WeeklyPlanningSemanticDocumentV5;
}

describe('correction replacement kind (interaction validation, live B on dc38e978)', () => {
  it('reports a task replaced by a component before canonicalization, so the one repair can drop it', () => {
    expect(validateWeeklyPlanningCorrectionReplacementKindsV5(liveB4(true)))
      .toEqual(['document.corrections[0].replacementLocalId:kind-mismatch:task:component']);
    expect(validateWeeklyPlanningCorrectionReplacementKindsV5(liveB4(false))).toEqual([]);
  });

  it('accepts same-kind replacements, temporal kinds and replacements it cannot see', () => {
    const document = liveB4(true);
    document.corrections[0] = { ...document.corrections[0], target: { kind: 'component', publicId: 'wpf_component_book', localId: null, mention: null } };
    expect(validateWeeklyPlanningCorrectionReplacementKindsV5(document)).toEqual([]);
    document.tasks[0].temporalConstraints = [{ localId: 'deadline', targetLocalId: 'task-existing', kind: 'deadline', constraintLevel: 'hard',
      dateExpression: '2026-10-16', namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText: '青チャートのこと' }];
    document.corrections[0] = { ...document.corrections[0], target: { kind: 'temporal_constraint', publicId: 'wpf_temporal_old', localId: null, mention: null }, replacementLocalId: 'deadline' };
    expect(validateWeeklyPlanningCorrectionReplacementKindsV5(document)).toEqual([]);
    document.corrections[0] = { ...document.corrections[0], replacementLocalId: 'not-declared' };
    expect(validateWeeklyPlanningCorrectionReplacementKindsV5(document)).toEqual([]);
  });

  // The error is produced only by interaction validation, so the historical prompt never carries it.
  it('tells the repair to keep the new component without a correction', () => {
    const directive = (conversationArchitecture: 'interaction_v1' | 'legacy_v5') => {
      const messages = createWeeklyPlanningSemanticRepairMessagesV5({
        baseMessages: [{ role: 'system', content: 'normalize' }], invalidResponse: '{}',
        validationErrors: ['document.corrections[0].replacementLocalId:kind-mismatch:task:component'], conversationArchitecture,
      });
      return (JSON.parse(messages[messages.length - 1].content) as { requiredChanges: string[] }).requiredChanges.join('\n');
    };
    expect(directive('interaction_v1')).toContain('without any correction');
  });
});
