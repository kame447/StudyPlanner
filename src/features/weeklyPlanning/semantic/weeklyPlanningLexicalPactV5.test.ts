import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningSemanticBaseMessagesV5 } from './weeklyPlanningSemanticPromptAssemblyV5';
import { createWeeklyPlanningStableV5DialoguePrompt } from '../dialogue/weeklyPlanningStableV5AiDialogueRenderer';

describe('Stable V5 lexical pact contracts', () => {
  it('tells semantic interpretation to retain established partner-specific labels for existing entities', () => {
    const messages = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: 'それを30分やる',
      recentConversation: [
        { role: 'user', content: '共テ模試の数学をやりたい' },
        { role: 'assistant', content: '共テ模試の数学ですね。' },
      ],
      publicStateSummary: {
        tasks: [{ publicId: 'task-1', category: 'study', title: '共テ模試の数学' }],
      },
    });

    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toContain('partner-specific');
    expect(system).toContain('title/contextLabel');
    expect(system).toContain('unless the user renames it');
  });

  it('carries the established user-facing label into renderer decided facts and relevant labels unchanged', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt({
      actionId: 'action-1',
      currentUserMessage: 'それでお願い',
      recentConversation: [],
      planningInformation: {
        tasks: [{ id: 'task-1', title: '共テ模試の数学', category: 'study' }],
      },
      actionKind: 'status',
      questionCode: null,
      requiredLabels: ['共テ模試の数学'],
      fallbackText: '共テ模試の数学の条件を確認しました。',
      previewCount: 0,
    });

    expect(prompt.userPrompt).toContain('共テ模試の数学');
    expect(prompt.userPrompt).not.toContain('共通テスト模擬試験');
  });
});
