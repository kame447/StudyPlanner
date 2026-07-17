import { getAiConfig, type AiConfig } from '../../../lib/aiConfig';
import {
  createOpenAiCompatibleClient,
  type JsonSchemaResponseFormat,
  type OpenAiCompatibleClient,
} from '../../../services/ai/openAiCompatibleClient';
import {
  validateBehaviorAwareDialogueResponseClosed,
} from './weeklyPlanningBehaviorAwareDialogueValidation';
import {
  decideDialogueRepairPolicy,
  deriveGroundedAcknowledgementSummaries,
  isAcknowledgementGrounded,
  renderGroundedAcknowledgement,
  type DialogueRepairPolicy,
} from './weeklyPlanningDialogueRepairPolicy';
import type {
  AllowedDialogueAction,
  BehaviorAwareDialogueResponse,
  PlanningHypothesisSnapshot,
} from '../planning/weeklyPlanningBehaviorTypes';

export interface BehaviorAwareClarificationRequest {
  explanation: string;
  targetSlot?: string;
  intent?: string;
}

export interface BehaviorAwareDialoguePlannerInput {
  snapshot: PlanningHypothesisSnapshot;
  allowedActions: AllowedDialogueAction[];
  acceptedFacts: {
    taskLabels: string[];
    planningPeriodLabel?: string;
    constraintSummary: string[];
    knownFixedEventSummaries?: string[];
  };
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  previewAllowed: boolean;
  clarificationRequest?: BehaviorAwareClarificationRequest;
}

export interface BehaviorAwareDialoguePlannerResult {
  message: string;
  response: BehaviorAwareDialogueResponse | null;
  source: 'ai' | 'deterministic_fallback';
  /** 実際にユーザーへ表示した質問・確認action。候補actionから推測しない。 */
  renderedActionIds?: string[];
}

function stringSchema(): Record<string, unknown> {
  return { type: 'string' };
}

export const WEEKLY_PLANNING_BEHAVIOR_DIALOGUE_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_behavior_dialogue',
    strict: false,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['selectedActionIds', 'items'],
      properties: {
        acknowledgement: stringSchema(),
        selectedActionIds: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: stringSchema(),
        },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['actionId', 'text'],
            properties: {
              actionId: stringSchema(),
              text: stringSchema(),
              optionIds: {
                type: 'array',
                uniqueItems: true,
                items: stringSchema(),
              },
            },
          },
        },
        reasoningSummary: stringSchema(),
      },
    },
  },
};

function createSystemPrompt(): string {
  return [
    'You are the Japanese dialogue planner for a study-planning application.',
    'Return only JSON matching the response schema.',
    'The deterministic application core has already decided every action you may perform.',
    'Select only actionId values in allowedActions. Never invent an action, option, fact, deadline, time, proposal, or scheduling result.',
    'Use one or two substantive actions in normal turns and never more than three.',
    'Every selectedActionId must have exactly one matching items entry.',
    'The application renders grounded acknowledgement from accepted state. Do not invent an acknowledgement. If you include one, repeat only facts explicitly present in acceptedFacts.',
    'When dialoguePolicy.mode is explicit_repair, address only dialoguePolicy.targetTopicId. Do not ask an unrelated question.',
    'When dialoguePolicy.mode is pass_over, do not ask deferredTopicIds in this turn. Continue using only the remaining allowed action.',
    'When a safe default or finite options are allowed, present those before asking an unrestricted free-answer question.',
    'Do not add vague filler such as 「ここまでの内容から、無理のない進め方を整理します」 when no concrete planning hypothesis exists.',
    'When clarificationRequest is present, explain the previous question, give one concrete answer example, and re-ask only that target.',
    'Do not expose internal names such as readiness, blockingDimensions, reasonCode, suitability, sourceFactRefs, proposalRef, or slotKey.',
    'Do not claim that a plan was saved, confirmed, registered, or added. A preview is not a saved plan.',
    'Do not claim preview generation unless generate_preview is present in allowedActions.',
    'When acceptedFacts.knownFixedEventSummaries is non-empty, use only those exact saved plans when asking about additional fixed events. Never invent an event.',
    'Keep the tone like a calm, practical tutor. Keep each item concise and easy to correct.',
  ].join('\n');
}

