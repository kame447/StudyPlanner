import { describe, expect, it } from 'vitest';
import { parseRequestClarificationCommand } from './weeklyPlanningClarificationParsing';

describe('parseRequestClarificationCommand', () => {
  it.each([
    'どういうこと？',
    'それってどういう意味？',
    '何を答えればいいの？',
    '今の質問がよく分からない',
    '具体的には何を入力すればいい？',
    '固定の予定って何ですか？',
  ])('maps clarification phrasing to one command intent: %s', (userText) => {
    expect(parseRequestClarificationCommand(userText, { hasActiveQuestion: true })).toMatchObject({
      type: 'request_clarification',
      confidence: 'high',
    });
  });

  it.each([
    'もう少し詳しく説明して',
    'よく分からない',
  ])('accepts context-dependent follow-up only while a question is active: %s', (userText) => {
    expect(parseRequestClarificationCommand(userText)).toBeUndefined();
    expect(parseRequestClarificationCommand(userText, { hasActiveQuestion: true })?.type)
      .toBe('request_clarification');
  });

  it.each([
    '使える時間はまだ分からない',
    '数学を詳しく勉強したい',
    '来週の予定を立てたい',
  ])('does not misclassify information or planning turns: %s', (userText) => {
    expect(parseRequestClarificationCommand(userText, { hasActiveQuestion: true })).toBeUndefined();
  });
});
