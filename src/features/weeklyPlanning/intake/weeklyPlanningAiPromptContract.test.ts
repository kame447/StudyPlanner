import { describe, expect, it } from 'vitest';
import { createSystemPrompt, WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT } from './weeklyPlanningAiInterpreter';

describe('weekly planning AI prompt contract', () => {
  it('uses generalized semantic principles and stays below the Worker message limit', () => {
    const prompt = createSystemPrompt();

    expect(prompt.length).toBeLessThan(6_000);
    expect(prompt).toContain('Decompose the current turn into independent semantic units');
    expect(prompt).toContain('Preserve predicate-argument structure and modifier attachment');
    expect(prompt).toContain('The response schema is the authoritative definition');
    expect(prompt).not.toContain('OSとネットワーク');
    expect(prompt).not.toContain('ヒューマンサイエンス');
    expect(prompt).not.toContain('バイトの後');
    expect(prompt).not.toContain('固定の予定って何ですか');
  });

  it('keeps command shape and vocabulary in the response schema rather than the prompt', () => {
    const schemaText = JSON.stringify(WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT);
    expect(schemaText).toContain('set_exam_scope');
    expect(schemaText).toContain('mark_completion_target');
    expect(schemaText).toContain('set_study_goal');
    expect(createSystemPrompt()).not.toContain('Command types you may emit');
  });
});