function clarificationTopicId(targetSlot: string | undefined): string | undefined {
  switch (targetSlot) {
    case 'planning_period':
    case 'planning_start_date':
      return 'planning-range';
    case 'tasks_or_goals':
      return 'task-identity';
    case 'unit_rate':
    case 'unit_duration_estimate':
      return 'workload-estimate';
    case 'fixed_events':
    case 'sleep_cycle':
    case 'meal_bath_constraints':
    case 'life_constraints':
      return 'availability-basis';
    default:
      return undefined;
  }
}

function uniqueActions(actions: AllowedDialogueAction[]): AllowedDialogueAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.actionId)) return false;
    seen.add(action.actionId);
    return true;
  });
}

function repairPolicyForInput(
  input: BehaviorAwareDialoguePlannerInput,
): DialogueRepairPolicy {
  return decideDialogueRepairPolicy({
    snapshot: input.snapshot,
    clarificationTopicId: clarificationTopicId(input.clarificationRequest?.targetSlot),
  });
}

function prioritizeExplicitRepair(
  input: BehaviorAwareDialoguePlannerInput,
  policy: DialogueRepairPolicy,
): BehaviorAwareDialoguePlannerInput {
  const substantive = input.allowedActions.filter((action) => action.kind !== 'acknowledge_fact');
  const targetAction = policy.targetTopicId
    ? substantive.find((action) => action.topicId === policy.targetTopicId)
    : substantive[0];
  if (!targetAction) return input;
  return {
    ...input,
    allowedActions: [targetAction],
  };
}

function prioritizePassOver(
  input: BehaviorAwareDialoguePlannerInput,
  policy: DialogueRepairPolicy,
): BehaviorAwareDialoguePlannerInput {
  const deferred = new Set(policy.deferredTopicIds);
  const retained = input.allowedActions.filter((action) =>
    action.kind === 'acknowledge_fact'
    || action.kind === 'suggest_draft_generation'
    || action.kind === 'generate_preview'
    || action.kind === 'report_infeasibility'
    || !deferred.has(action.topicId),
  );
  return {
    ...input,
    allowedActions: retained.length > 0 ? retained : input.allowedActions,
  };
}

function prioritizeDialogueInput(
  input: BehaviorAwareDialoguePlannerInput,
  policy: DialogueRepairPolicy,
): BehaviorAwareDialoguePlannerInput {
  if (policy.mode === 'explicit_repair') {
    return prioritizeExplicitRepair(input, policy);
  }
  if (policy.mode === 'pass_over') {
    return prioritizePassOver(input, policy);
  }

  if (input.acceptedFacts.taskLabels.length > 0) return input;
  const taskIdentityAction = input.allowedActions.find((action) =>
    action.kind === 'ask_required_fact' && action.topicId === 'task-identity',
  );
  if (!taskIdentityAction) return input;

  const acknowledgementActions = input.allowedActions.filter(
    (action) => action.kind === 'acknowledge_fact',
  );
  const planningRangeAction = input.allowedActions.find(
    (action) => action.topicId === 'planning-range',
  );
  return {
    ...input,
    allowedActions: uniqueActions([
      ...acknowledgementActions,
      ...(planningRangeAction ? [planningRangeAction] : []),
      taskIdentityAction,
    ]).slice(0, 3),
  };
}

