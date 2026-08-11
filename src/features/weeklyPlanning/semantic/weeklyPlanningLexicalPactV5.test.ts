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
    expect(system).toContain('do not expand');
  });

  it('tells the dialogue renderer to reuse decided user-facing labels instead of formalizing them', () => {
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

    expect(prompt.systemPrompt).toContain('ユーザーとの会話で確立した呼び方');
    expect(prompt.systemPrompt).toContain('勝手に正式名称へ言い換え');
  });
});
