import { describe, expect, it } from 'vitest';
import { parseRequestClarificationCommand } from './weeklyPlanningClarificationParsing';

const renderedQuestionContext = {
  hasActiveQuestion: true,
  activeQuestionSource: 'rendered' as const,
};

describe('parseRequestClarificationCommand', () => {
  it.each([
    'どういうこと？',
    'それってどういう意味？',
    '何を答えればいいの？',
    '今の質問がよく分からない',
    '具体的には何を入力すればいい？',
    '固定の予定って何ですか？',
  ])('maps clarification phrasing to one command intent: %s', (userText) => {
    expect(parseRequestClarificationCommand(userText, renderedQuestionContext)).toMatchObject({
      type: 'request_clarification',
      confidence: 'high',
    });
  });

  it.each([
    'もう少し詳しく説明して',
    'よく分からない',
  ])('accepts contextual follow-up only after an actually rendered question: %s', (userText) => {
    expect(parseRequestClarificationCommand(userText)).toBeUndefined();
    expect(parseRequestClarificationCommand(userText, { hasActiveQuestion: true })).toBeUndefined();
    expect(parseRequestClarificationCommand(userText, renderedQuestionContext)?.type)
      .toBe('request_clarification');
  });

  it.each([
    '使える時間はまだ分からない',
    '数学を詳しく勉強したい',
    '来週の予定を立てたい',
  ])('does not misclassify information or planning turns: %s', (userText) => {
    expect(parseRequestClarificationCommand(userText, renderedQuestionContext)).toBeUndefined();
  });
});
