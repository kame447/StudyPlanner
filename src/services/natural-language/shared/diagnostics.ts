export interface Diagnostic {
  code: string;
  message: string;
  spanText?: string;
}

export function diag(
  code: string,
  message: string,
  spanText?: string
): Diagnostic {
  return { code, message, spanText };
}