function createUserPrompt(
  input: BehaviorAwareDialoguePlannerInput,
  policy: DialogueRepairPolicy,
): string {
  return JSON.stringify({
    acceptedFacts: input.acceptedFacts,
    clarificationRequest: input.clarificationRequest,
    dialoguePolicy: policy,
    planningHypothesis: {
      taskProfiles: input.snapshot.taskProfiles.map((profile) => ({
        taskRef: profile.taskRef,
        activityKind: profile.activityKind,
        distributionPolicy: profile.distributionPolicy,
        cognitiveLoad: profile.cognitiveLoad,
      })),
      lifeActivityAnchors: input.snapshot.lifeActivityAnchors.map((anchor) => ({
        anchorId: anchor.anchorId,
        kind: anchor.kind,
        date: anchor.date,
        startTime: anchor.startTime,
        endTime: anchor.endTime,
      })),
      opportunityAnnotations: input.snapshot.opportunityAnnotations.map((annotation) => ({
        availabilityRangeRef: annotation.availabilityRangeRef,
        tags: annotation.tags,
      })),
      suggestedNextAction: input.snapshot.suggestedNextAction,
    },
    allowedActions: input.allowedActions.map((action) => ({
      actionId: action.actionId,
      kind: action.kind,
      topicId: action.topicId,
      allowedProposalRefs: action.allowedProposalRefs,
      allowedOptionIds: action.allowedOptionIds,
      maxItems: action.maxItems,
      displayHint: action.displayHint,
    })),
    recentConversation: input.recentConversation?.slice(-6),
    previewAllowed: input.previewAllowed,
    styleConstraints: {
      language: 'ja',
      tone: 'practical_tutor',
      maxItems: 3,
      preferredItems: 2,
    },
  });
}

function parseResponse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function groundedAcknowledgement(
  input: BehaviorAwareDialoguePlannerInput,
  response?: BehaviorAwareDialogueResponse,
): string | undefined {
  const summaries = deriveGroundedAcknowledgementSummaries({
    acceptedFacts: input.acceptedFacts,
    recentConversation: input.recentConversation,
  });
  const deterministic = renderGroundedAcknowledgement(summaries);
  if (deterministic) return deterministic;
  return isAcknowledgementGrounded({
    acknowledgement: response?.acknowledgement,
    acceptedFacts: input.acceptedFacts,
  })
    ? response?.acknowledgement?.trim()
    : undefined;
}

function composeMessage(
  response: BehaviorAwareDialogueResponse,
  input: BehaviorAwareDialoguePlannerInput,
): string {
  return [
    groundedAcknowledgement(input, response),
    ...response.items.map((item) => item.text),
    response.reasoningSummary,
  ].filter((part): part is string => Boolean(part?.trim())).join('\n');
}

function clarificationExample(targetSlot: string | undefined): string {
  switch (targetSlot) {
    case 'planning_start_date':
      return '例えば「来週の月曜日から」のように、開始したい日を答えてください。';
    case 'planning_period':
      return '例えば「来週」のように対象週を答えてください。週の始まりは保存済みの設定を使います。';
    case 'tasks_or_goals':
      return '例えば「英単語を80語と数学のワークを20ページ」のように答えてください。';
    case 'unit_rate':
    case 'unit_duration_estimate':
      return '例えば「1ページ10分くらい」のように、おおよその時間を答えてください。';
    case 'fixed_events':
      return '例えば「土曜日の14時から16時は予定があります」または「ほかにはありません」のように答えてください。';
    case 'sleep_cycle':
      return '例えば「0時に寝て7時に起きます」のように答えてください。';
    case 'meal_bath_constraints':
      return '例えば「夕食は19時、お風呂は22時ごろです」のように答えてください。';
    case 'life_constraints':
    case 'availability_basis':
    case 'feasibility_basis':
      return '例えば「時間割を使う」または「平日は20時以降なら空いています」のように答えてください。';
    case 'constraint_relaxation':
      return '例えば「英語を優先して、数学は翌日に回す」または「長い課題を2回に分ける」のように答えてください。';
    case 'draft_generation_confirmation':
    case 'draft_confirmation':
      return '例えば「その条件で仮予定を作って」のように答えてください。';
    case 'preview_confirmation':
      return '例えば「このままで大丈夫」または「火曜日だけ直して」のように答えてください。';
    case 'ambiguity_resolution':
      return '提示された選択肢のうち、意図に近い方を答えてください。';
    case 'planning_purpose':
      return '例えば「試験勉強」または「数学の宿題」のように答えてください。';
    default:
      return '分かる範囲で、具体例を1つ挙げて答えてください。';
  }
}

