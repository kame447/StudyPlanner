export interface NumericAnswerProposalV5 {
  readonly minutes: readonly number[];
  readonly sourceIntegers: ReadonlyMap<number, readonly number[]>;
}

const DIGIT_RUN = /[0-9０-９]+/gu;
// A separator between two digits means the runs are fragments of one value.
const JOINED_DIGIT_RUNS = /[0-9０-９][.,．，][0-9０-９]/u;

/** Character classes only: ASCII and full-width digit runs as positive safe integers. */
export function numericDigitRunsV5(text: string): readonly number[] {
  return [...text.matchAll(DIGIT_RUN)].flatMap(match => {
    const n = Number([...match[0]].map(c => String.fromCharCode(c.charCodeAt(0) >= 0xFF10
      ? c.charCodeAt(0) - 0xFF10 + 0x30 : c.charCodeAt(0))).join(''));
    return Number.isSafeInteger(n) && n > 0 ? [n] : [];
  });
}

/** Proposes a finite superset. Selection and semantic sufficiency belong to the model. */
export function numericAnswerProposalV5(userText: string): NumericAnswerProposalV5 | null {
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
