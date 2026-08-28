import certifications from './certifications.json';
import english from './english.json';
import exams from './exams.json';
import japanese from './japanese.json';
import math from './math.json';
import science from './science.json';
import social from './social.json';
import university from './university.json';

export interface BuiltInMaterialSeedEntry {
  id: string;
  title: string;
  subject: string;
  kind: string;
  aliases?: string[];
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
] as BuiltInMaterialSeedEntry[];
