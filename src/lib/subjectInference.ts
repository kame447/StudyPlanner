import { inferEventSubject } from '../services/natural-language/catalog';
import type { StudyMaterial, StudySubject } from '../types/domain';

const GENERIC_SUBJECTS = new Set(['\u52c9\u5f37']);
const USER_CATALOG_WORD_BOUNDARY_PATTERN =
  /[\s\u3000,.;:!?()[\]{}"'<>\/\\|+~_\-\u3001\u3002\u30fb\u300c\u300d\u300e\u300f]/u;

export type UserCatalogSubjectInferenceSource =
  | 'material'
  | 'subject'
  | 'catalog'
  | 'none';

export interface UserCatalogSubjectInferenceResult {
  subject: string | null;
  materialId?: string | null;
  materialName?: string;
  source: UserCatalogSubjectInferenceSource;
}

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

  if (/\u6587\u6cd5/i.test(normalizedTitle)) {
    return '\u82f1\u8a9e';
  }

  return null;
}

function normalizeUserCatalogText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '');
}

function tokenizeUserCatalogText(text: string): string[] {
  return text
    .split(USER_CATALOG_WORD_BOUNDARY_PATTERN)
    .map(normalizeUserCatalogText)
    .filter(Boolean);
}

function isExactTextMatch(query: string, candidate: string): boolean {
  return query === candidate || tokenizeUserCatalogText(query).includes(candidate);
}

function canUsePartialAlias(alias: string): boolean {
  return alias.length >= 3;
}

function scoreMaterialNameMatch(title: string, name: string): number {
  if (!name) {
    return 0;
  }

  if (isExactTextMatch(title, name)) {
    return 5000 + name.length;
  }

  return title.includes(name) ? 3000 + name.length : 0;
}

function scoreAliasMatch(title: string, alias: string): number {
  if (!alias || alias.length <= 1) {
    return 0;
  }

  if (isExactTextMatch(title, alias)) {
    return 4000 + alias.length;
  }

  return canUsePartialAlias(alias) && title.includes(alias)
    ? 2000 + alias.length
    : 0;
}

function findBestUserMaterialMatch(
  title: string,
  materials: StudyMaterial[],
): { material: StudyMaterial; score: number } | null {
  const normalizedTitle = normalizeUserCatalogText(title);
  let bestMatch: { material: StudyMaterial; score: number } | null = null;

  for (const material of materials) {
    const nameScore = scoreMaterialNameMatch(
      normalizedTitle,
      normalizeUserCatalogText(material.name),
    );
    const aliasScore = (material.aliases ?? []).reduce(
      (bestAliasScore, alias) =>
        Math.max(
          bestAliasScore,
          scoreAliasMatch(normalizedTitle, normalizeUserCatalogText(alias)),
        ),
      0,
    );
    const score = Math.max(nameScore, aliasScore);

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        material,
        score,
      };
    }
  }

  return bestMatch;
}

export function inferSubjectFromTitleWithUserCatalog(
  title: string,
  options: {
    userMaterials?: StudyMaterial[];
    userSubjects?: StudySubject[];
  } = {},
): UserCatalogSubjectInferenceResult {
  const normalizedTitle = normalizeUserCatalogText(title);

  if (!normalizedTitle) {
    return {
      subject: null,
      source: 'none',
    };
  }

  const materialMatch = findBestUserMaterialMatch(
    title,
    options.userMaterials ?? [],
  );

  if (materialMatch) {
    return {
      subject: materialMatch.material.subjectName || null,
      materialId: materialMatch.material.id,
      materialName: materialMatch.material.name,
      source: 'material',
    };
  }

  for (const subject of options.userSubjects ?? []) {
    const subjectName = normalizeUserCatalogText(subject.name);

    if (subjectName && normalizedTitle.includes(subjectName)) {
      return {
        subject: subject.name,
        source: 'subject',
      };
    }
  }

  const catalogSubject = inferSubjectFromTitle(title);

  return catalogSubject
    ? {
        subject: catalogSubject,
        source: 'catalog',
      }
    : {
        subject: null,
        source: 'none',
      };
}
