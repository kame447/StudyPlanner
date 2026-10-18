export type MaterialMetadataQueryKind = 'isbn' | 'title';

export interface MaterialMetadataCandidate {
  catalogEntryId: string;
  title: string;
  authors: string[];
  publisher?: string;
  publishedYear?: number;
  edition?: string;
  isbn10?: string;
  isbn13?: string;
  coverImageUrl?: string;
  pageCount?: number;
  tableOfContents?: string[];
  subjectHint?: string;
  materialKind?: string;
  aliases?: string[];
  resolutionRequired?: boolean;
}

export interface MaterialMetadataSearchResponse {
  results: MaterialMetadataCandidate[];
  cacheHit: boolean;
}

export interface MaterialMetadataDetailsResponse {
  candidate: MaterialMetadataCandidate;
}

const ISBN10_PATTERN = /^\d{9}[\dX]$/;
const ISBN13_PATTERN = /^97[89]\d{10}$/;

export function normalizeMaterialSearchText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function normalizeMaterialCatalogTitle(value: string): string {
  return normalizeMaterialSearchText(value)
    .toLocaleLowerCase('ja')
    .replace(/[\s\-‐‑‒–—―・･:：,，.．!！?？'"「」『』（）()【】\[\]]+/g, '');
}

function isValidIsbn10(value: string): boolean {
  if (!ISBN10_PATTERN.test(value)) return false;
  const sum = value.split('').reduce((total, character, index) => {
    const digit = character === 'X' ? 10 : Number(character);
    return total + digit * (10 - index);
  }, 0);
  return sum % 11 === 0;
}

function isValidIsbn13(value: string): boolean {
  if (!ISBN13_PATTERN.test(value)) return false;
  const sum = value.split('').reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return sum % 10 === 0;
}

export function normalizeIsbn(value: string): string | null {
  const compact = value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^0-9X]/g, '');
  if (compact.length === 10 && isValidIsbn10(compact)) return compact;
  if (compact.length === 13 && isValidIsbn13(compact)) return compact;
  return null;
}

export function classifyMaterialMetadataQuery(value: string): {
  kind: MaterialMetadataQueryKind;
  value: string;
} | null {
  const normalizedText = normalizeMaterialSearchText(value);
  if (!normalizedText) return null;
  const isbn = normalizeIsbn(normalizedText);
  if (isbn) return { kind: 'isbn', value: isbn };
  if (normalizedText.length < 2 || normalizedText.length > 120) return null;
  return { kind: 'title', value: normalizedText };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isMaterialMetadataCandidate(value: unknown): value is MaterialMetadataCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MaterialMetadataCandidate>;
  return typeof candidate.catalogEntryId === 'string'
    && Boolean(candidate.catalogEntryId.trim())
    && typeof candidate.title === 'string'
    && Boolean(candidate.title.trim())
    && isStringArray(candidate.authors)
    && (candidate.publisher === undefined || typeof candidate.publisher === 'string')
    && (candidate.publishedYear === undefined || Number.isInteger(candidate.publishedYear))
    && (candidate.edition === undefined || typeof candidate.edition === 'string')
    && (candidate.isbn10 === undefined || typeof candidate.isbn10 === 'string')
    && (candidate.isbn13 === undefined || typeof candidate.isbn13 === 'string')
    && (candidate.coverImageUrl === undefined || typeof candidate.coverImageUrl === 'string')
    && (candidate.pageCount === undefined
      || (Number.isInteger(candidate.pageCount) && candidate.pageCount >= 0))
    && (candidate.tableOfContents === undefined || isStringArray(candidate.tableOfContents))
    && (candidate.subjectHint === undefined || typeof candidate.subjectHint === 'string')
    && (candidate.materialKind === undefined || typeof candidate.materialKind === 'string')
    && (candidate.aliases === undefined || isStringArray(candidate.aliases))
    && (candidate.resolutionRequired === undefined || typeof candidate.resolutionRequired === 'boolean');
}
