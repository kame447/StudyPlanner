import {
  classifyMaterialMetadataQuery,
  normalizeMaterialCatalogTitle,
  normalizeMaterialSearchText,
  type MaterialMetadataCandidate,
} from '../../shared/materialMetadataContract';
import {
  MATERIAL_CATALOG_SEED_ENTRIES,
  MATERIAL_CATALOG_SERIES_ALIASES,
  type BuiltInMaterialSeedEntry,
} from '../data/material-catalog';
import rawLegacyCatalog from '../data/naturalLanguageCatalog.json';

const MAX_BUILT_IN_RESULTS = 8;
const MIN_LEGACY_FALLBACK_LENGTH = 4;

interface LegacyBuiltInMaterialCatalogSource {
  subjects: Array<{
    label: string;
    keywords: string[];
  }>;
}

const legacyBuiltInCatalog = rawLegacyCatalog as LegacyBuiltInMaterialCatalogSource;
const seedEntryById = new Map(
  MATERIAL_CATALOG_SEED_ENTRIES.map((entry) => [entry.id, entry] as const),
);

function seedEntryMatches(entry: BuiltInMaterialSeedEntry, normalizedQuery: string): boolean {
  return [entry.title, ...(entry.aliases ?? [])].some(
    (value) => normalizeMaterialCatalogTitle(value) === normalizedQuery,
  );
}

function seedCandidate(entry: BuiltInMaterialSeedEntry): MaterialMetadataCandidate {
  return {
    catalogEntryId: `seed:${entry.id}`,
    title: normalizeMaterialSearchText(entry.title),
    authors: [],
    subjectHint: entry.subject,
    materialKind: entry.kind,
    aliases: entry.aliases ?? [],
    resolutionRequired: entry.resolutionRequired === true,
  };
}

function dedupeCandidates(candidates: MaterialMetadataCandidate[]): MaterialMetadataCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalizeMaterialCatalogTitle(candidate.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function searchCuratedSeries(normalizedQuery: string): MaterialMetadataCandidate[] {
  const series = MATERIAL_CATALOG_SERIES_ALIASES.find(
    ({ alias }) => normalizeMaterialCatalogTitle(alias) === normalizedQuery,
  );
  if (!series) return [];

  return dedupeCandidates(
    series.entryIds.flatMap((entryId) => {
      const entry = seedEntryById.get(entryId);
      return entry ? [seedCandidate(entry)] : [];
    }),
  ).slice(0, MAX_BUILT_IN_RESULTS);
}

function searchCuratedSeed(normalizedQuery: string): MaterialMetadataCandidate[] {
  const matches = MATERIAL_CATALOG_SEED_ENTRIES
    .filter((entry) => seedEntryMatches(entry, normalizedQuery))
    .sort((left, right) => {
      const leftDiscovery = left.resolutionRequired === true ? 1 : 0;
      const rightDiscovery = right.resolutionRequired === true ? 1 : 0;
      if (leftDiscovery !== rightDiscovery) return leftDiscovery - rightDiscovery;
      const leftExact = normalizeMaterialCatalogTitle(left.title) === normalizedQuery ? 0 : 1;
      const rightExact = normalizeMaterialCatalogTitle(right.title) === normalizedQuery ? 0 : 1;
      return leftExact - rightExact || left.title.localeCompare(right.title, 'ja');
    })
    .map(seedCandidate);

  return dedupeCandidates(matches).slice(0, MAX_BUILT_IN_RESULTS);
}

function searchLegacyFallback(normalizedQuery: string): MaterialMetadataCandidate[] {
  if (normalizedQuery.length < MIN_LEGACY_FALLBACK_LENGTH) return [];

  const subjectLabels = new Set(
    legacyBuiltInCatalog.subjects.map((subject) => normalizeMaterialCatalogTitle(subject.label)),
  );
  const matches = new Map<string, MaterialMetadataCandidate>();

  legacyBuiltInCatalog.subjects.forEach((subject) => {
    subject.keywords.forEach((keyword) => {
      const title = normalizeMaterialSearchText(keyword);
      const normalizedTitle = normalizeMaterialCatalogTitle(title);
      if (!normalizedTitle || subjectLabels.has(normalizedTitle)) return;
      if (normalizedTitle !== normalizedQuery || matches.has(normalizedTitle)) return;

      matches.set(normalizedTitle, {
        catalogEntryId: `builtin-legacy:${normalizedTitle}`,
        title,
        authors: [],
        subjectHint: subject.label,
        materialKind: '既存候補',
        resolutionRequired: true,
      });
    });
  });

  return Array.from(matches.values()).slice(0, MAX_BUILT_IN_RESULTS);
}

export function searchBuiltInMaterialCatalog(query: string): MaterialMetadataCandidate[] {
  const classified = classifyMaterialMetadataQuery(query);
  if (!classified || classified.kind !== 'title') return [];

  const normalizedQuery = normalizeMaterialCatalogTitle(classified.value);
  const series = searchCuratedSeries(normalizedQuery);
  if (series.length > 0) return series;

  const curated = searchCuratedSeed(normalizedQuery);
  if (curated.length > 0) return curated;

  return searchLegacyFallback(normalizedQuery);
}
