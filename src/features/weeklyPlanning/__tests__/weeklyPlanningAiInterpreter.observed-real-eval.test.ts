import { describe, expect, it } from 'vitest';
import type { AiConfig } from '../../../lib/aiConfig';
import { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createAiWeeklyPlanningInterpreter } from '../intake/weeklyPlanningAiInterpreter';

const shouldRun = process.env.WEEKLY_PLANNING_REAL_AI_EVAL === '1';
const observedUserText = [
  '院試の過去問終わらせたいです',
  'OSとネットワークが一年分で、ヒューマンサイエンスが二年分あります',
  'あと研究の進捗生まないといけないので、3時ぐらいまでは研究の内容やらないといけないです',
].join('\n');

function proxyClient(
  proxyUrl: string,
  idToken: string,
  model: string,
): OpenAiCompatibleClient {
  return {
    async createChatCompletion({ messages, temperature = 0.1, responseFormat }) {
      const endpoint = proxyUrl.endsWith('/chat/completions')
        ? proxyUrl
        : `${proxyUrl.replace(/\/$/, '')}/chat/completions`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          messages,
          response_format: responseFormat,
        }),
      });
      const body = await response.json() as { content?: string; error?: string };
      if (!response.ok || !body.content?.trim()) {
        throw new Error(body.error || `AI proxy request failed with status ${response.status}.`);
      }
      return body.content.trim();
    },
  };
}

describe.skipIf(!shouldRun)(
  'weekly planning observed semantic segmentation real evaluation',
  () => {
    it('keeps exam fields, per-field workload, and research as separate meanings', async () => {
      const proxyUrl =
        process.env.WEEKLY_PLANNING_REAL_AI_EVAL_PROXY_URL?.trim()
        || getCloudflareAiProxyUrl();
      const idToken = process.env.WEEKLY_PLANNING_REAL_AI_EVAL_ID_TOKEN?.trim();
      const model =
        process.env.WEEKLY_PLANNING_REAL_AI_EVAL_MODEL?.trim()
        || 'gpt-5.4-nano-2026-03-17';

      if (!proxyUrl || !idToken) {
        console.info(
          '[weekly-planning-observed-real-eval] skipped: missing proxy URL or ID token',
        );
        expect(true).toBe(true);
        return;
      }

      const config: AiConfig = {
        provider: 'openai',
        baseUrl: '',
        model,
        apiKey: '',
      };
      const result = await createAiWeeklyPlanningInterpreter(
        config,
        proxyClient(proxyUrl, idToken, model),
      ).interpretUserTurn({
        userText: observedUserText,
        context: {
          selectedDate: '2026-07-21',
          planningDayCount: 7,
          currentDateTime: '2026-07-21T23:24:00',
        },
        stateSummary: {
          knownFields: [],
          confirmedSlots: ['planning_range'],
          planningRangeSummary: '2026-07-21T23:24:00〜2026-07-21T24:00:00',
          lastQuestions: [{
            slotKey: 'tasks_or_goals',
            intent: 'ask_tasks_or_goals',
          }],
        },
      });

      const commands = result.candidates.map((candidate) => candidate.command);
      const examScope = commands.find((command) => command.type === 'set_exam_scope');
      expect(examScope?.type).toBe('set_exam_scope');
      if (examScope?.type !== 'set_exam_scope') return;

      expect(examScope.scope.fields).toEqual([
        'OS',
        'ネットワーク',
        'ヒューマンサイエンス',
      ]);

      const targets = new Map(commands.flatMap((command) =>
        command.type === 'mark_completion_target'
          && command.target.kind === 'latest_n_years'
          ? [[command.field, command.target.count] as const]
          : [],
      ));
      expect(targets.get('OS')).toBe(1);
      expect(targets.get('ネットワーク')).toBe(1);
      expect(targets.get('ヒューマンサイエンス')).toBe(2);
      expect(commands.some((command) =>
        command.type === 'set_study_goal' && /研究/.test(command.goal.title),
      )).toBe(true);
      expect(examScope.scope.fields.some((field) =>
        /終わらせたい|研究|いけない|3時/.test(field),
      )).toBe(false);

      console.info('[weekly-planning-observed-real-eval]', JSON.stringify({
        model,
        input: observedUserText,
        rawResponse: result.rawResponse,
        commands,
      }, null, 2));
    }, 120000);
  },
);
