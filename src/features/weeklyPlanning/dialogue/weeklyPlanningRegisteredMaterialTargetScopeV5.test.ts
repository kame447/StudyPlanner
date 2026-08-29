import { describe, expect, it } from 'vitest';
import {
  questionIntentForStableV5Dialogue,
  questionTargetForStableV5Dialogue,
} from './weeklyPlanningStableV5DialogueContext';
import { fallbackTextForStableV5TypedIntent } from './weeklyPlanningStableV5TurnDialogue';

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

    const text = fallbackTextForStableV5TypedIntent({
      applicationText: '旧質問',
      questionIntent: intent,
    });
    expect(text).toContain('全1000語');
    expect(text).toContain('200語まで');
    expect(text).toContain('残りは800語');
    expect(text).toContain('今回の計画');
    expect(text).not.toContain('今どこまで');
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
