export const INQUIRY_BODY_MAX_LENGTH = 2000;
export const INQUIRY_PAGE_SIZE = 25;

export interface InquirySubmission {
  requestId: string;
  body: string;
}

export interface SupportInquiry {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
}

// Keep nanosecond precision: a millisecond-only cursor can skip equal-time rows.
export interface InquiryCursor {
  id: string;
  seconds: number;
  nanoseconds: number;
}

export interface InquiryPage {
  items: SupportInquiry[];
  nextCursor: InquiryCursor | null;
}

export function validateInquirySubmission(input: InquirySubmission): InquirySubmission {
  const body = input.body.trim();
  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(input.requestId)) {
    throw new Error('お問い合わせの受付番号が無効です。');
  }
  if (!body || body.length > INQUIRY_BODY_MAX_LENGTH) {
    throw new Error(`お問い合わせ内容を1〜${INQUIRY_BODY_MAX_LENGTH}文字で入力してください。`);
  }
  return { requestId: input.requestId, body };
}
