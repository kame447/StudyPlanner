import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import { isWeeklyPlanningTurnDispatchRefusal } from '../application/weeklyPlanningTurnDispatchBudget';
import { getAiConfig, type AiConfig } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type ChatMessage,
  type OpenAiCompatibleClient,
  type JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import {
  rememberWeeklyPlanningDialogueRendererPromptContext,
} from '../trace/weeklyPlanningDialogueRendererTrace';
import {
  WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT,
  WEEKLY_PLANNING_CONSULTATION_DIALOGUE_RESPONSE_FORMAT,
  type WeeklyPlanningStableV5DialogueRenderInput,
  type WeeklyPlanningStableV5DialogueRenderResult,
  type WeeklyPlanningStableV5DialogueRenderer,
} from './weeklyPlanningStableV5DialogueContracts';
import {
  createWeeklyPlanningStableV5DialoguePrompt,
} from './weeklyPlanningStableV5DialoguePrompt';
import {
  parseWeeklyPlanningDialogueWithAcknowledgement,
} from './weeklyPlanningDialogueAcknowledgementComposition';

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

import {
  createReplyVerifierMessages,
  evaluateReplyVerifierResponse,
  literalRequirementFailures,
  WEEKLY_PLANNING_REPLY_VERIFIER_RESPONSE_FORMAT,
} from './weeklyPlanningReplyVerification';
import type { WeeklyPlanningMustConveyEntry } from './weeklyPlanningMustConvey';
import { bindWeeklyPlanningDialogueActionToken } from './weeklyPlanningDialogueActionToken';

import { hasUnverifiedWeeklyPlanningPreviewConstraints } from './weeklyPlanningPreviewConstraintClaims';

const UNVERIFIED_CONSTRAINT_REPAIR_INSTRUCTION = [
  '前回候補は未確認の条件を述べるか、ACK契約に違反していました。条件の説明はアプリが別途表示します。',
  '時刻・時間帯・時間数・回数や条件を満たすとの表現を避け、候補件数と操作を案内してください。',
  'ACKは具体値を繰り返さない中立的な受領文でよく、acceptedFactsの正しいfactIdsを参照し、最終textをそのACK本文から始めてください。',
].join('');

const CONSULTATION_FEASIBILITY_REPAIR_INSTRUCTION = [
  '前回候補の可否表明は相談の根拠と一致していません。feasibilityClaim=noneで書き直してください。',
  '未確認の希望について可能・大丈夫・できると断定せず、空き時間など何を確かめる必要があるかを短く説明し、候補で試す次の一歩を提案してください。',
  '予定を変えたとは書かず、ACKとcommunicationの残りの契約を保ってください。',
].join('');

const ALTERNATIVE_PROMOTION_REPAIR_INSTRUCTION = 'This is an unadopted what-if, not the current preview. Do not name or offer the promotion control. Answer the tested alternative, then invite the user to say if they want to adopt it. Keep the typed ACK and question contract.';

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

/**
 * Interaction architecture: the candidate stated a time or date the user's words, the facts and the listed free windows
 * do not contain (or misstated the candidate count / claimed an action that did not run). One regeneration, never a fixed text.
 */
const UNGROUNDED_TEXT_REPAIR_INSTRUCTION = [
  '前回候補には、ユーザーの発言・acceptedFacts・提示された空き時間のいずれにも無い日時の表現が含まれていました。',
  '日付と時刻は、ユーザーの言葉・Fact・空き時間として渡された値だけから述べてください。時刻は24時間表記（例: 20時から21時）で書き、「夜8時」のような言い方は避けてください。',
  '「1時間ずつ」のような時間の長さはそのまま使って構いません。候補の件数や実行していない操作を述べないでください。',
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

/** P2: the one regeneration after a failed verification; carries the typed verdict, never application prose. */
function verificationRepairInstruction(failure: unknown): string {
  return `The previous reply did not convey the required facts accurately (verification: ${JSON.stringify(failure)}). Rewrite it so it states every mustConvey figure and label exactly as given, and makes none of the forbidden claims. Keep the rest of the contract.`;
}

type ReplyVerification =
  | { ok: true }
  | { ok: false; kind: 'failed'; detail: unknown }
  | { ok: false; kind: 'unavailable' };

/** V3 (literal) then V2 (independent verifier call). Unclear is never a pass. */
async function verifyReply(params: {
  client: OpenAiCompatibleClient;
  text: string;
  entries: readonly WeeklyPlanningMustConveyEntry[];
}): Promise<ReplyVerification> {
  const literal = literalRequirementFailures(params.text, params.entries);
  if (literal.length > 0) return { ok: false, kind: 'failed', detail: { literal } };
  try {
    const raw = await params.client.createChatCompletion({
      messages: createReplyVerifierMessages({ entries: params.entries, text: params.text }),
      temperature: 0,
      responseFormat: WEEKLY_PLANNING_REPLY_VERIFIER_RESPONSE_FORMAT,
      purpose: 'weekly_planning_renderer',
    });
    const verdict = evaluateReplyVerifierResponse(raw, params.entries);
    if (verdict.ok) return { ok: true };
    return verdict.reason === 'malformed'
      ? { ok: false, kind: 'unavailable' }
      : { ok: false, kind: 'failed', detail: { failedCodes: verdict.failedCodes, forbidden: verdict.forbidden } };
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
}

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
  responseFormat: JsonSchemaResponseFormat;
}): Promise<WeeklyPlanningStableV5DialogueRenderResult> {
  const rawResponse = await params.client.createChatCompletion({
    messages: params.messages,
    temperature: 0.4,
    responseFormat: params.responseFormat,
    purpose: 'weekly_planning_renderer',
  });
  return parseWeeklyPlanningDialogueWithAcknowledgement(rawResponse, params.input);
}

