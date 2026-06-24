import { describe, expect, it } from 'vitest';
import {
  assessWeeklyPlanningRequest,
  createSimpleWeeklyDraftBlocksFromText,
} from '../weeklyPlanningTransforms';
import {
  minutesBetween,
} from '../testUtils/weeklyPlanningTestHelpers';
describe('parsing weeklyTitleCleanup', () => {
  it('removes desire wording from simple weekly draft labels', () => {
    const blocks = createSimpleWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '卒研を2時間やりたい',
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      title: '卒研',
      subject: '卒研',
      label: '卒研',
    });
    expect(minutesBetween(blocks[0].startTime, blocks[0].endTime)).toBe(120);
  });

  it('preserves task-name suffixes that describe the actual study work', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、レポート作成を4時間、Java実装を3時間、Obsidian整理を2時間、過去問演習を2時間、間違い直しを1時間',
    });

    expect(assessment.tasks.map((task) => task.title)).toEqual([
      'レポート作成',
      'Java実装',
      'Obsidian整理',
      '過去問演習',
      '間違い直し',
    ]);
  });
});
