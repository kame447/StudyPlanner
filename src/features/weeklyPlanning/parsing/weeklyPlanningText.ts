export function normalizeWeeklyPlanningText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[：]/g, ':')
    .replace(/[〜～−―–—]/g, '~')
    .replace(/[　]/g, ' ');
}

export function normalizeConditionText(text: string): string {
  return normalizeWeeklyPlanningText(text)
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseJapaneseSmallInteger(text: string): number | null {
  const normalizedText = normalizeWeeklyPlanningText(text).trim();

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

    return tens && ones !== undefined ? tens * 10 + ones : null;
  }

  return digitValues[normalizedText] ?? null;
}

export function isPlacementConditionOnly(text: string): boolean {
  const normalizedText = normalizeWeeklyPlanningText(text)
    .replace(/[、。,.]/g, '')
    .replace(/(?:で)?(?:おまかせ|任せ|普通|デフォルト|そのまま|適当|わからない|分からない|OK|ok|はい|進め).*$/g, '')
    .replace(/(?:で|にして|でいい)$/g, '')
    .trim();

  return (
    /(?:避けたい|避ける|避けて|ならない|なりにくい|しない|しにくい|作らない|出ない|細切れ|分散|苦手|使わない)/.test(
      normalizedText,
    ) ||
    /^(?:(?:2|二)\s*時間\s*単位|長め|一気|まとめて)(?:で|に|でやりたい|にしたい)?$/.test(
      normalizedText,
    ) ||
    /^\d{1,2}(?::\d{1,2})?\s*(?:時)?\s*(?:起床|起きる|起き|就寝|寝たい|寝る|寝)$/.test(
      normalizedText,
    ) ||
    /^(?:最大|1回|一回|セッション)\s*\d+\s*分$/.test(normalizedText) ||
    /^\d+\s*分\s*(?:まで|以内|最大)$/.test(normalizedText) ||
    /^(?:休憩|休み)\s*\d+\s*分$/.test(normalizedText) ||
    /^\d+\s*分\s*(?:休憩|休み)$/.test(normalizedText) ||
    /^(?:前後|バッファ|余裕)\s*\d+\s*分$/.test(normalizedText) ||
    /^\d+\s*分\s*(?:前後|バッファ|余裕)$/.test(normalizedText) ||
    /^深夜(?:も)?(?:OK|ok|可|使う|使って|入れて)$/.test(normalizedText) ||
    /^夜中(?:も)?(?:OK|ok|可)$/.test(normalizedText) ||
    /^(?:午前|午後|夜|夜中|深夜)(?:中心|も使う|は使わない)$/.test(normalizedText) ||
    /^(?:\d{1,2}(?::\d{2})?|\d{1,2}時)(?:から|〜|~|-)(?:\d{1,2}(?::\d{2})?|\d{1,2}時)(?:まで)?$/.test(
      normalizedText,
    )
  );
}
