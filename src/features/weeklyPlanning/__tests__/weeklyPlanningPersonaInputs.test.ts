import { describe, expect, it, test } from 'vitest';
import {
  assessWeeklyPlanningRequest,
  createSimpleWeeklyDraftBlocksFromText,
  looksLikeWeeklyPlanningRequest,
  mergeWeeklyPlanningRevision,
} from '../weeklyPlanningTransforms';
import { totalDraftMinutes } from '../testUtils/weeklyPlanningTestHelpers';

const SELECTED_DATE = '2026-06-19';
const USER_ID = 'user-1';

function joinedQuestions(text: string): string {
  return assessWeeklyPlanningRequest({
    selectedDate: SELECTED_DATE,
    text,
  }).questions.join('\n');
}

describe('P1/P7 P0 Quick set: ambiguous weekly planning intake', () => {
  it.skip('P1 P0-1 detects "来週勉強計画を作りたい" as weekly planning intent', () => {
    expect(looksLikeWeeklyPlanningRequest('来週勉強計画を作りたい')).toBe(true);
  });

  it('P1 P0-2 asks for missing subjects and target time instead of drafting', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: SELECTED_DATE,
      text: '来週勉強計画を作りたい',
    });

    expect(assessment.kind).toBe('needs_task_details');
    expect(assessment.tasks).toHaveLength(0);
    expect(assessment.questions.join('\n')).toMatch(/科目|タスク/);
    expect(assessment.questions.join('\n')).toMatch(/時間|目標/);
  });

  it.skip('P1/P4 P0-7 treats "時間は分からない" as unresolved input that can move to assumption confirmation', () => {
    const revision = mergeWeeklyPlanningRevision({
      selectedDate: SELECTED_DATE,
      previousText: '来週、数学の教科書を30ページ進めたい',
      revisionText: '時間は分からない',
    });

    expect(revision.kind).toBe('needs_time_estimate');
    expect(revision.questions.join('\n')).toMatch(/仮置き|仮見積もり|優先度/);
    expect(revision.confirmationSummary).toMatch(/assumption|仮定/);
  });
});

describe('P2/P4 P0 Quick set: material amount and unit-rate hearing', () => {
  it('P2/P4 P0-4 keeps 30 pages as scope and asks specifically for minutes per page', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: SELECTED_DATE,
      text: '数学の教科書を30ページ進めたい',
    });

    expect(assessment.kind).toBe('needs_time_estimate');
    expect(assessment.tasks[0]).toMatchObject({
      amount: { unit: 'pages', value: 30, text: '30ページ', daily: false },
      requiresTimeEstimate: true,
    });
    expect(assessment.questions.join('\n')).toMatch(/1ページ.*何分|ページ.*何分/);
  });

  it.skip('P2/P4 P0-5 keeps 300 vocabulary words as scope and asks for unit time or placeholder estimate', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: SELECTED_DATE,
      text: '英単語を300個覚えたい',
    });

    expect(assessment.kind).toBe('needs_time_estimate');
    expect(assessment.tasks[0]).toMatchObject({
      title: '英単語',
      amount: { unit: 'words', value: 300, daily: false },
      requiresTimeEstimate: true,
    });
    expect(assessment.questions.join('\n')).toMatch(/何個.*何分|単位時間|仮置き/);
  });

  it.skip('P2/P7 P0-6 keeps "固有値" as a unit topic and asks for range, material, or goal', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: SELECTED_DATE,
      text: '線形代数の固有値をやりたい',
    });

    expect(assessment.kind).toBe('needs_time_estimate');
    expect(assessment.tasks[0]).toMatchObject({
      title: expect.stringContaining('固有値'),
      requiresTimeEstimate: true,
    });
    expect(assessment.tasks[0].amount.text).toContain('固有値');
    expect(assessment.questions.join('\n')).toMatch(/範囲|教材|目標/);
  });

  it('P2/P4 P1-9 keeps problem count as scope and asks specifically for minutes per problem', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: SELECTED_DATE,
      text: '演習問題を20問解きたい',
    });

    expect(assessment.kind).toBe('needs_time_estimate');
    expect(assessment.tasks[0]).toMatchObject({
      amount: { unit: 'problems', value: 20, text: '20問', daily: false },
      requiresTimeEstimate: true,
    });
    expect(assessment.questions.join('\n')).toMatch(/1問.*何分|問題.*何分/);
  });
});

describe('P5/P7 P0 Quick set: exam prep and OCR fixture intake', () => {
  const geminiOcrExamScheduleText = [
    '7/4 数学 線形代数 第1章〜第4章 60分',
    '7/6 英語 単語1-800 長文3題 50分',
    '7/8 計算理論 オートマトン・正規表現・CFG 90分',
  ].join('\n');

  it.skip('P1/P5 P0-3 detects "テスト対策したい" as study planning intent and asks for exam information', () => {
    expect(looksLikeWeeklyPlanningRequest('テスト対策したい')).toBe(true);
    expect(joinedQuestions('テスト対策したい')).toMatch(/試験日|予定表|範囲表|科目/);
  });

  it.skip('P5/P4 P0-8 extracts subjects, exam dates, and ranges from OCR-ready fixture text', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: SELECTED_DATE,
      text: `テスト対策したい。予定表貼る\n${geminiOcrExamScheduleText}`,
    });

    expect(assessment.tasks.map((task) => task.title)).toEqual([
      '数学',
      '英語',
      '計算理論',
    ]);
    expect(assessment.tasks.map((task) => task.deadlineDate)).toEqual([
      '2026-07-04',
      '2026-07-06',
      '2026-07-08',
    ]);
    expect(assessment.tasks.map((task) => task.amount.text)).toEqual([
      expect.stringContaining('第1章'),
      expect.stringContaining('単語1-800'),
      expect.stringContaining('オートマトン'),
    ]);
  });

  it.skip('P5/P7 P0-9 does not finalize draft when OCR fixture lacks exam dates', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: SELECTED_DATE,
      text: [
        'テスト範囲表',
        '数学 線形代数 第1章〜第4章',
        '英語 単語1-800 長文3題',
      ].join('\n'),
    });

    expect(assessment.kind).not.toBe('ready');
    expect(assessment.questions.join('\n')).toMatch(/試験日|日程/);
  });

  it.skip('P5/P7 P0-10 asks current progress before finalizing exam prep plans', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: SELECTED_DATE,
      text: `テスト対策したい。予定表貼る\n${geminiOcrExamScheduleText}`,
    });

    expect(assessment.kind).not.toBe('ready');
    expect(assessment.questions.join('\n')).toMatch(/現在|進捗|どこまで|未着手/);
  });
});

