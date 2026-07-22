export type WeeklyPlanningSemanticInterpreterErrorCode =
  | 'interpreter_unavailable'
  | 'provider_error'
  | 'invalid_response';

const ERROR_MESSAGES: Record<WeeklyPlanningSemanticInterpreterErrorCode, string> = {
  interpreter_unavailable: '週間計画の意味解釈AIを利用できません。設定を確認してから、もう一度送信してください。',
  provider_error: '週間計画の意味解釈AIへの接続に失敗しました。内容は解析されていません。もう一度送信してください。',
  invalid_response: '週間計画の意味解釈結果を検証できませんでした。内容は解析されていません。もう一度送信してください。',
};

export class WeeklyPlanningSemanticInterpreterError extends Error {
  readonly code: WeeklyPlanningSemanticInterpreterErrorCode;
  readonly causeValue?: unknown;

  constructor(code: WeeklyPlanningSemanticInterpreterErrorCode, causeValue?: unknown) {
    super(ERROR_MESSAGES[code]);
    this.name = 'WeeklyPlanningSemanticInterpreterError';
    this.code = code;
    this.causeValue = causeValue;
  }
}
