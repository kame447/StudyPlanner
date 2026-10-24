/** Pure arithmetic only; no clock normalization or scheduling interpretation. */
export function parseJapaneseInteger(value: string): number | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  const digitMap: Record<string, number> = {
    〇: 0,
    零: 0,
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

  if (normalized === '十') {
    return 10;
  }

  const hundredIndex = normalized.indexOf('百');
  let total = 0;
  let rest = normalized;

  if (hundredIndex >= 0) {
    const hundredValue = normalized.slice(0, hundredIndex);
    total += (digitMap[hundredValue] ?? 1) * 100;
    rest = normalized.slice(hundredIndex + 1);
  }

  const tenIndex = rest.indexOf('十');

  if (tenIndex >= 0) {
    const tenValue = rest.slice(0, tenIndex);
    total += (digitMap[tenValue] ?? 1) * 10;
    rest = rest.slice(tenIndex + 1);
  }

  if (rest) {
    const ones = rest
      .split('')
      .reduce<number>((sum, char) => sum * 10 + (digitMap[char] ?? 0), 0);
    total += ones;
  }

  return total > 0 ? total : null;
}


export function composeDurationMinutes(hours: number, minutes = 0): number {
  return hours * 60 + minutes;
}
