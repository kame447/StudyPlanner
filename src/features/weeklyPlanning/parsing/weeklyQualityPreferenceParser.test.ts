import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningConditionOverride,
  assessWeeklyPlanningRequest,
  createAvailabilityAwareWeeklyDraftBlocksFromText,
  createWeeklyPlanningPendingConfig,
  parseWeeklyPlanningConditionOperations,
  summarizeWeeklyPlanningPendingConfig,
} from '../weeklyPlanningTransforms';
describe('parsing weeklyQualityPreferenceParser', () => {
  it('keeps quality preferences from overriding numeric planning conditions', () => {
    const sourceText = '来週、英語を3時間、計算理論を4時間、卒研を2時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: `6日間に分散
1日1科目だけになりにくい
1回が30分台にならない
重いタスクが細切れにならない`,
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.defaults.dayCount).toBe(6);
    expect(override.config.defaults.maxSessionMinutes).not.toBe(30);
    expect(override.config.qualityPreferences).toEqual(
      expect.arrayContaining([
        'preferTaskSpread',
        'avoidSingleSubjectDay',
        'avoidTinyChunks',
        'avoidFragmentingHeavyTasks',
      ]),
    );

    const summary = summarizeWeeklyPlanningPendingConfig(override.config);
    expect(summary).not.toContain('1日間');
    expect(summary).not.toContain('最大30分');
  });

  it('keeps explicit numeric condition replies working alongside quality preferences', () => {
    expect(parseWeeklyPlanningConditionOperations('3日間でやって')).toContainEqual({
      kind: 'setDayCount',
      dayCount: 3,
    });
    expect(parseWeeklyPlanningConditionOperations('1回90分で')).toContainEqual({
      kind: 'setMaxSessionMinutes',
      minutes: 90,
    });
    expect(parseWeeklyPlanningConditionOperations('長めで')).toContainEqual({
      kind: 'addSessionIntentOverride',
      override: { scope: 'global', kind: 'prefer_long', targetSessionMinutes: 120 },
    });
    expect(parseWeeklyPlanningConditionOperations('2時間単位で')).toContainEqual({
      kind: 'addSessionIntentOverride',
      override: { scope: 'global', kind: 'fixed_two_hour', targetSessionMinutes: 120 },
    });
  });

  it('keeps follow-up quality preference text out of task titles and draft labels', () => {
    const sourceText = '来週、英語10時間、数学8時間、卒研6時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '6日間に分散\n1日1科目だけになりにくい\n1回が30分台にならない\n重いタスクが細切れにならない',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.tasks.map((task) => task.title)).toEqual([
      '英語',
      '数学',
      '卒研',
    ]);
    override.config.tasks.forEach((task) => {
      expect(task.title).not.toMatch(/6日間|分散|やりたい|30分台|細切れ|1日1科目/);
    });

    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: 'この条件で作成',
      pendingConfig: override.config,
    });
    const allowedTitles = new Set(['英語', '数学', '卒研']);

    result.blocks.forEach((block) => {
      expect(allowedTitles.has(block.title)).toBe(true);
      [block.title, block.subject, block.label].forEach((value) => {
        expect(value).not.toMatch(/6日間|分散|やりたい|30分台|細切れ|1日1科目/);
      });
    });
  });

  it('exposes quality preferences to availability-aware placement diagnostics', () => {
    const sourceText = '来週、英語3時間、数学3時間、卒研3時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '6日間に分散\n1日1科目だけになりにくい\n30分台を避けたい',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.qualityPreferences).toEqual(
      expect.arrayContaining([
        'preferTaskSpread',
        'avoidSingleSubjectDay',
        'avoidTinyChunks',
      ]),
    );

    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: 'この条件で作成',
      pendingConfig: override.config,
    });

    expect(result.diagnostics?.qualityPreferences).toEqual(
      expect.arrayContaining([
        'preferTaskSpread',
        'avoidSingleSubjectDay',
        'avoidTinyChunks',
      ]),
    );
  });
});
