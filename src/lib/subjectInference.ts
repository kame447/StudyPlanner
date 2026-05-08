import { inferEventSubject } from '../services/natural-language/catalog';
import type { StudyMaterial, StudySubject } from '../types/domain';

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

function normalizeUserCatalogText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '');
}

export function inferSubjectFromTitleWithUserCatalog(
  title: string,
  options: {
    userMaterials?: StudyMaterial[];
    userSubjects?: StudySubject[];
  } = {},
): string | null {
  const normalizedTitle = normalizeUserCatalogText(title);

  if (!normalizedTitle) {
    return null;
  }

  for (const material of options.userMaterials ?? []) {
    const names = [material.name, ...(material.aliases ?? [])]
      .map(normalizeUserCatalogText)
      .filter(Boolean);

    if (names.some((name) => normalizedTitle.includes(name))) {
      return material.subjectName || null;
    }
  }

  for (const subject of options.userSubjects ?? []) {
    const subjectName = normalizeUserCatalogText(subject.name);

    if (subjectName && normalizedTitle.includes(subjectName)) {
      return subject.name;
    }
  }

  return inferSubjectFromTitle(title);
}
