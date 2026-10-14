import { describe, expect, it } from 'vitest';
import {
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
} from './weeklyPlanningStableV5DialogueContext';
import { createWeeklyPlanningStableV5DialoguePrompt } from './weeklyPlanningStableV5DialoguePrompt';

function planningInformation(registeredMaterials: Array<Record<string, unknown>>) {
  return {
    tasks: [{ id: 'task-gold', title: 'TOEIC対策 金フレ' }],
    components: [{
      id: 'component-gold',
      taskId: 'task-gold',
      role: 'material',
      label: '金フレ',
    }],
    workloads: [],
    uncertainties: [{
      id: 'uncertainty-gold',
      targetFactId: 'task-gold',
      field: 'work_breakdown',
      reason: '教材の量が未確定',
    }],
    registeredMaterials,
  };
}

function goldPhraseMaterial(overrides: Record<string, unknown> = {}) {
  return {
    materialId: 'bookshelf-gold',
    name: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
    catalogTitle: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
    aliases: ['金フレ', '金のフレーズ'],
    paceEnabled: true,
    progressUnit: 'word',
    progressUnitLabel: null,
    totalUnits: 1000,
    currentUnit: 200,
    remainingUnits: 800,
    ...overrides,
  };
}

describe('Stable V5 registered material target-scope dialogue context', () => {
  it('reuses known bookshelf progress for a work-breakdown uncertainty', () => {
    const information = planningInformation([goldPhraseMaterial()]);
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation: information,
      targetFactId: 'uncertainty-gold',
    });

    const intent = questionIntentForStableV5Dialogue({
      questionCode: 'semantic_uncertainty',
      questionTarget,
      planningInformation: information,
    });

    expect(intent).toEqual(expect.objectContaining({
      kind: 'schedulable_work_detail',
      mode: 'registered_material_target_scope',
      progressBasis: 'known_registered_material_progress',
      knownUnitCode: 'word',
      knownUnitLabel: '語',
      knownTotalUnits: 1000,
      knownCurrentUnits: 200,
      knownRemainingUnits: 800,
      requestedInformation: ['plan_target_scope'],
    }));

    const prompt = createWeeklyPlanningStableV5DialoguePrompt({
      actionId: 'registered-material-scope',
      currentUserMessage: '金フレの学習を進めたい',
      recentConversation: [],
      planningInformation: information,
      actionKind: 'question',
      questionCode: 'semantic_uncertainty',
      questionTarget,
      questionIntent: intent,
      requiredLabels: [],
      fallbackText: '返信を作れませんでした。少し待ってからもう一度送信してください。',
      previewCount: 0,
    });
    const decision = JSON.parse(prompt.userPrompt).applicationDecision;
    expect(decision.questionIntent).toEqual(intent);
    expect(decision.questionIntent).toMatchObject({
      knownTotalUnits: 1000,
      knownCurrentUnits: 200,
      knownRemainingUnits: 800,
      requestedInformation: ['plan_target_scope'],
    });
  });

  it('uses the same known context when missing schedulable work targets the material component', () => {
    const information = planningInformation([goldPhraseMaterial()]);
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation: information,
      targetFactId: 'component-gold',
    });

    const intent = questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget,
      planningInformation: information,
    });

    expect(intent).toEqual(expect.objectContaining({
      mode: 'registered_material_target_scope',
      targetFactId: 'component-gold',
      knownRemainingUnits: 800,
    }));
  });

  it('does not auto-bind an ambiguous alias shared by multiple registered materials', () => {
    const information = planningInformation([
      goldPhraseMaterial(),
      goldPhraseMaterial({
        materialId: 'bookshelf-gold-2',
        name: '別版 金のフレーズ',
        catalogTitle: '別版 金のフレーズ',
        aliases: ['金フレ'],
      }),
    ]);
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation: information,
      targetFactId: 'component-gold',
    });

    const intent = questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget,
      planningInformation: information,
    });

    expect(intent).toEqual(expect.objectContaining({
      kind: 'schedulable_work_detail',
      mode: 'existing_target_progress',
      requestedInformation: ['current_progress'],
    }));
  });

  it('does not reuse progress when pace management is disabled', () => {
    const information = planningInformation([
      goldPhraseMaterial({ paceEnabled: false }),
    ]);
    const questionTarget = questionTargetForStableV5Dialogue({
      planningInformation: information,
      targetFactId: 'component-gold',
    });

    const intent = questionIntentForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      questionTarget,
      planningInformation: information,
    });

    expect(intent).toEqual(expect.objectContaining({
      mode: 'existing_target_progress',
    }));
  });
});
