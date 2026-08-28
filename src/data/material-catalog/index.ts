import certifications from './certifications.json';
import english from './english.json';
import exams from './exams.json';
import japanese from './japanese.json';
import math from './math.json';
import science from './science.json';
import seriesAliases from './series-aliases.json';
import social from './social.json';
import university from './university.json';
import verifiedSeries from './verified-series.json';

export interface BuiltInMaterialSeedEntry {
  id: string;
  title: string;
  subject: string;
  kind: string;
  aliases?: string[];
}

export interface BuiltInMaterialSeriesAlias {
  alias: string;
  entryIds: string[];
}

export const MATERIAL_CATALOG_SEED_VERSION = 1;

export const MATERIAL_CATALOG_SEED_ENTRIES: BuiltInMaterialSeedEntry[] = [
  ...math,
  ...english,
  ...japanese,
  ...science,
  ...social,
  ...exams,
  ...certifications,
  ...university,
  ...verifiedSeries,
] as BuiltInMaterialSeedEntry[];

export const MATERIAL_CATALOG_SERIES_ALIASES = seriesAliases as BuiltInMaterialSeriesAlias[];