function renderClarificationFallback(request: BehaviorAwareClarificationRequest): string {
  return [
    request.explanation.trim(),
    clarificationExample(request.targetSlot),
  ].filter(Boolean).join('\n');
}

function groundedAvailabilityQuestion(input: BehaviorAwareDialoguePlannerInput): string {
  const summaries = input.acceptedFacts.knownFixedEventSummaries ?? [];
  return summaries.length > 0
    ? `登録済みの予定は、${summaries.join('、')}です。これ以外に、時間が決まっていて動かせない予定はありますか？`
    : '時間割・登録済み予定を使うか、ほかに時間が決まっていて動かせない予定があるか教えてください。';
}

function fallbackTextForAction(
  action: AllowedDialogueAction,
  input: BehaviorAwareDialoguePlannerInput,
): string | undefined {
  switch (action.kind) {
    case 'propose_default':
      return '目安がまだ決まっていなければ、短い試行から見積もる案にできます。この案で進めてよいか、違う場合だけ直してください。';
    case 'show_options':
      if (action.topicId === 'planning-range') {
        return input.acceptedFacts.planningPeriodLabel
          ? `${input.acceptedFacts.planningPeriodLabel}の計画は、いつから始めますか？`
          : '計画期間は、今週・来週・週末のどれにしますか？日付で指定しても構いません。';
      }
      if (action.topicId === 'availability-basis') {
        return groundedAvailabilityQuestion(input);
      }
      return action.displayHint ?? '候補から確認したい条件を選んでください。';
    case 'ask_required_fact':
      if (action.topicId === 'planning-purpose') {
        return '試験、宿題、提出物のどれを進める予定か教えてください。';
      }
      if (action.topicId === 'task-identity') {
        return '具体的に何をどこまで進めたいか教えてください。';
      }
      if (action.topicId === 'workload-estimate') {
        return '取り組む量か、かかる時間の目安を教えてください。';
      }
      if (action.topicId === 'availability-basis' || action.topicId === 'feasibility_basis') {
        return groundedAvailabilityQuestion(input);
      }
      return action.displayHint ?? '予定へ大きく影響する条件をもう少し確認させてください。';
    case 'report_infeasibility':
      return action.displayHint
        ?? '現在の条件では全てを配置できないため、優先・分割・延期のどれで調整するか選んでください。';
    case 'suggest_draft_generation':
      return '未確定でも予定を止めない条件は一旦保留にしています。この条件で仮の予定を組んでよければ、そのように伝えてください。';
    case 'generate_preview':
      return '確認した条件で仮予定を作成します。';
    default:
      return undefined;
  }
}

function hasGroundedAvailabilityAction(input: BehaviorAwareDialoguePlannerInput): boolean {
  return input.allowedActions.some((action) =>
    action.topicId === 'availability-basis'
    || action.topicId === 'feasibility_basis',
  );
}

interface DeterministicDialogueFallback {
  message: string;
  renderedActionIds: string[];
}

