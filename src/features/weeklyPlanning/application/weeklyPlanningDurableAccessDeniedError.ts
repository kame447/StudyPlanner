/** A terminal 401/403 from the durable turn endpoint. It never authorizes a retry or save. */
export class WeeklyPlanningDurableAccessDeniedError extends Error {
  readonly status: 401 | 403;
  readonly userMessage: string;

  constructor(status: 401 | 403) {
    super('再ログインして会話を開き直してください。');
    this.name = 'WeeklyPlanningDurableAccessDeniedError';
    this.status = status;
    const reason = status === 401 ? '認証を確認できませんでした' : 'この会話への権限を確認できませんでした';
    this.userMessage = `${reason}。今回の入力は保存も承認もされていません。再ログインして権限を確認した後、この会話で相談を続けられます。`;
  }
}

/** The local auth identity no longer owns the conversation before any request is sent. */
export class WeeklyPlanningDurableOwnerMismatchError extends Error {
  readonly userMessage = 'ログイン状態が変わったため、今回の入力は保存も承認もされていません。同じアカウントで再ログインした後、この会話で相談を続けられます。';

  constructor() {
    super('会話の所有者が変わりました。');
    this.name = 'WeeklyPlanningDurableOwnerMismatchError';
  }
}
