function parseJapaneseIntegerRaw(text: string): number | undefined {
  if (/^\d+$/.test(text)) {
    return Number(text);
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

  if (text === '十') {
    return 10;
  }

  const tenIndex = text.indexOf('十');
  if (tenIndex >= 0) {
    const tensText = text.slice(0, tenIndex);
    const onesText = text.slice(tenIndex + 1);
    const tens = tensText ? digitValues[tensText] : 1;
    const ones = onesText ? digitValues[onesText] : 0;
    return tens && ones !== undefined ? tens * 10 + ones : undefined;
  }

  return digitValues[text];
}

function normalizeJapaneseMonthDay(text: string): string {
  return text.replace(
    /([0-9一二三四五六七八九十]+)\s*月\s*([0-9一二三四五六七八九十]+)\s*日/g,
    (matched, monthText: string, dayText: string) => {
      const month = parseJapaneseIntegerRaw(monthText);
      const day = parseJapaneseIntegerRaw(dayText);
      return month && day ? `${month}月${day}日` : matched;
    },
  );
}

function normalizeThirdPartyHopeReport(text: string): string {
  const subject = '(?:先生|友達|母|父|弟|妹|兄|姉|彼|彼女|第三者|[^、。\\s]+(?:さん|くん|ちゃん))';
  return text.replace(
    new RegExp(`(${subject})の希望は`, 'g'),
    '$1が希望している内容は',
  );
}

export function normalizeIntakeText(text: string): string {
  const normalizedWidth = text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[〜～−―–—]/g, '〜')
    .replace(/[　]/g, ' ');

  return normalizeThirdPartyHopeReport(normalizeJapaneseMonthDay(normalizedWidth));
}

export function splitIntakeSegments(text: string): string[] {
  return normalizeIntakeText(text)
    .split(/\r?\n|。|、|けど|ただ|あと|それと|でも/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function parseSmallInteger(text: string): number | undefined {
  return parseJapaneseIntegerRaw(normalizeIntakeText(text).trim());
}

export function uniqueList<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
