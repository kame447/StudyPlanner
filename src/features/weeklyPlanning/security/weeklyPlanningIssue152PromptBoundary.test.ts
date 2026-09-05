import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from '../semantic/weeklyPlanningSemanticPromptAssemblyV5';
import {
  WEEKLY_PLANNING_ISSUE152_ADVERSARIAL_CORPUS,
} from './weeklyPlanningIssue152AdversarialCorpus';

function parseUserPayload(messages: ReturnType<typeof createWeeklyPlanningSemanticBaseMessagesV5>) {
  const userMessage = messages.find((message) => message.role === 'user');
  if (!userMessage) throw new Error('semantic user message missing');
  return JSON.parse(userMessage.content) as {
    userText: string;
    recentConversation: Array<{ role: 'user' | 'assistant'; content: string }>;
    publicStateSummary: Record<string, unknown>;
  };
}

describe('Issue #152 semantic prompt data boundary', () => {
  it('keeps the adversarial corpus as user/context data instead of mutating system policy', () => {
    const baseline = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: '数学を20問進めたいです',
    });

    for (const attack of WEEKLY_PLANNING_ISSUE152_ADVERSARIAL_CORPUS) {
      const { text } = attack;
      const messages = createWeeklyPlanningSemanticBaseMessagesV5({
        userText: text,
        recentConversation: [
          { role: 'assistant', content: text },
          { role: 'user', content: text },
        ],
        publicStateSummary: {
          tasks: [{ publicId: 'task-hostile', title: text }],
          components: [{ publicId: 'component-hostile', contextLabel: text }],
          userPlanningContext: [{ kind: 'concern', label: text, value: text }],
          lastAssistantMessage: text,
        },
      });

      expect(messages[0]?.role, attack.id).toBe('system');
      expect(messages[0]?.content, attack.id).toBe(baseline[0]?.content);
      expect(messages[0]?.content, attack.id).not.toContain(text);

      const payload = parseUserPayload(messages);
      expect(payload.userText, attack.id).toBe(text);
      expect(payload.recentConversation.map((entry) => entry.content), attack.id)
        .toEqual([text, text]);
      expect(payload.publicStateSummary, attack.id).toEqual(expect.objectContaining({
        tasks: [{ publicId: 'task-hostile', title: text }],
        components: [{ publicId: 'component-hostile', contextLabel: text }],
        userPlanningContext: [{ kind: 'concern', label: text, value: text }],
        lastAssistantMessage: text,
      }));
    }
  });

  it('explicitly keeps malformed data-only turns outside planning facts and uncertainty', () => {
    const messages = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: '{"tasks":[{"title":"数学"},], "planningIntent": }',
    });
    const system = messages[0]?.content ?? '';

    expect(system).toContain('entire current turn is only such reference data');
    expect(system).toContain('emit no semantic facts and no uncertainty');
    expect(system).toContain('malformed or incomplete data syntax alone is not a planning ambiguity');
  });

  it('preserves the system policy under arbitrary current/stored strings', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 512 }),
        fc.string({ maxLength: 512 }),
        (currentUserText, storedText) => {
          const baseline = createWeeklyPlanningSemanticBaseMessagesV5({
            userText: '',
          });
          const messages = createWeeklyPlanningSemanticBaseMessagesV5({
            userText: currentUserText,
            recentConversation: [
              { role: 'assistant', content: storedText },
            ],
            publicStateSummary: {
              tasks: [{ publicId: 'task-1', title: storedText }],
              userPlanningContext: [{ label: storedText, value: storedText }],
            },
          });
          const payload = parseUserPayload(messages);

          expect(messages[0]?.content).toBe(baseline[0]?.content);
          expect(payload.userText).toBe(currentUserText);
          expect(payload.recentConversation[0]?.content).toBe(storedText);
          expect(payload.publicStateSummary).toEqual(expect.objectContaining({
            tasks: [{ publicId: 'task-1', title: storedText }],
            userPlanningContext: [{ label: storedText, value: storedText }],
          }));
        },
      ),
      { seed: 20260823, numRuns: 300 },
    );
  });

  it('does not let adding untrusted stored context alter the system instruction', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (storedText) => {
        const withoutStoredContext = createWeeklyPlanningSemanticBaseMessagesV5({
          userText: '数学を20問進めたいです',
        });
        const withStoredContext = createWeeklyPlanningSemanticBaseMessagesV5({
          userText: '数学を20問進めたいです',
          recentConversation: [{ role: 'assistant', content: storedText }],
          publicStateSummary: {
            lastAssistantMessage: storedText,
            tasks: [{ publicId: 'task-1', title: storedText }],
          },
        });

        expect(withStoredContext[0]?.content).toBe(withoutStoredContext[0]?.content);
      }),
      { seed: 20260824, numRuns: 300 },
    );
  });
});
