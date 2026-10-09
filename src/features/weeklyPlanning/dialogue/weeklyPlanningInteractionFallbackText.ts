import { ADD_SCHEDULE_CONTROL_LABEL } from '../../../components/quickAddMenuLabels';
import type { WeeklyPlanningStableV5CommunicationContext } from './weeklyPlanningStableV5DialogueContracts';
import { WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL } from './weeklyPlanningStableV5DialogueContext';
import { weeklyPlanningUncertaintyReleaseText } from './weeklyPlanningUncertaintyReleaseDisclosure';
import { weeklyPlanningCapacityShortfallText } from './weeklyPlanningCapacityShortfallDisclosure';
import { weeklyPlanningPreviewConstraintDisclosureText, weeklyPlanningPreviewOmissionDisclosureText } from './weeklyPlanningPreviewOmissionDisclosure';

/**
 * Emergency wording of the interaction architecture (Issue #488).
 *
 * In `interaction_v1` every assistant reply is written by the dialogue renderer from a typed
 * communication context. This module is used ONLY when the renderer cannot run (the AI
 * provider just failed, or the turn crashed) or when its output fails validation. It is the
 * single place where the interaction architecture keeps fixed conversational Japanese; a
 * source-scan test forbids internal/system vocabulary here and fixed assistant prose in the
 * other interaction modules. Wording is deliberately short and ordinary: it never explains
 * the system, and it is not tuned per situation (that is the renderer's job).
 *
 * The question itself is the application-typed question text (shared with the legacy
 * architecture's fallback), so the user always learns what is being asked. Other application
 * messages (the routing's status and preview sentences) are never an input here: every status
 * is said from its typed reason, so a routing sentence cannot reach the user verbatim.
 */

const PROVIDER_UNAVAILABLE = 'すみません、通信がうまくいかなかったようです。お手数ですが、もう一度送ってもらえますか？';
/** Before the retained question: the question itself is the one request of the reply. */
const PROVIDER_UNAVAILABLE_BEFORE_QUESTION = 'すみません、うまく届かなかったようです。';
const MESSAGE_NOT_UNDERSTOOD = 'すみません、いまのメッセージをうまく受け取れませんでした。';
const CONTINUE_INVITATION = 'お手数ですが、伝えたいことを少しずつ分けて教えてもらえますか？';
const EXPLANATION_BRIDGE = '予定を無理なく組むのに必要なので、確認させてください。';
const ASIDE_ACKNOWLEDGEMENT = 'わかりました。どうぞ続けてください。';
const CONSULTATION_NOT_ANSWERED = 'その点はここでは決めきれないので、希望があればそのまま条件として教えてください。';
const DETAILS_INVITATION = '予定について変えたいことがあれば、もう一度教えてください。';
const READY_TO_CREATE_PREVIEW = '必要なことはそろいました。仮予定を作ってよければ、そう伝えてください。';
const CAPACITY_SHORTFALL = '今の期間と空き時間では、全部は入りきりませんでした。期間を延ばすか、量を減らすか、使える時間を増やせるかを教えてください。';
const GENERIC_CONTINUE = '続けて、予定の希望を教えてください。';
/** Semantic recovery kept the existing preview; stated by the application, never by the renderer. */
export const WEEKLY_PLANNING_RETAINED_PREVIEW_UNCHANGED_TEXT = '今の仮予定は変えていません。';
const RETAINED_PREVIEW_UNCHANGED = WEEKLY_PLANNING_RETAINED_PREVIEW_UNCHANGED_TEXT;
/** An audit-reported omission was not taken in; stated by the application, never by the renderer. */
export const WEEKLY_PLANNING_POSSIBLE_OMISSION_TEXT = '一部の内容を読み取れていない可能性があります。抜けている予定があれば教えてください。';
const RETAINED_PREVIEW_EDIT_INVITATION = '変えたい点をもう一度教えてください。';
const ALTERNATIVE_ADOPTION_INVITATION = 'その案に変えたい場合は、そう伝えてください。今の候補はまだ変えていません。';

/** A repeated submission of a turn that was already taken in (idempotency guard). */
export const WEEKLY_PLANNING_INTERACTION_DUPLICATE_SUBMISSION_TEXT =
  'この内容はもう受け取っているので、同じ予定を二重には作りません。';

/** The turn failed unexpectedly before any reply could be prepared. */
export const WEEKLY_PLANNING_INTERACTION_UNEXPECTED_FAILURE_TEXT =
  'すみません、いまはうまく続けられませんでした。もう一度送ってもらえますか？';

function previewReadyText(count: number, controlLabel: string): string {
  return `${count}件の仮予定の候補を作りました。内容を見て、よければ下の「${controlLabel}」を押してください。`;
}

