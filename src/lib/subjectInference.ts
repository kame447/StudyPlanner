import { inferEventSubject } from '../services/natural-language/catalog';

const GENERIC_SUBJECTS = new Set(['勉強']);

export function inferSubjectFromTitle(title: string): string | null {
  const normalizedTitle = title.trim();

  if (!normalizedTitle) {
    return null;
  }

  const inferredSubject = inferEventSubject({
    titleText: normalizedTitle,
    contentText: normalizedTitle,
  })?.trim();

  if (inferredSubject && !GENERIC_SUBJECTS.has(inferredSubject)) {
    return inferredSubject;
  }

  if (/文法/i.test(normalizedTitle)) {
    return '英語';
  }

  return null;
}