function renderFallback(
  input: BehaviorAwareDialoguePlannerInput,
  policy: DialogueRepairPolicy,
): DeterministicDialogueFallback {
  const lines: Array<{ text: string; actionId?: string }> = [];
  const acknowledgement = groundedAcknowledgement(input);
  if (acknowledgement) lines.push({ text: acknowledgement });

  if (input.clarificationRequest) {
    lines.push({ text: renderClarificationFallback(input.clarificationRequest) });
    return {
      message: lines.map((line) => line.text).join('\n'),
      renderedActionIds: [],
    };
  }

  const selected = input.allowedActions
    .filter((action) => action.kind !== 'acknowledge_fact')
    .slice(0, 2);
  const profileSummary = input.snapshot.taskProfiles
    .filter((profile) => profile.activityKind !== 'unknown')
    .map((profile) => {
      if (profile.activityKind === 'memorization') return '暗記は短く分けて進める案';
      if (profile.activityKind === 'drill') return 'ワークや演習はまとまった時間で進める案';
      return null;
    })
    .filter((text): text is Exclude<typeof text, null> => text !== null);

  if (profileSummary.length > 0 && policy.mode !== 'explicit_repair') {
    lines.push({ text: `${Array.from(new Set(profileSummary)).join('、')}が合いそうです。` });
  }

  for (const action of selected) {
    const text = fallbackTextForAction(action, input);
    if (text) lines.push({ text, actionId: action.actionId });
  }

  if (lines.length === 0) {
    lines.push({ text: '追加確認が必要になるまでは、この条件で進めます。' });
  }
  const renderedLines = lines.slice(0, 3);
  return {
    message: renderedLines.map((line) => line.text).join('\n'),
    renderedActionIds: renderedLines
      .map((line) => line.actionId)
      .filter((actionId): actionId is string => Boolean(actionId)),
  };
}

export function createAiBehaviorAwareWeeklyPlanningDialoguePlanner(
  config: AiConfig = getAiConfig(),
  client: OpenAiCompatibleClient = createOpenAiCompatibleClient(config),
): {
  plan(input: BehaviorAwareDialoguePlannerInput): Promise<BehaviorAwareDialoguePlannerResult>;
} {
  return {
    async plan(input) {
      const policy = repairPolicyForInput(input);
      const effectiveInput = prioritizeDialogueInput(input, policy);
      const substantiveActions = effectiveInput.allowedActions.filter(
        (action) => action.kind !== 'acknowledge_fact',
      );
      if (
        effectiveInput.clarificationRequest
        || hasGroundedAvailabilityAction(effectiveInput)
        || substantiveActions.length === 0
      ) {
        const fallback = renderFallback(effectiveInput, policy);
        return {
          message: fallback.message,
          response: null,
          source: 'deterministic_fallback' as const,
          renderedActionIds: fallback.renderedActionIds,
        };
      }

      try {
        const content = await client.createChatCompletion({
          messages: [
            { role: 'system', content: createSystemPrompt() },
            { role: 'user', content: createUserPrompt(effectiveInput, policy) },
          ],
          temperature: 0.2,
          responseFormat: WEEKLY_PLANNING_BEHAVIOR_DIALOGUE_RESPONSE_FORMAT,
          purpose: 'weekly_planning_renderer',
        });
        const response = validateBehaviorAwareDialogueResponseClosed({
          response: parseResponse(content),
          actions: effectiveInput.allowedActions,
          previewAllowed: effectiveInput.previewAllowed,
        });

        if (response) {
          return {
            message: composeMessage(response, effectiveInput),
            response,
            source: 'ai' as const,
            renderedActionIds: response.items.map((item) => item.actionId),
          };
        }
      } catch {
        // Provider and parsing failures use the same deterministic action-aware fallback.
      }

      const fallback = renderFallback(effectiveInput, policy);
      return {
        message: fallback.message,
        response: null,
        source: 'deterministic_fallback' as const,
        renderedActionIds: fallback.renderedActionIds,
      };
    },
  };
}

export function createDeterministicBehaviorAwareDialoguePlanner(): {
  plan(input: BehaviorAwareDialoguePlannerInput): Promise<BehaviorAwareDialoguePlannerResult>;
} {
  return {
    async plan(input) {
      const policy = repairPolicyForInput(input);
      const effectiveInput = prioritizeDialogueInput(input, policy);
      const fallback = renderFallback(effectiveInput, policy);
      return {
        message: fallback.message,
        response: null,
        source: 'deterministic_fallback',
        renderedActionIds: fallback.renderedActionIds,
      };
    },
  };
}
