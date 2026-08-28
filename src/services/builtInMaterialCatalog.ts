import {
  classifyMaterialMetadataQuery,
  normalizeMaterialCatalogTitle,
  normalizeMaterialSearchText,
  type MaterialMetadataCandidate,
} from '../../shared/materialMetadataContract';
import rawCatalog from '../data/naturalLanguageCatalog.json';

const MAX_BUILT_IN_RESULTS = 8;

interface BuiltInMaterialCatalogSource {
  subjects: Array<{
    label: string;
    keywords: string[];
  }>;
}

const builtInCatalog = rawCatalog as BuiltInMaterialCatalogSource;

export function searchBuiltInMaterialCatalog(query: string): MaterialMetadataCandidate[] {
  const classified = classifyMaterialMetadataQuery(query);
  if (!classified || classified.kind !== 'title') return [];

  const normalizedQuery = normalizeMaterialCatalogTitle(classified.value);
  const subjectLabels = new Set(
    builtInCatalog.subjects.map((subject) => normalizeMaterialCatalogTitle(subject.label)),
  );
  const matches = new Map<string, MaterialMetadataCandidate>();

  builtInCatalog.subjects.forEach((subject) => {
    subject.keywords.forEach((keyword) => {
      const title = normalizeMaterialSearchText(keyword);
      const normalizedTitle = normalizeMaterialCatalogTitle(title);
      if (!normalizedTitle || subjectLabels.has(normalizedTitle)) return;
      if (normalizedTitle !== normalizedQuery || matches.has(normalizedTitle)) return;

      matches.set(normalizedTitle, {
        catalogEntryId: `builtin:${normalizedTitle}`,
        title,
        authors: [],
      });
    });
  });

  return Array.from(matches.values()).slice(0, MAX_BUILT_IN_RESULTS);
}
