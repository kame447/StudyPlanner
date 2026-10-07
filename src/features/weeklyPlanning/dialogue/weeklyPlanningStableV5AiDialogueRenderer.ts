import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import { isWeeklyPlanningTurnDispatchRefusal } from '../application/weeklyPlanningTurnDispatchBudget';
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

const REPEATED_QUESTION_REPAIR_PREFIX = [
  '前回候補がrecentConversation内の直前assistant発話と同一でした。',
  'applicationDecisionの意味は変えず、直前と異なる自然な表現にしてください。',
].join('');

const REPEATED_QUESTION_REPAIR_INSTRUCTION = [
  REPEATED_QUESTION_REPAIR_PREFIX,
  'applicationDecision.communication.goalがexplain_questionの場合は、最初に（required_before_resumeならACKのすぐ後に）なぜその情報が必要かに答えてから尋ね直してください。',
].join('');

/** Interaction architecture: the candidate did not ask the question it had to ask. */
const MISSING_QUESTION_REPAIR_INSTRUCTION = [
  '前回候補には質問がありませんでした。applicationDecision.communication.askQuestion=trueです。',
  'goalの内容は保ったまま、questionIntentの質問を「？」で終わる形で一度だけ入れてください。',
].join('');

/** Interaction architecture: the candidate claimed new candidates although none were made. */
const PREVIEW_CLAIM_REPAIR_INSTRUCTION = [
  '前回候補は、このturnでは新しい仮予定の候補ができていないのに、できた・変わったと書いていました。',
  'applicationDecisionの内容は保ったまま、候補ができた・変わったとは書かず、候補の中身にも触れずに書き直してください。',
].join('');

/** Interaction architecture: the candidate talked about the app's internals. */
const INTERNAL_PROCESS_REPAIR_INSTRUCTION = [
  '前回候補には、アプリ内部の仕組みや処理を表す言葉が含まれていました。',
  'applicationDecisionの意味は変えず、内部の仕組みや処理に触れない、人どうしの会話として自然な日本語で書き直してください。',
].join('');

/** Legacy architecture (verbatim pre-#488): the renderer reads the raw message to decide. */
const LEGACY_REPEATED_QUESTION_REPAIR_INSTRUCTION = [
  REPEATED_QUESTION_REPAIR_PREFIX,
  'ユーザーが質問の意味や理由を尋ねている場合は、必要な情報の目的を短く説明してから尋ね直してください。',
].join('');

const GROUNDING_ACK_REPAIR_PREFIX = [
  '前回候補はcurrentTurnGroundingのACK契約を満たしていません。',
  'mode=required_before_resumeなら、acceptedFactsのうち会話上重要なFactをgroundingAcknowledgementに示し、',
  'そのFactに時刻・日付・数量などユーザーが明示した具体値がある場合はACK本文でもその具体値を落とさず、',
].join('');

const GROUNDING_ACK_REPAIR_INSTRUCTION = [
  GROUNDING_ACK_REPAIR_PREFIX,
  '最終textをその短いACK本文から始めてからapplicationDecisionの質問へ戻ってください。',
].join('');

/**
 * Interaction architecture: after the acknowledgement the reply still does what its typed goal
 * says (for example, explains why the question is needed before asking it again).
 */
const INTERACTION_GROUNDING_ACK_REPAIR_INSTRUCTION = [
  GROUNDING_ACK_REPAIR_PREFIX,
  '最終textをその短いACK本文から始め、そのあとapplicationDecision.communication.goalの内容を続けてください。',
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
        const interaction = conversationArchitecturePolicy(input.conversationArchitecture).interactionOutcome;
        const repairInstruction = initial.reason === 'repeated_question_text'
          ? (interaction
              ? REPEATED_QUESTION_REPAIR_INSTRUCTION
              : LEGACY_REPEATED_QUESTION_REPAIR_INSTRUCTION)
          : initial.reason === 'grounding_contract_mismatch'
            ? (interaction
                ? INTERACTION_GROUNDING_ACK_REPAIR_INSTRUCTION
                : GROUNDING_ACK_REPAIR_INSTRUCTION)
            : initial.reason === 'internal_process_text'
              ? INTERNAL_PROCESS_REPAIR_INSTRUCTION
              : initial.reason === 'missing_question'
                ? MISSING_QUESTION_REPAIR_INSTRUCTION
                : initial.reason === 'preview_claim_without_preview'
                  ? PREVIEW_CLAIM_REPAIR_INSTRUCTION
                  : null;
        if (!repairInstruction) return initial;
        // Awaited inside the try: a failed repair dispatch (provider error, exhausted pool or
        // an outage-gated renderer) must end in the deterministic fallback, never reject.
        return await requestDialogueRender({
          client,
          input,
          messages: [
            ...baseMessages,
            { role: 'user', content: repairInstruction },
          ],
        });
      } catch (error) {
        return {
          status: 'fallback',
          reason: isWeeklyPlanningTurnDispatchRefusal(error) ? 'dispatch_refused' : 'provider_error',
          rawResponse: null,
        };
      }
    },
  };
}