function previewUnchangedText(controlLabel: string): string {
  return `今の仮予定の候補はそのままです。直したいところがあれば教えてください。よければ下の「${controlLabel}」を押してください。`;
}

/** A message that could not be used as it is: the retained question, or an invitation. */
export function weeklyPlanningInteractionClarifyText(questionText: string | null, retainedPreviewUnchanged = false): string {
  if (retainedPreviewUnchanged) {
    return `${MESSAGE_NOT_UNDERSTOOD}${RETAINED_PREVIEW_UNCHANGED}${questionText || RETAINED_PREVIEW_EDIT_INVITATION}`;
  }
  return questionText
    ? `${MESSAGE_NOT_UNDERSTOOD}\n\n${questionText}`
    : `${MESSAGE_NOT_UNDERSTOOD}${CONTINUE_INVITATION}`;
}

/**
 * Provider failure: the renderer is not called (the same provider just failed). With a retained
 * question the reply asks only that question (one request); otherwise it asks for a resend.
 */
export function weeklyPlanningInteractionProviderUnavailableText(questionText: string | null): string {
  return questionText ? `${PROVIDER_UNAVAILABLE_BEFORE_QUESTION}\n\n${questionText}` : PROVIDER_UNAVAILABLE;
}

export function composeWeeklyPlanningInteractionFallbackText(params: {
  communication: WeeklyPlanningStableV5CommunicationContext;
  /** Application-typed question text; empty when the reply asks no question. */
  questionText: string;
  questionCode: string | null;
  previewCount: number;
  previewPromotionControlLabel: string | null;
  /** Application-owned date interpretation note for this turn ('' when none). */
  groundingNote: string;
}): string {
  const { communication } = params;
  const controlLabel = params.previewPromotionControlLabel ?? WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL;
  const scheduleQuestion = communication.scheduleIntent === 'confirm_existing_schedule'
    ? 'すでにどんな予定がありますか？'
    : communication.scheduleIntent === 'register_event'
      ? 'どんな予定を入れたいですか？'
      : communication.scheduleIntent === 'clarify_schedule_request'
        ? 'どのような予定を立てたいですか？' : null;
  const question = communication.askQuestion
    ? (params.questionCode === 'insufficient_capacity'
        ? `${params.groundingNote}${CAPACITY_SHORTFALL}${communication.capacityShortfall ? `\n\n${weeklyPlanningCapacityShortfallText(communication.capacityShortfall)}` : ''}`
        : (params.questionCode === 'missing_schedulable_work' ? scheduleQuestion : null) ?? params.questionText)
    : '';
  let main: string;
  switch (communication.goal) {
    case 'explain_question':
      main = `${EXPLANATION_BRIDGE}${question}`;
      break;
    case 'acknowledge_aside':
      main = ASIDE_ACKNOWLEDGEMENT;
      break;
    case 'clarify_turn':
      main = weeklyPlanningInteractionClarifyText(question || null, communication.retainedPreviewUnchanged);
      break;
    case 'present_preview':
      main = `${params.groundingNote}${previewReadyText(params.previewCount, controlLabel)}${
        communication.previewDisclosure
          ? weeklyPlanningPreviewOmissionDisclosureText(communication.previewDisclosure.omittedWork)
          : ''}`;
      {
        const constraintDisclosure = weeklyPlanningPreviewConstraintDisclosureText(communication.previewConstraintSatisfaction);
        if (constraintDisclosure) main += `\n\n${constraintDisclosure}`;
      }
      break;
    case 'report_status':
      main = `${params.groundingNote}${
        communication.statusReason === 'fixed_event_manual_entry'
          ? `この固定予定はここでは追加・保存できません。「${ADD_SCHEDULE_CONTROL_LABEL}」から入力してください。`
          : communication.statusReason === 'no_additional_work'
            ? 'わかりました。'
            : communication.statusReason === 'ready_to_create_preview'
          ? READY_TO_CREATE_PREVIEW
          : communication.statusReason === 'preview_unchanged'
            ? previewUnchangedText(controlLabel)
            : GENERIC_CONTINUE}`;
      break;
    default:
      main = question || GENERIC_CONTINUE;
  }
  if (communication.alternativeRequiresAdoption) {
    main = `${ALTERNATIVE_ADOPTION_INVITATION}${question}`;
  }
  return [
    main,
    communication.consultationDeferred && !communication.alternativeRequiresAdoption ? CONSULTATION_NOT_ANSWERED : '',
    communication.planningDetailsNotApplied ? DETAILS_INVITATION : '',
    communication.possibleCompletenessOmission ? WEEKLY_PLANNING_POSSIBLE_OMISSION_TEXT : '',
    communication.uncertaintyReleased ? weeklyPlanningUncertaintyReleaseText(communication.uncertaintyReleased) : '',
  ].join('');
}
