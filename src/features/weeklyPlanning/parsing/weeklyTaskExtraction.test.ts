import { describe, expect, it } from 'vitest';
import {
  assessWeeklyPlanningRequest,
  createAvailabilityAwareWeeklyDraftBlocksFromText,
  createSimpleWeeklyDraftBlocksFromText,
} from '../weeklyPlanningTransforms';
describe('parsing weeklyTaskExtraction', () => {
  it('returns no simple drafts for blank or unextractable input', () => {
    expect(
      createSimpleWeeklyDraftBlocksFromText({
        userId: 'user-1',
        selectedDate: '2026-06-19',
        text: '   ',
      }),
    ).toEqual([]);

    expect(
      createSimpleWeeklyDraftBlocksFromText({
        userId: 'user-1',
        selectedDate: '2026-06-19',
        text: '来週ちょっと勉強したい',
      }),
    ).toEqual([]);
  });

  it('asks for task details instead of creating drafts for vague weekly input', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週ちょっと勉強したい',
    });

    expect(assessment.kind).toBe('needs_task_details');
    expect(assessment.tasks).toEqual([]);
    expect(assessment.questions[0]).toContain('タスク名と合計時間');
  });

  it('extracts deadlines and high priority metadata for weekly planning tasks', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、6/30までに重要なレポート作成を4時間、英語を2時間やりたい',
    });

    expect(assessment.tasks[0]).toMatchObject({
      title: 'レポート作成',
      priority: 'high',
      deadlineDate: '2026-06-30',
    });
    expect(assessment.tasks[1]).toMatchObject({
      title: '英語',
      priority: 'normal',
    });
    expect(assessment.confirmationSummary).toContain('週の前半');
  });

  it('uses explicit life-cycle settings but still asks for final confirmation on omakase', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間やりたい。7時起床、23時就寝、前後60分、最大90分、休憩15分でおまかせ',
    });

    expect(assessment.kind).toBe('needs_confirmation');
    expect(assessment.defaults).toMatchObject({
      wakeTime: '07:00',
      sleepStartTime: '23:00',
      bufferMinutes: 60,
      maxSessionMinutes: 90,
      breakMinutes: 15,
      deepNightAllowed: false,
    });
    expect(assessment.confirmationSummary).toContain('睡眠 23:00-翌07:00');
    expect(assessment.confirmationSummary).toContain('既存予定前後60分');
    expect(assessment.confirmationSummary).toContain('最大90分');
    expect(assessment.confirmationSummary).toContain('休憩15分');
  });

  it('keeps non-time study amounts and asks for estimate confirmation before drafting', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、ターゲット1900を300語、青チャート数列を30問、英語長文を毎日2題、化学重要問題集を20問。おまかせ',
    });

    expect(assessment.kind).toBe('needs_time_estimate');
    expect(assessment.tasks.map((task) => task.title)).toEqual([
      'ターゲット1900',
      '青チャート数列',
      '英語長文',
      '化学重要問題集',
    ]);
    expect(assessment.tasks.map((task) => task.amount)).toEqual([
      expect.objectContaining({ unit: 'words', value: 300, daily: false }),
      expect.objectContaining({ unit: 'problems', value: 30, daily: false }),
      expect.objectContaining({ unit: 'passages', value: 2, daily: true }),
      expect.objectContaining({ unit: 'problems', value: 20, daily: false }),
    ]);
    expect(assessment.questions.join('\n')).toContain('何分相当');
    expect(assessment.confirmationSummary).toContain('50語=30分');
    expect(assessment.confirmationSummary).toContain('1問=10分');
    expect(
      createAvailabilityAwareWeeklyDraftBlocksFromText({
        userId: 'user-1',
        selectedDate: '2026-06-19',
        text: assessment.tasks.map((task) => task.sourceText).join('、'),
        existingPlans: [],
      }).blocks,
    ).toEqual([]);
  });

  it('keeps daily units separate instead of collapsing them into one day', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英単語を毎日50語、リスニングを毎日30分、数学を1日10問',
    });

    expect(assessment.kind).toBe('needs_time_estimate');
    expect(assessment.tasks.map((task) => [task.title, task.amount.daily])).toEqual([
      ['英単語', true],
      ['リスニング', true],
      ['数学', true],
    ]);
    expect(assessment.tasks.find((task) => task.title === 'リスニング')).toMatchObject({
      durationMinutes: 30,
      requiresTimeEstimate: false,
    });
  });

  it('does not treat placement conditions as weekly planning tasks', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間、7時起床、23時就寝、最大90分、休憩15分、前後60分、深夜OK、午後中心、11時から、18時まで',
    });

    expect(assessment.tasks.map((task) => task.title)).toEqual(['英語']);
    expect(assessment.tasks[0]).toMatchObject({
      durationMinutes: 120,
      title: '英語',
    });
    expect(assessment.defaults).toMatchObject({
      wakeTime: '07:00',
      sleepStartTime: '23:00',
      maxSessionMinutes: 90,
      breakMinutes: 15,
      bufferMinutes: 60,
      deepNightAllowed: true,
    });
  });
});