export function createAiWeeklyPlanningStableV5DialogueRenderer(
  config: AiConfig = getAiConfig(),
  client: OpenAiCompatibleClient = createOpenAiCompatibleClient(config),
): WeeklyPlanningStableV5DialogueRenderer {
  return {
    async render(input) {
      try {
        const interaction = conversationArchitecturePolicy(input.conversationArchitecture).interactionOutcome;
        const responseFormat = interaction && input.communication?.consultation
          ? WEEKLY_PLANNING_CONSULTATION_DIALOGUE_RESPONSE_FORMAT
          : WEEKLY_PLANNING_STABLE_V5_DIALOGUE_RENDERER_RESPONSE_FORMAT;
        const bound = interaction ? bindWeeklyPlanningDialogueActionToken(input, responseFormat)
          : { input, responseFormat, actionBinding: null };
        const prompt = createWeeklyPlanningStableV5DialoguePrompt(bound.input);
        const promptContext = rendererPromptTraceContext(prompt);
        if (interaction) {
          promptContext.responseFormat = bound.responseFormat;
          promptContext.actionBinding = bound.actionBinding;
        }
        rememberWeeklyPlanningDialogueRendererPromptContext(input.actionId, promptContext);
        const baseMessages: ChatMessage[] = [
          { role: 'system', content: prompt.systemPrompt },
          { role: 'user', content: prompt.userPrompt },
        ];
        const initial = await requestDialogueRender({ client, input: bound.input, responseFormat: bound.responseFormat, messages: baseMessages });
        const mustConvey = interaction ? input.communication?.mustConvey ?? [] : [];
        /** P2: verify a rendered reply; one regeneration only while the shared repair slot is unused. */
        const verified = async (
          candidate: WeeklyPlanningStableV5DialogueRenderResult,
          repairUsed: boolean,
        ): Promise<WeeklyPlanningStableV5DialogueRenderResult> => {
          if (candidate.status !== 'rendered' || mustConvey.length === 0) return candidate;
          const first = await verifyReply({ client, text: candidate.text, entries: mustConvey });
          if (first.ok) return candidate;
          if (first.kind === 'unavailable') return { status: 'fallback', reason: 'verification_unavailable', rawResponse: candidate.rawResponse };
          if (repairUsed) return { status: 'fallback', reason: 'verification_failed', rawResponse: candidate.rawResponse };
          rememberWeeklyPlanningDialogueRendererPromptContext(input.actionId, {
            ...promptContext,
            repair: { reason: 'verification_failed', instruction: verificationRepairInstruction(first.detail) },
          });
          const rewritten = await requestDialogueRender({
            client,
            input: bound.input,
            responseFormat: bound.responseFormat,
            messages: [...baseMessages, { role: 'user', content: verificationRepairInstruction(first.detail) }],
          });
          if (rewritten.status !== 'rendered') return rewritten;
          const second = await verifyReply({ client, text: rewritten.text, entries: mustConvey });
          if (second.ok) return rewritten;
          return { status: 'fallback', reason: second.kind === 'unavailable' ? 'verification_unavailable' : 'verification_failed', rawResponse: rewritten.rawResponse };
        };
        if (initial.status !== 'fallback') {
          return await verified(initial, false);
        }
        const neutralConstraintRepair = interaction
          && hasUnverifiedWeeklyPlanningPreviewConstraints(input.communication?.previewConstraintSatisfaction);
        const repairInstruction = interaction && initial.reason === 'unadopted_alternative_promotion'
          ? ALTERNATIVE_PROMOTION_REPAIR_INSTRUCTION
          : interaction && initial.reason === 'unchecked_consultation_feasibility'
          ? CONSULTATION_FEASIBILITY_REPAIR_INSTRUCTION
          : interaction && (initial.reason === 'unverified_preview_constraint_claim'
            || (initial.reason === 'grounding_contract_mismatch' && neutralConstraintRepair))
            ? UNVERIFIED_CONSTRAINT_REPAIR_INSTRUCTION
            : interaction && initial.reason === 'ungrounded_text'
            ? UNGROUNDED_TEXT_REPAIR_INSTRUCTION
            : initial.reason === 'repeated_question_text'
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
        // Keep the original request plus the one appended instruction. The actual repair
        // request is reconstructible without storing the full conversation twice.
        if (interaction) rememberWeeklyPlanningDialogueRendererPromptContext(input.actionId, {
          ...promptContext,
          repair: { reason: initial.reason, instruction: repairInstruction },
        });
        // Awaited inside the try: a failed repair dispatch (provider error, exhausted pool or
        // an outage-gated renderer) must end in the deterministic fallback, never reject.
        return await verified(await requestDialogueRender({
          client,
          input: bound.input,
          responseFormat: bound.responseFormat,
          messages: [
            ...baseMessages,
            { role: 'user', content: repairInstruction },
          ],
        }), true);
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
