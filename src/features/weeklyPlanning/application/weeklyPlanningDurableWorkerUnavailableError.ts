export const WEEKLY_PLANNING_DURABLE_WORKER_UNAVAILABLE_USER_MESSAGE =
  '今回の返信を確認できませんでした。今回の入力は計画に反映していません。表示中の仮案は保持しています。計画は保存していません。接続が復旧したら、この会話で相談を続けられます。';

export const WEEKLY_PLANNING_DURABLE_ACTUAL_RECORDS_UNAVAILABLE_USER_MESSAGE =
  '今回の返信を確認できませんでした。今回の入力は反映していません。仮実績の確認リストは保持しています。今回の入力は保存していません。接続が復旧したら、この会話で相談を続けられます。';

/** A terminal VNext transport failure; it never authorizes resubmission or saving. */
export class WeeklyPlanningDurableWorkerUnavailableError extends Error {
  readonly userMessage: string;

  constructor(message: string, hasPendingActualRecords = false, hasRetainedPlanPreview = false) {
    super(message);
    this.name = 'WeeklyPlanningDurableWorkerUnavailableError';
    this.userMessage = hasPendingActualRecords ? hasRetainedPlanPreview
      ? '今回の返信を確認できませんでした。今回の入力は反映していません。仮実績の確認リストと表示中の仮案は保持しています。今回の入力は保存していません。接続が復旧したら、この会話で相談を続けられます。'
      : WEEKLY_PLANNING_DURABLE_ACTUAL_RECORDS_UNAVAILABLE_USER_MESSAGE
      : WEEKLY_PLANNING_DURABLE_WORKER_UNAVAILABLE_USER_MESSAGE;
  }
}
