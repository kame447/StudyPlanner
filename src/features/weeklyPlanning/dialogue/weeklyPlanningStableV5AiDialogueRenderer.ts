import { getAiConfig, type AiConfig } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type ChatMessage,
  type OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  rememberWeeklyPlanningDialogueRendererPromptContext,
} from '../trace/weeklyPlanningDialogueRendererTrace';
import {
  WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
  type WeeklyPlanningStableV5DialogueRenderInput,
  type WeeklyPlanningStableV5DialogueRenderResult,
  type WeeklyPlanningStableV5DialogueRenderer,
} from './weeklyPlanningStableV5DialogueContracts';
import {
  createWeeklyPlanningStableV5DialoguePrompt,
} from './weeklyPlanningStableV5DialoguePrompt';
import {
  parseWeeklyPlanningStableV5DialogueRendererResponse,
} from './weeklyPlanningStableV5DialogueValidation';

export {
  WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
} from './weeklyPlanningStableV5DialogueContracts';
export type {
  WeeklyPlanningStableV5DialogueActionKind,
  WeeklyPlanningStableV5DialogueConversationTurn,
  WeeklyPlanningStableV5DialogueFallbackReason,
  WeeklyPlanningStableV5DialogueRenderInput,
  WeeklyPlanningStableV5DialogueRenderResult,
  WeeklyPlanningStableV5DialogueRenderer,
} from './weeklyPlanningStableV5DialogueContracts';
export {
  createWeeklyPlanningStableV5DialoguePrompt,
  createWeeklyPlanningStableV5DialogueStateSummary,
} from './weeklyPlanningStableV5DialoguePrompt';

const REPEATED_QUESTION_REPAIR_INSTRUCTION = [
  '前回候補がrecentConversation内の直前assistant発話と同一でした。',
  'applicationDecisionの意味は変えず、直前と異なる自然な表現にしてください。',
  'ユーザーが質問の意味や理由を尋ねている場合は、必要な情報の目的を短く説明してから尋ね直してください。',
].join('');

const GROUNDING_ACK_REPAIR_INSTRUCTION = [
  '前回候補はcurrentTurnGroundingのACK契約を満たしていません。',
  'mode=required_before_resumeなら、acceptedFactsのうち会話上重要なFactをgroundingAcknowledgementに示し、',
  '最終textをその短いACK本文から始めてからapplicationDecisionの質問へ戻ってください。',
].join('');

function rendererPromptTraceContext(prompt: {
  systemPrompt: string;
  userPrompt: string;
}): Record<string, unknown> {
  const messages = [
    { role: 'system', content: prompt.systemPrompt },
    { role: 'user', content: prompt.userPrompt },
  ];
  return {
    messages,
    requestBytes: new TextEncoder().encode(JSON.stringify(messages)).byteLength,
  };
}

async function requestDialogueRender(params: {
  client: OpenAiCompatibleClient;
  input: WeeklyPlanningStableV5DialogueRenderInput;
  messages: ChatMessage[];
}): Promise<WeeklyPlanningStableV5DialogueRenderResult> {
  const rawResponse = await params.client.createChatCompletion({
    messages: params.messages,
    temperature: 0.4,
    responseFormat: WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
    purpose: 'weekly_planning_renderer',
  });
  return parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, params.input);
}

export function createAiWeeklyPlanningStableV5DialogueRenderer(
  config: AiConfig = getAiConfig(),
  client: OpenAiCompatibleClient = createOpenAiCompatibleClient(config),
): WeeklyPlanningStableV5DialogueRenderer {
  return {
    async render(input) {
      try {
        const prompt = createWeeklyPlanningStableV5DialoguePrompt(input);
        rememberWeeklyPlanningDialogueRendererPromptContext(
          input.actionId,
          rendererPromptTraceContext(prompt),
        );
        const baseMessages: ChatMessage[] = [
          { role: 'system', content: prompt.systemPrompt },
          { role: 'user', content: prompt.userPrompt },
        ];
        const initial = await requestDialogueRender({ client, input, messages: baseMessages });
        if (initial.status !== 'fallback') {
          return initial;
        }
        const repairInstruction = initial.reason === 'repeated_question_text'
          ? REPEATED_QUESTION_REPAIR_INSTRUCTION
          : initial.reason === 'grounding_contract_mismatch'
            ? GROUNDING_ACK_REPAIR_INSTRUCTION
            : null;
        if (!repairInstruction) return initial;
        return requestDialogueRender({
          client,
          input,
          messages: [
            ...baseMessages,
            { role: 'user', content: repairInstruction },
          ],
        });
      } catch {
        return { status: 'fallback', reason: 'provider_error', rawResponse: null };
      }
    },
  };
}