describe('P2/P6 P0 Quick set: multi-turn follow-up and false positive prevention', () => {
  it('P2/P6 P0-15 does not route duration-only text to weekly planning in normal mode', () => {
    expect(looksLikeWeeklyPlanningRequest('英語を3時間、計算理論を4時間')).toBe(false);
  });

  it('P2/P4 P0-16 accepts duration-only text as follow-up while weekly planning is pending', () => {
    const followUp = mergeWeeklyPlanningRevision({
      selectedDate: SELECTED_DATE,
      previousText: '来週勉強計画を作りたい',
      revisionText: '英語を3時間、計算理論を4時間',
    });

    expect(followUp.tasks.map((task) => [task.title, task.durationMinutes])).toEqual([
      ['英語', 180],
      ['計算理論', 240],
    ]);
    expect(followUp.kind).toBe('needs_confirmation');
  });

  it('P4 P0-17 keeps the 720 minute total for explicit weekly duration input', () => {
    const blocks = createSimpleWeeklyDraftBlocksFromText({
      userId: USER_ID,
      selectedDate: SELECTED_DATE,
      text: '来週、英語を8時間、計算理論を4時間',
    });

    expect(totalDraftMinutes(blocks)).toBe(720);
  });

  it('P4/P6 P0-18 splits sessions over 120 minutes and avoids blocks under 30 minutes', () => {
    const blocks = createSimpleWeeklyDraftBlocksFromText({
      userId: USER_ID,
      selectedDate: SELECTED_DATE,
      text: '来週、英語を8時間、計算理論を4時間',
    });
    const durations = blocks.map((block) => {
      const [startHour, startMinute] = block.startTime.split(':').map(Number);
      const [endHour, endMinute] = block.endTime.split(':').map(Number);
      return endHour * 60 + endMinute - (startHour * 60 + startMinute);
    });

    expect(durations.every((duration) => duration <= 120)).toBe(true);
    expect(durations.every((duration) => duration >= 30)).toBe(true);
  });

  test.each([
    ['P6 P0-13', '英語の勉強法を教えて'],
    ['P6 P0-14', '英単語の覚え方を教えて'],
    ['P6 P0-25', '明日14時から歯医者'],
  ])('%s keeps "%s" out of weekly planning routing', (_id, input) => {
    expect(looksLikeWeeklyPlanningRequest(input)).toBe(false);
    expect(
      createSimpleWeeklyDraftBlocksFromText({
        userId: USER_ID,
        selectedDate: SELECTED_DATE,
        text: input,
      }),
    ).toEqual([]);
  });
});

describe('P7/P4 P0 Quick set: replanning and invalid values', () => {
  it.skip('P7 P0-11 treats "英語をもっと増やして" as a revision request that asks for the amount to change', () => {
    const revision = mergeWeeklyPlanningRevision({
      selectedDate: SELECTED_DATE,
      previousText: '来週、英語を4時間、数学を3時間',
      revisionText: '英語をもっと増やして',
    });

    expect(revision.questions.join('\n')).toMatch(/どれくらい|何時間|増やす量/);
  });

  it.skip('P7 P0-12 asks what to fix for "なんか違う" instead of silently reusing the old draft', () => {
    const revision = mergeWeeklyPlanningRevision({
      selectedDate: SELECTED_DATE,
      previousText: '来週、英語を4時間、数学を3時間',
      revisionText: 'なんか違う',
    });

    expect(revision.questions.join('\n')).toMatch(/どこ|何を|修正したい|違う点/);
  });

  it('P3 P0-19 zero hours does not create confirmed weekly blocks from "来週、英語を0時間"', () => {
    expect(
      createSimpleWeeklyDraftBlocksFromText({
        userId: USER_ID,
        selectedDate: SELECTED_DATE,
        text: '来週、英語を0時間',
      }),
    ).toHaveLength(0);
  });

  test.skip.each([
    ['P3 P0-19 negative hours', '来週、英語を-1時間'],
    ['P3 P0-19 extreme hours', '来週、卒研を999時間'],
  ])('%s does not create confirmed weekly blocks from "%s"', (_id, input) => {
    expect(
      createSimpleWeeklyDraftBlocksFromText({
        userId: USER_ID,
        selectedDate: SELECTED_DATE,
        text: input,
      }),
    ).toHaveLength(0);
  });

  it.todo(
    'P4/P5 P0-21 prevents double-submit from creating duplicate pending contexts',
  );
  it.todo(
    'P4/P7 P0-22 keeps an assumption on plans created from placeholder estimates',
  );
  it.todo(
    'P5/P4 P0-23 keeps existing plans, timetable constraints, and buffer constraints during revision',
  );
  it.todo('P4/P6 P0-24 keeps drafts unsaved until explicit approval');
  it.todo(
    'P7 P1-36 creates a change proposal instead of directly mutating approved plans',
  );
});
