/**
 * The one fixed text of a verified-dialogue technical stop (Issue #488 P2): the reply could not be verified, so the
 * turn is a controlled failure (state unchanged, staged work discarded) and can simply be sent again. It says only that this message was not applied (true: the turn is discarded) and asks for a resend; nothing about the plan.
 */
export const WEEKLY_PLANNING_VERIFIED_DIALOGUE_TECHNICAL_STOP_TEXT = 'うまく返信できなかったため、今回のメッセージは受け付けていません。お手数ですが、もう一度送ってください。';
