export function normalizeIntakeText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[〜～−―–—]/g, '〜')
    .replace(/[　]/g, ' ');
}

export function splitIntakeSegments(text: string): string[] {
  return normalizeIntakeText(text)
    .split(/\r?\n|。|、|けど|ただ|あと|それと|でも/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function parseSmallInteger(text: string): number | undefined {
  const normalizedText = normalizeIntakeText(text).trim();

  if (/^\d+$/.test(normalizedText)) {
    return Number(normalizedText);
  }

  const digitValues: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (normalizedText === '十') {
    return 10;
  }

  const tenIndex = normalizedText.indexOf('十');
  if (tenIndex >= 0) {
    const tensText = normalizedText.slice(0, tenIndex);
    const onesText = normalizedText.slice(tenIndex + 1);
    const tens = tensText ? digitValues[tensText] : 1;
    const ones = onesText ? digitValues[onesText] : 0;

    return tens && ones !== undefined ? tens * 10 + ones : undefined;
  }

  return digitValues[normalizedText];
}

export function uniqueList<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
