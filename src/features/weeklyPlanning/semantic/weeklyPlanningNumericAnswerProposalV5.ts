import { composeDurationMinutes, parseJapaneseInteger } from '../../../services/durationConversion';
export interface NumericAnswerProposalV5 {
  readonly minutes: readonly number[];
  readonly mentions?: readonly NumericQuantityMentionV5[];
  readonly sourceIntegers: ReadonlyMap<number, readonly number[]>;
}

const DIGIT_RUN = /[0-9０-９]+/gu;
// A separator between two digits, or a leading decimal point, means the runs are fragments of one value.
const JOINED_DIGIT_RUNS = /[0-9０-９][.,:/．，：／][0-9０-９]|[.．][0-9０-９]/u;

/** Character classes only: ASCII and full-width digit runs as positive safe integers. */
export function numericDigitRunsV5(text: string): readonly number[] {
  return [...text.matchAll(DIGIT_RUN)].flatMap(match => {
    const n = Number([...match[0]].map(c => String.fromCharCode(c.charCodeAt(0) >= 0xFF10
      ? c.charCodeAt(0) - 0xFF10 + 0x30 : c.charCodeAt(0))).join(''));
    return Number.isSafeInteger(n) && n > 0 ? [n] : [];
  });
}

/** Proposes a finite superset. Selection and semantic sufficiency belong to the model. */
function legacyNumericAnswerProposalV5(userText: string): NumericAnswerProposalV5 | null {
  if (JOINED_DIGIT_RUNS.test(userText)) return null;
  const sources = new Map<number, number[]>();
  for (const n of numericDigitRunsV5(userText)) {
    for (const minutes of [n, 60 * n]) {
      if (minutes > 1440) continue;
      const integers = sources.get(minutes) ?? [];
      if (!integers.includes(n)) integers.push(n);
      sources.set(minutes, integers);
      if (sources.size > 8) return null;
    }
  }
  return sources.size ? { minutes: [...sources.keys()], sourceIntegers: sources } : null;
}

export interface NumericQuantityMentionV5 {
  readonly minutes: number;
  readonly span: { readonly start: number; readonly end: number };
  readonly surface: string;
  readonly form: 'bare' | 'minutes' | 'hours' | 'composite';
  readonly approximate: boolean;
}
const NUMBER = '[0-9０-９〇零一二三四五六七八九十百]+(?:[.．][0-9０-９]+)?';
const QUANTITY = new RegExp(`(${NUMBER})(?:時間(?:(半)|(${NUMBER})分)?|(分))?`, 'gu');
const APPROXIMATION = /くらい|ぐらい|ほど|前後|約|程度|およそ|大体|だいたい/u;

/** Whole-utterance proposal scanner, never a target/intent interpreter. Offsets retain original UTF-16 text. */
export function scanNumericQuantityMentionsV5(text: string, maximumMinutes = 1440): readonly NumericQuantityMentionV5[] | null {
  // Unsupported numeric shapes cannot be shortened into a supported prefix or suffix.
  if (new RegExp(`(?:${NUMBER})\\s*(?:[,，:：/／〜～~\\-−–—]|から)\\s*(?:${NUMBER})`, 'u').test(text)
    || /分の/u.test(text)) return null;
  const result: NumericQuantityMentionV5[] = [];
  for (const match of text.matchAll(QUANTITY)) {
    const start = match.index!; const end = start + match[0].length;
    if (/[.．千万元億兆\-−–—]/u.test(text[start - 1] ?? '') || /[千万元億兆]/u.test(text[end] ?? '')) return null;
    const number = parseJapaneseInteger(match[1].normalize('NFKC'));
    const hour = match[0].includes('時間');
    const extra = match[2] ? 30 : match[3] ? parseJapaneseInteger(match[3].normalize('NFKC')) : 0;
    if (number === null || extra === null) return null;
    const minutes = hour ? composeDurationMinutes(number, extra) : number;
    if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > maximumMinutes) return null;
    result.push({ minutes, span: { start, end }, surface: match[0],
      form: hour ? match[2] || match[3] ? 'composite' : 'hours' : match[4] ? 'minutes' : 'bare',
      approximate: APPROXIMATION.test(text) });
  }
  return result;
}

export function numericAnswerProposalV5(userText: string, converted = false): NumericAnswerProposalV5 | null {
  if (!converted) return legacyNumericAnswerProposalV5(userText);
  const mentions = scanNumericQuantityMentionsV5(userText);
  if (!mentions?.length || mentions.some(m => m.approximate)) return null;
  const minutes = [...new Set(mentions.map(m => m.minutes))];
  if (minutes.length > 8) return null;
  return { minutes, mentions, sourceIntegers: new Map(minutes.map(n => [n, [n]])) };
}
