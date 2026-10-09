/**
 * Closed weekday token set (P3 S3b consumer, critic 4219): the weekdays a reply text names, for a deterministic subset check
 * against a typed proposal record's weekdays. Code order 0=日 … 6=土. Only an explicit weekday counts: 「月曜」「火曜日」 and a
 * separator list of weekday letters (「月・水」「火、木曜」); a bare 月/日 inside 来月, 9月1日, 毎日 or 日本 is not a weekday.
 */
const LETTERS = '日月火水木金土';
const NOT_PART_OF_WORD = '(?<![\\u4e00-\\u9fff\\u3040-\\u30ff0-9])';
const EXPLICIT = new RegExp(`([${LETTERS}])曜日?`, 'gu');
const LIST = new RegExp(`${NOT_PART_OF_WORD}([${LETTERS}](?:[・、,，/／]\\s*[${LETTERS}]){1,6})(?:曜日?)?(?![\\u4e00-\\u9fff])`, 'gu');

export function weekdaysNamedInTextV5(text: string): Set<number> {
  const found = new Set<number>();
  const normalized = text.normalize('NFKC');
  for (const match of normalized.matchAll(EXPLICIT)) found.add(LETTERS.indexOf(match[1]));
  for (const match of normalized.matchAll(LIST)) {
    for (const letter of match[1]) {
      const index = LETTERS.indexOf(letter);
      if (index >= 0) found.add(index);
    }
  }
  return found;
}

/** True when every weekday the text names is one of the record's weekdays (naming none is fine). */
export function weekdaysSubsetOfRecordV5(text: string, recordWeekdays: readonly number[]): boolean {
  const allowed = new Set(recordWeekdays);
  return [...weekdaysNamedInTextV5(text)].every((day) => allowed.has(day));
}
