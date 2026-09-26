import { getAiConfig, getAiConfigValidationMessage } from '../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type OpenAiCompatibleClient,
} from '../../services/ai/openAiCompatibleClient';
import type { UserPlanningContextRecordV1 } from './userPlanningContextTypes';
import {
  isUserContextRoutingDecisionResponse,
  type UserContextRoutingDecisionContext,
} from '../../../shared/userContextRoutingDecision';
import {
  createUserPlanningContextNaturalLanguageMessagesV2,
  parseUserPlanningContextNaturalLanguageResultV2,
  USER_PLANNING_CONTEXT_RESPONSE_FORMAT_V2,
  userPlanningContextExternalOwnerMessageV2,
  type UserPlanningContextNaturalLanguageResultV2,
} from './userPlanningContextNaturalLanguageV2Contract';

export {
  createUserPlanningContextNaturalLanguageMessagesV2,
  parseUserPlanningContextNaturalLanguageResultV2,
  USER_PLANNING_CONTEXT_RESPONSE_FORMAT_V2,
  userPlanningContextExternalOwnerMessageV2,
  type UserPlanningContextNaturalLanguageResultV2,
} from './userPlanningContextNaturalLanguageV2Contract';

function defaultClient(): OpenAiCompatibleClient {
  const aiConfig = getAiConfig();
  const configError = getAiConfigValidationMessage(aiConfig);
  if (aiConfig.provider === 'rules' || configError) {
    throw new Error(configError ?? 'AIによる内容整理を利用できません。');
  }
  return createOpenAiCompatibleClient(aiConfig);
}

function userContextRoutingRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `user-context-routing:${crypto.randomUUID()}`;
  }
  return `user-context-routing:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export async function interpretUserPlanningContextNaturalLanguageV2(params: {
  text: string;
  existingRecord?: UserPlanningContextRecordV1 | null;
  client?: OpenAiCompatibleClient;
}): Promise<UserPlanningContextNaturalLanguageResultV2> {
  const text = params.text.trim();
  if (!text) throw new Error('覚えておいてほしいことを入力してください。');
  if (text.length > 2000) throw new Error('覚えておく内容が長すぎます。');

  const decisionContext: UserContextRoutingDecisionContext = {
    purpose: 'user_context_routing',
    requestId: userContextRoutingRequestId(),
    // This settings operation has no planning-turn graph revision. The unique
    // requestId binds the response; the existing save path retains record ownership.
    inputRevision: 0,
    state: { currentUserText: text },
  };

  const raw = await (params.client ?? defaultClient()).createChatCompletion({
    decisionContext,
    purpose: 'user_context_interpreter',
    temperature: 0,
    maxCompletionTokens: 700,
    responseFormat: USER_PLANNING_CONTEXT_RESPONSE_FORMAT_V2,
    messages: createUserPlanningContextNaturalLanguageMessagesV2({
      text,
      existingRecord: params.existingRecord,
    }),
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('AIが覚える内容を整理できませんでした。');
  }
  if (isUserContextRoutingDecisionResponse(parsed)) {
    throw new Error(userPlanningContextExternalOwnerMessageV2(parsed.targetDomain));
  }
  return parseUserPlanningContextNaturalLanguageResultV2(parsed);
}
