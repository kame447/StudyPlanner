import rawCatalog from './naturalLanguageCatalog.json';
import type { PlanType } from '../types/domain';

interface SubjectCatalogEntry {
  label: string;
  keywords: string[];
}

interface PlanTypeCatalogEntry {
  type: PlanType;
  keywords: string[];
}

interface NaturalLanguageCatalog {
  subjects: SubjectCatalogEntry[];
  planTypes: PlanTypeCatalogEntry[];
  actionWords: string[];
}

export const naturalLanguageCatalog = rawCatalog as NaturalLanguageCatalog;
