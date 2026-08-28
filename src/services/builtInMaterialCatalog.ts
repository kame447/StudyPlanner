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

interface RankedBuiltInCandidate {
  candidate: MaterialMetadataCandidate;
  normalizedTitle: string;
  rank: number;
}

const builtInCatalog = rawCatalog as BuiltInMaterialCatalogSource;

function matchRank(normalizedTitle: string, normalizedQuery: string): number | null {
  if (normalizedTitle === normalizedQuery) return 0;
  if (normalizedTitle.startsWith(normalizedQuery)) return 1;
  if (normalizedTitle.includes(normalizedQuery)) return 2;
  return null;
}

export function searchBuiltInMaterialCatalog(query: string): MaterialMetadataCandidate[] {
  const classified = classifyMaterialMetadataQuery(query);
  if (!classified || classified.kind !== 'title') return [];

  const normalizedQuery = normalizeMaterialCatalogTitle(classified.value);
  const subjectLabels = new Set(
    builtInCatalog.subjects.map((subject) => normalizeMaterialCatalogTitle(subject.label)),
  );
  const matches = new Map<string, RankedBuiltInCandidate>();

  builtInCatalog.subjects.forEach((subject) => {
    subject.keywords.forEach((keyword) => {
      const title = normalizeMaterialSearchText(keyword);
      const normalizedTitle = normalizeMaterialCatalogTitle(title);
      if (!normalizedTitle || subjectLabels.has(normalizedTitle)) return;

      const rank = matchRank(normalizedTitle, normalizedQuery);
      if (rank === null) return;

      const previous = matches.get(normalizedTitle);
      if (previous && previous.rank <= rank) return;

      matches.set(normalizedTitle, {
        normalizedTitle,
        rank,
        candidate: {
          catalogEntryId: `builtin:${normalizedTitle}`,
          title,
          authors: [],
        },
      });
    });
  });

  return Array.from(matches.values())
    .sort((left, right) =>
      left.rank - right.rank
      || left.candidate.title.length - right.candidate.title.length
      || left.candidate.title.localeCompare(right.candidate.title, 'ja'),
    )
    .slice(0, MAX_BUILT_IN_RESULTS)
    .map(({ candidate }) => candidate);
}
