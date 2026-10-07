import type { WeeklyPlanningStableV5CommunicationContext } from './weeklyPlanningStableV5DialogueContracts';
import { WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL } from './weeklyPlanningStableV5DialogueContext';

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
 * architecture's fallback), so the user always learns what is being asked.
 */

const PROVIDER_UNAVAILABLE = 'すみません、通信がうまくいかなかったようです。お手数ですが、もう一度送ってもらえますか？';
const MESSAGE_NOT_UNDERSTOOD = 'すみません、いまのところをうまく受け取れませんでした。';
const CONTINUE_INVITATION = 'どんな勉強の予定を立てたいか、続けて教えてください。';
const EXPLANATION_BRIDGE = '予定を無理なく組むために、ここを教えてください。';
const ASIDE_ACKNOWLEDGEMENT = 'わかりました。どうぞ続けてください。';
const CONSULTATION_NOT_ANSWERED = 'そのご相談には、ここではまだお答えできません。';
const DETAILS_INVITATION = '予定について変えたいことがあれば、もう一度教えてください。';
const READY_TO_CREATE_PREVIEW = '必要なことはそろいました。仮予定を作るときは「この条件で予定を作って」と送ってください。';
const CAPACITY_SHORTFALL = '今の期間と空き時間では、全部は入りきりませんでした。期間を延ばすか、量を減らすか、使える時間を増やせるかを教えてください。';
const SOME_WORK_OMITTED = '空き時間に入りきらなかった作業は、今回の候補には入れていません。';
const GENERIC_CONTINUE = '続けて、予定の希望を教えてください。';

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

function omittedWorkText(labels: readonly string[]): string {
  return labels.length > 0
    ? `${labels.join('・')}は空き時間に入りきらなかったので、今回の候補には入れていません。`
    : SOME_WORK_OMITTED;
}

/** Provider failure: the renderer is not called (the same provider just failed). */
export function weeklyPlanningInteractionProviderUnavailableText(questionText: string | null): string {
  return questionText ? `${PROVIDER_UNAVAILABLE}\n\n${questionText}` : PROVIDER_UNAVAILABLE;
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
  /**
   * The application's own message, used only for a status reply that carries no typed
   * reason (callers without communication facts); every production status has a reason.
   */
  applicationText: string;
}): string {
  const { communication } = params;
  const controlLabel = params.previewPromotionControlLabel ?? WEEKLY_PLANNING_PREVIEW_PROMOTION_CONTROL_LABEL;
  const question = communication.askQuestion
    ? (params.questionCode === 'insufficient_capacity'
        ? `${params.groundingNote}${CAPACITY_SHORTFALL}`
        : params.questionText)
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
      main = question
        ? `${MESSAGE_NOT_UNDERSTOOD}\n\n${question}`
        : `${MESSAGE_NOT_UNDERSTOOD}${CONTINUE_INVITATION}`;
      break;
    case 'present_preview':
      main = `${params.groundingNote}${previewReadyText(params.previewCount, controlLabel)}${
        communication.previewDisclosure
          ? omittedWorkText(communication.previewDisclosure.omittedWorkLabels)
          : ''}`;
      break;
    case 'report_status':
      main = `${params.groundingNote}${
        communication.statusReason === 'ready_to_create_preview'
          ? READY_TO_CREATE_PREVIEW
          : communication.statusReason === 'preview_unchanged'
            ? previewUnchangedText(controlLabel)
            : params.applicationText || GENERIC_CONTINUE}`;
      break;
    default:
      main = question || GENERIC_CONTINUE;
  }
  return [
    communication.consultationDeferred ? CONSULTATION_NOT_ANSWERED : '',
    main,
    communication.planningDetailsNotApplied ? DETAILS_INVITATION : '',
  ].join('');
}
