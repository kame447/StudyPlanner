import { doc, getDoc } from 'firebase/firestore';
import rawCatalog from './naturalLanguageCatalog.json';
import { getFirestoreDb } from '../lib/firebaseClient';
import type { PlanType } from '../types/domain';

export interface SubjectCatalogEntry {
  label: string;
  keywords: string[];
}

export interface PlanTypeCatalogEntry {
  type: PlanType;
  keywords: string[];
}

export interface NaturalLanguageCatalog {
  version: number;
  subjects: SubjectCatalogEntry[];
  planTypes: PlanTypeCatalogEntry[];
  actionWords: string[];
}

const CATALOG_COLLECTION = 'app_catalogs';
const CATALOG_DOCUMENT_ID = 'natural_language_v1';

function normalizeKeywordList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
}

function normalizeSubjects(value: unknown): SubjectCatalogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const label =
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { label?: unknown }).label === 'string'
          ? (entry as { label: string }).label.trim()
          : '';
      const keywords =
        typeof entry === 'object' && entry !== null
          ? normalizeKeywordList((entry as { keywords?: unknown }).keywords)
          : [];

      if (!label || keywords.length === 0) {
        return undefined;
      }

      return {
        label,
        keywords,
      };
    })
    .filter((entry): entry is SubjectCatalogEntry => Boolean(entry));
}

function normalizePlanTypes(value: unknown): PlanTypeCatalogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const type =
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { type?: unknown }).type === 'string'
          ? (entry as { type: string }).type.trim()
          : '';
      const keywords =
        typeof entry === 'object' && entry !== null
          ? normalizeKeywordList((entry as { keywords?: unknown }).keywords)
          : [];

      if (!type || keywords.length === 0) {
        return undefined;
      }

      return {
        type: type as PlanType,
        keywords,
      };
    })
    .filter((entry): entry is PlanTypeCatalogEntry => Boolean(entry));
}

function normalizeCatalog(value: unknown): NaturalLanguageCatalog {
  const defaultCatalog = rawCatalog as Omit<NaturalLanguageCatalog, 'version'>;
  const source = typeof value === 'object' && value !== null ? value : {};

  const subjects = normalizeSubjects(
    (source as { subjects?: unknown }).subjects ?? defaultCatalog.subjects,
  );
  const planTypes = normalizePlanTypes(
    (source as { planTypes?: unknown }).planTypes ?? defaultCatalog.planTypes,
  );
  const actionWords = normalizeKeywordList(
    (source as { actionWords?: unknown }).actionWords ?? defaultCatalog.actionWords,
  );
  const version =
    typeof (source as { version?: unknown }).version === 'number'
      ? (source as { version: number }).version
      : 1;

  return {
    version,
    subjects:
      subjects.length > 0 ? subjects : normalizeSubjects(defaultCatalog.subjects),
    planTypes:
      planTypes.length > 0
        ? planTypes
        : normalizePlanTypes(defaultCatalog.planTypes),
    actionWords:
      actionWords.length > 0
        ? actionWords
        : normalizeKeywordList(defaultCatalog.actionWords),
  };
}

const fallbackCatalog = normalizeCatalog(rawCatalog);
let currentCatalog: NaturalLanguageCatalog = fallbackCatalog;
export interface NaturalLanguageCatalogLoadResult {
  catalog: NaturalLanguageCatalog;
  source: 'server' | 'cache' | 'fallback';
}
let loadPromise: Promise<NaturalLanguageCatalogLoadResult> | null = null;

export function getNaturalLanguageCatalog(): NaturalLanguageCatalog {
  return currentCatalog;
}

export async function loadNaturalLanguageCatalog(
  options: { seedWhenMissing?: boolean } = {},
): Promise<NaturalLanguageCatalog> {
  return (await loadNaturalLanguageCatalogWithOutcome(options)).catalog;
}

// Report provenance without retaining settled data as a cross-session cache.
// The compatibility option does not create or seed catalog documents.
export async function loadNaturalLanguageCatalogWithOutcome(
  _options: { seedWhenMissing?: boolean } = {},
): Promise<NaturalLanguageCatalogLoadResult> {
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const firestoreDb = getFirestoreDb();

    if (!firestoreDb) {
      currentCatalog = fallbackCatalog;
      return { catalog: currentCatalog, source: 'fallback' as const };
    }

    const catalogRef = doc(firestoreDb, CATALOG_COLLECTION, CATALOG_DOCUMENT_ID);

    try {
      const snapshot = await getDoc(catalogRef);

      if (snapshot.exists()) {
        currentCatalog = normalizeCatalog(snapshot.data());
        return { catalog: currentCatalog, source: snapshot.metadata?.fromCache === false ? 'server' as const : 'cache' as const };
      }
    } catch (error) {
      console.warn('[NaturalLanguageCatalog] failed to load from Firestore', error);
    }

    currentCatalog = fallbackCatalog;
    return { catalog: currentCatalog, source: 'fallback' as const };
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}
