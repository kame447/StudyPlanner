export interface UserPlanningContextDateRangeV1 {
  start: string;
  end: string;
}

type MonthPartV1 = 'early' | 'mid' | 'late';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_RANGE_PATTERN = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/;
const STRUCTURED_PARTIAL_PATTERN = /^year:(\d{4});month:(\d{1,2})(?:;part:(early|mid|late))?$/;
const COMPACT_PARTIAL_PATTERN = /^(\d{4})-(\d{1,2})(?:-(early|mid|late))?$/;
const MIXED_PARTIAL_PATTERN = /^(\d{4})-(\d{1,2})(上旬|中旬|下旬)$/;
const JAPANESE_PARTIAL_PATTERN = /^(\d{4})年(\d{1,2})月(?:(上旬|中旬|下旬))?$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isValidDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function daysInMonth(year: number, month: number): number | null {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function partialRange(year: number, month: number, part?: MonthPartV1): UserPlanningContextDateRangeV1 | null {
  const lastDay = daysInMonth(year, month);
  if (lastDay === null) return null;
  const prefix = `${String(year).padStart(4, '0')}-${pad2(month)}`;
  if (!part) return { start: `${prefix}-01`, end: `${prefix}-${pad2(lastDay)}` };
  if (part === 'early') return { start: `${prefix}-01`, end: `${prefix}-10` };
  if (part === 'mid') return { start: `${prefix}-11`, end: `${prefix}-20` };
  return { start: `${prefix}-21`, end: `${prefix}-${pad2(lastDay)}` };
}

function japanesePart(value: string | undefined): MonthPartV1 | undefined {
  if (value === '上旬') return 'early';
  if (value === '中旬') return 'mid';
  if (value === '下旬') return 'late';
  return undefined;
}

export function parseUserPlanningContextDateRangeV1(expression: string): UserPlanningContextDateRangeV1 | null {
  const normalized = expression.normalize('NFKC').trim();
  const match = ISO_RANGE_PATTERN.exec(normalized);
  if (!match || !isValidDate(match[1]) || !isValidDate(match[2]) || match[1] > match[2]) return null;
  return { start: match[1], end: match[2] };
}

export function canonicalizeUserPlanningContextPartialDateV1(expression: string): string | null {
  const normalized = expression.normalize('NFKC').trim();
  const unwrapped = normalized.startsWith('custom:')
    ? normalized.slice('custom:'.length)
    : normalized;

  const structured = STRUCTURED_PARTIAL_PATTERN.exec(unwrapped);
  const compact = structured ? null : COMPACT_PARTIAL_PATTERN.exec(unwrapped);
  const mixed = structured || compact ? null : MIXED_PARTIAL_PATTERN.exec(unwrapped);
  const japanese = structured || compact || mixed ? null : JAPANESE_PARTIAL_PATTERN.exec(unwrapped);
  const match = structured ?? compact ?? mixed ?? japanese;
  if (!match) return null;

  const range = partialRange(
    Number(match[1]),
    Number(match[2]),
    mixed || japanese ? japanesePart(match[3]) : match[3] as MonthPartV1 | undefined,
  );
  return range ? `${range.start}/${range.end}` : null;
}

export function normalizeUserPlanningContextDateInputV1(value: string): string | null {
  const normalized = value.normalize('NFKC').trim();
  if (!normalized) return null;
  if (isValidDate(normalized)) return normalized;
  if (parseUserPlanningContextDateRangeV1(normalized)) return normalized;

  const partial = canonicalizeUserPlanningContextPartialDateV1(normalized);
  if (partial) return partial;

  if (['today', 'tomorrow', 'next_day', 'day_after_tomorrow'].includes(normalized)) {
    return normalized;
  }
  return normalized.startsWith('custom:') ? normalized : `custom:${normalized}`;
}

function addDays(date: string, amount: number): string | null {
  if (!isValidDate(date) || !Number.isInteger(amount)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

export function resolveUserPlanningContextLifecycleDateV1(
  expression: string | null,
  observedDate: string,
): string | null {
  if (!expression) return null;
  if (isValidDate(expression)) return expression;
  const range = parseUserPlanningContextDateRangeV1(expression);
  if (range) return range.end;
  if (expression === 'today') return observedDate;
  if (expression === 'tomorrow' || expression === 'next_day') return addDays(observedDate, 1);
  if (expression === 'day_after_tomorrow') return addDays(observedDate, 2);
  const dayOffset = /^custom:(\d+)日後$/.exec(expression);
  if (dayOffset) return addDays(observedDate, Number(dayOffset[1]));
  const weekOffset = /^custom:(\d+)週間後$/.exec(expression)
    ?? /^custom:(\d+)週後$/.exec(expression);
  if (weekOffset) return addDays(observedDate, Number(weekOffset[1]) * 7);
  return null;
}

export function userPlanningContextDateEditorTextV1(expression: string | null): string {
  if (!expression) return '';
  return expression.startsWith('custom:') ? expression.slice('custom:'.length) : expression;
}
