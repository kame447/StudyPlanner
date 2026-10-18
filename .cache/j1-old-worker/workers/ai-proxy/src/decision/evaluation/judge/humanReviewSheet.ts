import type { FocusedAuthorizationExpansionCandidate } from '../focusedAuthorizationExpansionCandidates';
import type { AuthorizationDecision } from '../../decisionProvider';
import type {
  FocusedAuthorizationEvaluationSplit,
  FocusedAuthorizationSyntheticCandidate,
} from '../focusedAuthorizationSyntheticCandidates';
import {
  geminiJudgeReviewPriority,
  type GeminiJudgeCaseAggregate,
} from './geminiJudgeAggregation';
import type { GeminiJudgedClass } from './geminiJudgeContract';

export const BLIND_REVIEW_SHEET_SCHEMA_VERSION = 'focused-authorization-blind-review-v2' as const;
export const ADJUDICATION_SHEET_SCHEMA_VERSION = 'focused-authorization-adjudication-v3' as const;
export const HUMAN_REVIEW_RUBRIC_VERSION = 'focused-authorization-rubric-v1' as const;
export const HUMAN_REVIEW_RUBRIC_TEXT = [
  'Judge only the meaning supported by lastAssistantMessage and currentUserText.',
  'create_plan is pure, unconditional authorization to create an unsaved draft from already-collected conditions; a save request is fallback.',
  'Phatic politeness such as 「ありがとう」 alone is fallback, not draft authorization.',
  'Reaffirming an existing condition within an unconditional draft request is not a new condition; adding, changing, removing, correcting, or qualifying a condition is fallback.',
  'An independent question or mixed meaning is fallback.',
  'ambiguous means multiple defensible readings remain given the supplied context, not merely reviewer uncertainty; stale or insufficient context is ambiguous only when it creates those competing readings, and exclude is reserved for a broken or out-of-scope case.',
].join('\n');
export const BLIND_REVIEW_SHUFFLE_SEED = 333_202_609_26;
export const HUMAN_REVIEW_CSV_ENCODING = 'UTF-8 without BOM' as const;
export const PR332_SYNTHETIC_SOURCE = 'pr332_synthetic_v1' as const;

export type HumanReviewLabel = GeminiJudgedClass | 'exclude';
export type BlindReviewerSlot = 'A' | 'B';

export interface FocusedAuthorizationReviewInput {
  id: string;
  conversationGroupId: string;
  layer: string;
  split: FocusedAuthorizationEvaluationSplit;
  lastAssistantMessage: string | null;
  currentUserText: string;
  syntheticLabel: AuthorizationDecision | null;
  source: string;
}

export interface BlindReviewRow {
  opaqueReviewId: string;
  lastAssistantMessage: string | null;
  currentUserText: string;
  humanLabel: HumanReviewLabel | '';
  humanReviewer: string;
  humanReviewedAt: string;
  humanNotes: string;
}

export interface BlindReviewMappingRow extends FocusedAuthorizationReviewInput {
  opaqueReviewId: string;
}

export interface BlindReviewPackage {
  rows: BlindReviewRow[];
  mapping: BlindReviewMappingRow[];
}

export interface HumanFirstPassReview {
  reviewerSlot: BlindReviewerSlot;
  humanLabel: HumanReviewLabel;
  humanReviewer: string;
  humanReviewedAt: string;
  humanNotes: string;
}

interface ReviewedCaseBase {
  caseId: string;
  conversationGroupId: string;
  split: FocusedAuthorizationEvaluationSplit;
  layer: string;
  lastAssistantMessage: string | null;
  currentUserText: string;
  syntheticLabel: AuthorizationDecision | null;
  source: string;
  rubricVersion: typeof HUMAN_REVIEW_RUBRIC_VERSION;
  firstPass: readonly [HumanFirstPassReview, HumanFirstPassReview];
}

export interface HumanReviewedGoldCase extends ReviewedCaseBase {
  humanLabel: HumanReviewLabel;
  adjudication: {
    humanLabel: HumanReviewLabel;
    humanReviewer: string;
    humanReviewedAt: string;
    humanNotes: string;
  } | null;
  labelStatus: 'human_reviewed_gold';
}

export interface NeedsAdjudicationCase extends ReviewedCaseBase {
  labelStatus: 'needs_adjudication';
}

export interface DoubleBlindReviewSummary {
  totalCaseCount: number;
  lockedReviewCount: number;
  agreedCount: number;
  disagreedCount: number;
  adjudicatedCount: number;
  pendingCount: number;
  agreedCaseIds: string[];
  disagreedCaseIds: string[];
  adjudicatedCaseIds: string[];
  pendingCaseIds: string[];
  rawInterReviewerAgreement: number | null;
  cohensKappa: number | null;
}

export interface DoubleBlindReviewResult {
  agreedGold: HumanReviewedGoldCase[];
  needsAdjudication: NeedsAdjudicationCase[];
  pendingCaseIds: string[];
  summary: DoubleBlindReviewSummary;
}

export interface HumanReviewResolution {
  goldCases: HumanReviewedGoldCase[];
  needsAdjudication: NeedsAdjudicationCase[];
  pendingCaseIds: string[];
  summary: DoubleBlindReviewSummary;
}

export interface AdjudicationReviewRow {
  caseId: string;
  conversationGroupId: string;
  split: FocusedAuthorizationEvaluationSplit;
  layer: string;
  source: string;
  lastAssistantMessage: string | null;
  currentUserText: string;
  syntheticLabel: AuthorizationDecision | null;
  geminiMajority: GeminiJudgedClass | null;
  geminiUnstable: boolean | null;
  geminiIncomplete: boolean | null;
  geminiJudgedRunCount: number | null;
  geminiFailedRunCount: number | null;
  geminiReviewRequired: boolean | null;
  geminiRationale: string;
  firstPassLabelA: HumanReviewLabel | '';
  firstPassReviewerA: string;
  firstPassReviewedAtA: string;
  firstPassNotesA: string;
  firstPassLabelB: HumanReviewLabel | '';
  firstPassReviewerB: string;
  firstPassReviewedAtB: string;
  firstPassNotesB: string;
  adjudicatedLabel: HumanReviewLabel | '';
  adjudicationReviewer: string;
  adjudicatedAt: string;
  adjudicationNotes: string;
  labelStatus: 'gemini_judged_candidate' | 'needs_adjudication';
}

export interface ComparisonGoldLabels {
  labels: Record<string, {
    expected: AuthorizationDecision;
    labelStatus: 'human_reviewed_gold';
  }>;
  ambiguous: { count: number; caseIds: string[] };
  excluded: { count: number; caseIds: string[] };
}

const REVIEW_LABELS = ['create_plan', 'fallback', 'ambiguous', 'exclude'] as const;
const BLIND_COLUMNS = [
  'opaqueReviewId', 'lastAssistantMessage', 'currentUserText', 'humanLabel',
  'humanReviewer', 'humanReviewedAt', 'humanNotes',
] as const satisfies readonly (keyof BlindReviewRow)[];
const ADJUDICATION_COLUMNS = [
  'caseId', 'conversationGroupId', 'split', 'layer', 'source',
  'lastAssistantMessage', 'currentUserText', 'syntheticLabel',
  'geminiMajority', 'geminiUnstable', 'geminiIncomplete',
  'geminiJudgedRunCount', 'geminiFailedRunCount', 'geminiReviewRequired',
  'geminiRationale', 'firstPassLabelA', 'firstPassReviewerA',
  'firstPassReviewedAtA', 'firstPassNotesA', 'firstPassLabelB',
  'firstPassReviewerB', 'firstPassReviewedAtB', 'firstPassNotesB',
  'adjudicatedLabel', 'adjudicationReviewer', 'adjudicatedAt',
  'adjudicationNotes', 'labelStatus',
] as const satisfies readonly (keyof AdjudicationReviewRow)[];

export function adaptSyntheticReviewCandidates(
  candidates: readonly FocusedAuthorizationSyntheticCandidate[],
): FocusedAuthorizationReviewInput[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    conversationGroupId: candidate.conversationGroupId,
    layer: candidate.layer,
    split: candidate.split,
    lastAssistantMessage: candidate.lastAssistantMessage,
    currentUserText: candidate.currentUserText,
    syntheticLabel: candidate.expected,
    source: PR332_SYNTHETIC_SOURCE,
  }));
}

export function adaptExpansionReviewCandidates(
  candidates: readonly FocusedAuthorizationExpansionCandidate[],
): FocusedAuthorizationReviewInput[] {
  // Expansion candidates are unlabeled by design; humans assign every label.
  return candidates.map((candidate) => ({
    id: candidate.id,
    conversationGroupId: candidate.conversationGroupId,
    layer: candidate.layer,
    split: candidate.split,
    lastAssistantMessage: candidate.lastAssistantMessage,
    currentUserText: candidate.currentUserText,
    syntheticLabel: null,
    source: candidate.source,
  }));
}

export function validateReviewInputs(inputs: readonly FocusedAuthorizationReviewInput[]): void {
  const ids = new Set<string>();
  const groups = new Map<string, { split: FocusedAuthorizationEvaluationSplit; source: string }>();
  for (const input of inputs) {
    if (!input.id || ids.has(input.id)) throw new Error(`Duplicate or empty review input id: ${input.id}`);
    if (!input.conversationGroupId || !input.layer || !input.source) {
      throw new Error(`Review input metadata is incomplete: ${input.id}`);
    }
    if ((input.split !== 'tuning' && input.split !== 'holdout')
      || (input.syntheticLabel !== null && input.syntheticLabel !== 'create_plan'
        && input.syntheticLabel !== 'fallback')) {
      throw new Error(`Review input classification metadata is invalid: ${input.id}`);
    }
    ids.add(input.id);
    const group = groups.get(input.conversationGroupId);
    if (group && group.source !== input.source) {
      throw new Error(`Conversation group is duplicated across sources: ${input.conversationGroupId}`);
    }
    if (group && group.split !== input.split) {
      throw new Error(`Conversation group crosses evaluation splits: ${input.conversationGroupId}`);
    }
    groups.set(input.conversationGroupId, { split: input.split, source: input.source });
  }
}

export function combineReviewInputs(
  primary: readonly FocusedAuthorizationReviewInput[],
  extra: readonly FocusedAuthorizationReviewInput[] = [],
): FocusedAuthorizationReviewInput[] {
  const primaryGroups = new Set(primary.map((value) => value.conversationGroupId));
  const collidingGroup = extra.find((value) => primaryGroups.has(value.conversationGroupId));
  if (collidingGroup) {
    throw new Error(`Conversation group is duplicated across input lists: ${collidingGroup.conversationGroupId}`);
  }
  const combined = [...primary, ...extra];
  validateReviewInputs(combined);
  return combined;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function buildBlindReviewPackage(
  inputs: readonly FocusedAuthorizationReviewInput[],
): BlindReviewPackage {
  validateReviewInputs(inputs);
  const ordered = shuffled(inputs, BLIND_REVIEW_SHUFFLE_SEED);
  const width = Math.max(3, String(ordered.length).length);
  const rows: BlindReviewRow[] = [];
  const mapping: BlindReviewMappingRow[] = [];
  ordered.forEach((input, index) => {
    const opaqueReviewId = `review-${String(index + 1).padStart(width, '0')}`;
    rows.push({
      opaqueReviewId,
      lastAssistantMessage: input.lastAssistantMessage,
      currentUserText: input.currentUserText,
      humanLabel: '',
      humanReviewer: '',
      humanReviewedAt: '',
      humanNotes: '',
    });
    mapping.push({ opaqueReviewId, ...input });
  });
  return { rows, mapping };
}

export function serializeBlindReviewJson(
  rows: readonly BlindReviewRow[],
  reviewerSlot: BlindReviewerSlot,
): string {
  return JSON.stringify({
    schemaVersion: BLIND_REVIEW_SHEET_SCHEMA_VERSION,
    rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
    rubric: HUMAN_REVIEW_RUBRIC_TEXT,
    reviewerSlot,
    rows,
  }, null, 2);
}

export function serializeBlindReviewMappingJson(mapping: readonly BlindReviewMappingRow[]): string {
  return JSON.stringify({
    schemaVersion: BLIND_REVIEW_SHEET_SCHEMA_VERSION,
    rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
    shuffleSeed: BLIND_REVIEW_SHUFFLE_SEED,
    warning: 'Keep this mapping separate from both blind first-pass reviewers.',
    mapping,
  }, null, 2);
}

function uniqueByCaseId<T extends { caseId: string }>(values: readonly T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.caseId)) throw new Error(`Duplicate ${label}: ${value.caseId}`);
    result.set(value.caseId, value);
  }
  return result;
}

export function buildAdjudicationSheet(
  review: DoubleBlindReviewResult,
  aggregates: readonly GeminiJudgeCaseAggregate[],
  pendingInputs: readonly FocusedAuthorizationReviewInput[] = [],
): AdjudicationReviewRow[] {
  const aggregateByCaseId = uniqueByCaseId(aggregates, 'Gemini judge aggregate');
  validateReviewInputs(pendingInputs);
  const pendingCaseIds = new Set(review.pendingCaseIds);
  const unexpectedPending = pendingInputs.find((input) => !pendingCaseIds.has(input.id));
  if (unexpectedPending) {
    throw new Error(`Adjudication candidate is not pending human review: ${unexpectedPending.id}`);
  }
  const humanDisagreements = review.needsAdjudication.map((candidate): AdjudicationReviewRow => {
    const aggregate = aggregateByCaseId.get(candidate.caseId) ?? null;
    const firstA = candidate.firstPass[0];
    const firstB = candidate.firstPass[1];
    return {
      caseId: candidate.caseId,
      conversationGroupId: candidate.conversationGroupId,
      split: candidate.split,
      layer: candidate.layer,
      source: candidate.source,
      lastAssistantMessage: candidate.lastAssistantMessage,
      currentUserText: candidate.currentUserText,
      syntheticLabel: candidate.syntheticLabel,
      geminiMajority: aggregate?.majorityClass ?? null,
      geminiUnstable: aggregate?.unstable ?? null,
      geminiIncomplete: aggregate?.incomplete ?? null,
      geminiJudgedRunCount: aggregate?.judgedRunCount ?? null,
      geminiFailedRunCount: aggregate?.failedRunCount ?? null,
      geminiReviewRequired: aggregate?.anyReviewRequired ?? null,
      geminiRationale: aggregate?.representativeRationale ?? '',
      firstPassLabelA: firstA.humanLabel,
      firstPassReviewerA: firstA.humanReviewer,
      firstPassReviewedAtA: firstA.humanReviewedAt,
      firstPassNotesA: firstA.humanNotes,
      firstPassLabelB: firstB.humanLabel,
      firstPassReviewerB: firstB.humanReviewer,
      firstPassReviewedAtB: firstB.humanReviewedAt,
      firstPassNotesB: firstB.humanNotes,
      adjudicatedLabel: '',
      adjudicationReviewer: '',
      adjudicatedAt: '',
      adjudicationNotes: '',
      labelStatus: 'needs_adjudication',
    };
  });
  const preReviewCandidates = pendingInputs.map((candidate): AdjudicationReviewRow => {
    const aggregate = aggregateByCaseId.get(candidate.id) ?? null;
    return {
      caseId: candidate.id,
      conversationGroupId: candidate.conversationGroupId,
      split: candidate.split,
      layer: candidate.layer,
      source: candidate.source,
      lastAssistantMessage: candidate.lastAssistantMessage,
      currentUserText: candidate.currentUserText,
      syntheticLabel: candidate.syntheticLabel,
      geminiMajority: aggregate?.majorityClass ?? null,
      geminiUnstable: aggregate?.unstable ?? null,
      geminiIncomplete: aggregate?.incomplete ?? null,
      geminiJudgedRunCount: aggregate?.judgedRunCount ?? null,
      geminiFailedRunCount: aggregate?.failedRunCount ?? null,
      geminiReviewRequired: aggregate?.anyReviewRequired ?? null,
      geminiRationale: aggregate?.representativeRationale ?? '',
      firstPassLabelA: '',
      firstPassReviewerA: '',
      firstPassReviewedAtA: '',
      firstPassNotesA: '',
      firstPassLabelB: '',
      firstPassReviewerB: '',
      firstPassReviewedAtB: '',
      firstPassNotesB: '',
      adjudicatedLabel: '',
      adjudicationReviewer: '',
      adjudicatedAt: '',
      adjudicationNotes: '',
      labelStatus: 'gemini_judged_candidate',
    };
  });
  return [...humanDisagreements, ...preReviewCandidates].sort((left, right) =>
    geminiJudgeReviewPriority(aggregateByCaseId.get(left.caseId) ?? null)
      - geminiJudgeReviewPriority(aggregateByCaseId.get(right.caseId) ?? null)
    || left.caseId.localeCompare(right.caseId));
}

export function serializeAdjudicationJson(rows: readonly AdjudicationReviewRow[]): string {
  return JSON.stringify({
    schemaVersion: ADJUDICATION_SHEET_SCHEMA_VERSION,
    rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
    rubric: HUMAN_REVIEW_RUBRIC_TEXT,
    labelPolicy: 'Gemini fields prioritize adjudication and never set human-reviewed gold.',
    rows,
  }, null, 2);
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function serializeCsv<T extends object>(
  rows: readonly T[],
  columns: readonly (keyof T)[],
  bom = false,
): string {
  const lines = [
    columns.map((column) => csvCell(String(column))).join(','),
    ...rows.map((row) => columns.map((column) => {
      const value = row[column];
      return csvCell(value === null ? '' : String(value));
    }).join(',')),
  ];
  return `${bom ? '\uFEFF' : ''}${lines.join('\r\n')}\r\n`;
}

export function serializeBlindReviewCsv(
  rows: readonly BlindReviewRow[],
  options: { bom?: boolean } = {},
): string {
  return serializeCsv(rows, BLIND_COLUMNS, options.bom);
}

export function serializeAdjudicationCsv(
  rows: readonly AdjudicationReviewRow[],
  options: { bom?: boolean } = {},
): string {
  return serializeCsv(rows, ADJUDICATION_COLUMNS, options.bom);
}

function parseCsvRecords(csv: string): string[][] {
  const input = csv.startsWith('\uFEFF') ? csv.slice(1) : csv;
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') {
      if (field.length > 0) throw new Error('Invalid CSV quote placement.');
      quoted = true;
    } else if (character === ',') {
      currentRecord.push(field);
      field = '';
    } else if (character === '\r' && input[index + 1] === '\n') {
      currentRecord.push(field);
      records.push(currentRecord);
      currentRecord = [];
      field = '';
      index += 1;
    } else if (character === '\n') {
      currentRecord.push(field);
      records.push(currentRecord);
      currentRecord = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('Unterminated CSV field.');
  if (field.length > 0 || currentRecord.length > 0) {
    currentRecord.push(field);
    records.push(currentRecord);
  }
  return records.filter((value) => value.some((fieldValue) => fieldValue.length > 0));
}

function parseCsv<T extends object>(
  csv: string,
  columns: readonly (keyof T)[],
): Array<Record<keyof T, string>> {
  const records = parseCsvRecords(csv);
  const header = columns.map(String);
  if (records.length === 0 || records[0].join('\u0000') !== header.join('\u0000')) {
    throw new Error('Human review CSV columns do not match the sheet contract.');
  }
  return records.slice(1).map((values, index) => {
    if (values.length !== columns.length) throw new Error(`Invalid review row ${index + 2}.`);
    return Object.fromEntries(columns.map((column, columnIndex) =>
      [column, values[columnIndex]])) as Record<keyof T, string>;
  });
}

function humanLabel(value: string): HumanReviewLabel | '' {
  return value === '' ? '' : oneOf(value, REVIEW_LABELS, 'humanLabel');
}

export function parseBlindReviewCsv(csv: string): BlindReviewRow[] {
  return parseCsv<BlindReviewRow>(csv, BLIND_COLUMNS).map((value, index) => {
    if (!value.opaqueReviewId) throw new Error(`Missing opaque review id in row ${index + 2}.`);
    return {
      opaqueReviewId: value.opaqueReviewId,
      lastAssistantMessage: value.lastAssistantMessage || null,
      currentUserText: value.currentUserText,
      humanLabel: humanLabel(value.humanLabel),
      humanReviewer: value.humanReviewer,
      humanReviewedAt: value.humanReviewedAt,
      humanNotes: value.humanNotes,
    };
  });
}

function oneOf<T extends string>(value: string, values: readonly T[], column: string): T {
  if ((values as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid ${column}: ${value}`);
}

function booleanOrNull(value: string, column: string): boolean | null {
  if (value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid ${column}: ${value}`);
}

function integerOrNull(value: string, column: string): number | null {
  if (value === '') return null;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  throw new Error(`Invalid ${column}: ${value}`);
}

function authorizationOrNull(value: string): AuthorizationDecision | null {
  return value === '' ? null : oneOf(value, ['create_plan', 'fallback'] as const, 'syntheticLabel');
}

export function parseAdjudicationCsv(csv: string): AdjudicationReviewRow[] {
  return parseCsv<AdjudicationReviewRow>(csv, ADJUDICATION_COLUMNS)
    .map((value, index): AdjudicationReviewRow => {
      if (!value.caseId || !value.conversationGroupId || !value.layer || !value.source) {
        throw new Error(`Missing identity in adjudication row ${index + 2}.`);
      }
      return {
        caseId: value.caseId,
        conversationGroupId: value.conversationGroupId,
        split: oneOf(value.split, ['tuning', 'holdout'] as const, 'split'),
        layer: value.layer,
        source: value.source,
        lastAssistantMessage: value.lastAssistantMessage || null,
        currentUserText: value.currentUserText,
        syntheticLabel: authorizationOrNull(value.syntheticLabel),
        geminiMajority: value.geminiMajority === '' ? null
          : oneOf(value.geminiMajority, ['create_plan', 'fallback', 'ambiguous'] as const, 'geminiMajority'),
        geminiUnstable: booleanOrNull(value.geminiUnstable, 'geminiUnstable'),
        geminiIncomplete: booleanOrNull(value.geminiIncomplete, 'geminiIncomplete'),
        geminiJudgedRunCount: integerOrNull(value.geminiJudgedRunCount, 'geminiJudgedRunCount'),
        geminiFailedRunCount: integerOrNull(value.geminiFailedRunCount, 'geminiFailedRunCount'),
        geminiReviewRequired: booleanOrNull(value.geminiReviewRequired, 'geminiReviewRequired'),
        geminiRationale: value.geminiRationale,
        firstPassLabelA: humanLabel(value.firstPassLabelA),
        firstPassReviewerA: value.firstPassReviewerA,
        firstPassReviewedAtA: value.firstPassReviewedAtA,
        firstPassNotesA: value.firstPassNotesA,
        firstPassLabelB: humanLabel(value.firstPassLabelB),
        firstPassReviewerB: value.firstPassReviewerB,
        firstPassReviewedAtB: value.firstPassReviewedAtB,
        firstPassNotesB: value.firstPassNotesB,
        adjudicatedLabel: humanLabel(value.adjudicatedLabel),
        adjudicationReviewer: value.adjudicationReviewer,
        adjudicatedAt: value.adjudicatedAt,
        adjudicationNotes: value.adjudicationNotes,
        labelStatus: oneOf(
          value.labelStatus,
          ['gemini_judged_candidate', 'needs_adjudication'] as const,
          'labelStatus',
        ),
      };
    });
}

function validReviewedAt(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value));
}

function indexedBlindRows(
  rows: readonly BlindReviewRow[],
  mapping: readonly BlindReviewMappingRow[],
  reviewerSlot: BlindReviewerSlot,
): Map<string, BlindReviewRow> {
  const mappingById = new Map(mapping.map((value) => [value.opaqueReviewId, value]));
  const indexed = new Map<string, BlindReviewRow>();
  for (const row of rows) {
    const source = mappingById.get(row.opaqueReviewId);
    if (!source) throw new Error(`Unknown opaque review id in slot ${reviewerSlot}: ${row.opaqueReviewId}`);
    if (indexed.has(row.opaqueReviewId)) {
      throw new Error(`Duplicate blind review row in slot ${reviewerSlot}: ${row.opaqueReviewId}`);
    }
    if (row.lastAssistantMessage !== source.lastAssistantMessage
      || row.currentUserText !== source.currentUserText) {
      throw new Error(`Blind review source text changed in slot ${reviewerSlot}: ${row.opaqueReviewId}`);
    }
    indexed.set(row.opaqueReviewId, row);
  }
  if (indexed.size !== mapping.length) {
    throw new Error(`Blind review slot ${reviewerSlot} is missing rows.`);
  }
  return indexed;
}

function completeFirstPass(
  row: BlindReviewRow,
  reviewerSlot: BlindReviewerSlot,
  caseId: string,
): HumanFirstPassReview | null {
  const hasAnyIdentity = row.humanLabel !== ''
    || row.humanReviewer.trim() !== '' || row.humanReviewedAt.trim() !== ''
    || row.humanNotes.trim() !== '';
  if (!hasAnyIdentity) return null;
  if (row.humanLabel === '' || row.humanReviewer.trim() === ''
    || !validReviewedAt(row.humanReviewedAt.trim())) {
    throw new Error(`Incomplete human review in slot ${reviewerSlot}: ${caseId}`);
  }
  return {
    reviewerSlot,
    humanLabel: row.humanLabel,
    humanReviewer: row.humanReviewer.trim(),
    humanReviewedAt: row.humanReviewedAt.trim(),
    humanNotes: row.humanNotes,
  };
}

export function cohensKappa(
  pairs: readonly { reviewerALabel: HumanReviewLabel; reviewerBLabel: HumanReviewLabel }[],
): number | null {
  if (pairs.length === 0) return null;
  const countsA = new Map<HumanReviewLabel, number>();
  const countsB = new Map<HumanReviewLabel, number>();
  let agreement = 0;
  for (const pair of pairs) {
    countsA.set(pair.reviewerALabel, (countsA.get(pair.reviewerALabel) ?? 0) + 1);
    countsB.set(pair.reviewerBLabel, (countsB.get(pair.reviewerBLabel) ?? 0) + 1);
    if (pair.reviewerALabel === pair.reviewerBLabel) agreement += 1;
  }
  const observed = agreement / pairs.length;
  const expected = REVIEW_LABELS.reduce((sum, label) =>
    sum + ((countsA.get(label) ?? 0) / pairs.length) * ((countsB.get(label) ?? 0) / pairs.length), 0);
  return expected === 1 ? null : (observed - expected) / (1 - expected);
}

function reviewSummary(params: {
  totalCaseCount: number;
  pairs: readonly { caseId: string; reviewerALabel: HumanReviewLabel; reviewerBLabel: HumanReviewLabel }[];
  agreedCaseIds: readonly string[];
  disagreedCaseIds: readonly string[];
  adjudicatedCaseIds: readonly string[];
  pendingCaseIds: readonly string[];
}): DoubleBlindReviewSummary {
  return {
    totalCaseCount: params.totalCaseCount,
    lockedReviewCount: params.pairs.length,
    agreedCount: params.agreedCaseIds.length,
    disagreedCount: params.disagreedCaseIds.length,
    adjudicatedCount: params.adjudicatedCaseIds.length,
    pendingCount: params.pendingCaseIds.length,
    agreedCaseIds: [...params.agreedCaseIds],
    disagreedCaseIds: [...params.disagreedCaseIds],
    adjudicatedCaseIds: [...params.adjudicatedCaseIds],
    pendingCaseIds: [...params.pendingCaseIds],
    rawInterReviewerAgreement: params.pairs.length === 0 ? null
      : params.pairs.filter((pair) => pair.reviewerALabel === pair.reviewerBLabel).length / params.pairs.length,
    cohensKappa: cohensKappa(params.pairs),
  };
}

function reviewedBase(
  source: BlindReviewMappingRow,
  firstPass: readonly [HumanFirstPassReview, HumanFirstPassReview],
): ReviewedCaseBase {
  return {
    caseId: source.id,
    conversationGroupId: source.conversationGroupId,
    split: source.split,
    layer: source.layer,
    lastAssistantMessage: source.lastAssistantMessage,
    currentUserText: source.currentUserText,
    syntheticLabel: source.syntheticLabel,
    source: source.source,
    rubricVersion: HUMAN_REVIEW_RUBRIC_VERSION,
    firstPass,
  };
}

export function extractDoubleBlindReview(
  slotARows: readonly BlindReviewRow[],
  slotBRows: readonly BlindReviewRow[],
  mapping: readonly BlindReviewMappingRow[],
): DoubleBlindReviewResult {
  validateReviewInputs(mapping);
  const caseIds = new Set<string>();
  const opaqueIds = new Set<string>();
  for (const value of mapping) {
    if (caseIds.has(value.id)) throw new Error(`Duplicate mapped caseId: ${value.id}`);
    if (opaqueIds.has(value.opaqueReviewId)) throw new Error(`Duplicate opaque review id: ${value.opaqueReviewId}`);
    caseIds.add(value.id);
    opaqueIds.add(value.opaqueReviewId);
  }
  const slotA = indexedBlindRows(slotARows, mapping, 'A');
  const slotB = indexedBlindRows(slotBRows, mapping, 'B');
  const agreedGold: HumanReviewedGoldCase[] = [];
  const needsAdjudication: NeedsAdjudicationCase[] = [];
  const pendingCaseIds: string[] = [];
  const pairs: Array<{ caseId: string; reviewerALabel: HumanReviewLabel; reviewerBLabel: HumanReviewLabel }> = [];
  for (const source of mapping) {
    const firstA = completeFirstPass(slotA.get(source.opaqueReviewId)!, 'A', source.id);
    const firstB = completeFirstPass(slotB.get(source.opaqueReviewId)!, 'B', source.id);
    if (!firstA || !firstB) {
      pendingCaseIds.push(source.id);
      continue;
    }
    if (firstA.humanReviewer.toLocaleLowerCase() === firstB.humanReviewer.toLocaleLowerCase()) {
      throw new Error(`Double blind reviewers must be different: ${source.id}`);
    }
    const firstPass = [firstA, firstB] as const;
    pairs.push({
      caseId: source.id,
      reviewerALabel: firstA.humanLabel,
      reviewerBLabel: firstB.humanLabel,
    });
    const base = reviewedBase(source, firstPass);
    if (firstA.humanLabel === firstB.humanLabel) {
      agreedGold.push({
        ...base,
        humanLabel: firstA.humanLabel,
        adjudication: null,
        labelStatus: 'human_reviewed_gold',
      });
    } else {
      needsAdjudication.push({ ...base, labelStatus: 'needs_adjudication' });
    }
  }
  return {
    agreedGold,
    needsAdjudication,
    pendingCaseIds,
    summary: reviewSummary({
      totalCaseCount: mapping.length,
      pairs,
      agreedCaseIds: agreedGold.map((value) => value.caseId),
      disagreedCaseIds: needsAdjudication.map((value) => value.caseId),
      adjudicatedCaseIds: [],
      pendingCaseIds,
    }),
  };
}

function matchesAdjudicationSource(row: AdjudicationReviewRow, source: NeedsAdjudicationCase): boolean {
  const firstA = source.firstPass[0];
  const firstB = source.firstPass[1];
  return row.conversationGroupId === source.conversationGroupId
    && row.split === source.split && row.layer === source.layer && row.source === source.source
    && row.lastAssistantMessage === source.lastAssistantMessage
    && row.currentUserText === source.currentUserText
    && row.syntheticLabel === source.syntheticLabel
    && row.firstPassLabelA === firstA.humanLabel
    && row.firstPassReviewerA === firstA.humanReviewer
    && row.firstPassReviewedAtA === firstA.humanReviewedAt
    && row.firstPassNotesA === firstA.humanNotes
    && row.firstPassLabelB === firstB.humanLabel
    && row.firstPassReviewerB === firstB.humanReviewer
    && row.firstPassReviewedAtB === firstB.humanReviewedAt
    && row.firstPassNotesB === firstB.humanNotes;
}

export function applyAdjudication(
  review: DoubleBlindReviewResult,
  rows: readonly AdjudicationReviewRow[],
): HumanReviewResolution {
  const needsByCaseId = uniqueByCaseId(review.needsAdjudication, 'needs-adjudication case');
  const rowByCaseId = uniqueByCaseId(rows, 'adjudication row');
  for (const caseId of rowByCaseId.keys()) {
    if (!needsByCaseId.has(caseId)) throw new Error(`Unknown adjudication row: ${caseId}`);
  }
  const adjudicated: HumanReviewedGoldCase[] = [];
  const remaining: NeedsAdjudicationCase[] = [];
  for (const source of review.needsAdjudication) {
    const row = rowByCaseId.get(source.caseId);
    if (!row) {
      remaining.push(source);
      continue;
    }
    if (row.labelStatus !== 'needs_adjudication') {
      throw new Error(`Adjudication row is not backed by two human reviews: ${source.caseId}`);
    }
    if (!matchesAdjudicationSource(row, source)) {
      throw new Error(`First-pass review or source data changed during adjudication: ${source.caseId}`);
    }
    const hasAnyAdjudication = row.adjudicatedLabel !== ''
      || row.adjudicationReviewer.trim() !== '' || row.adjudicatedAt.trim() !== ''
      || row.adjudicationNotes.trim() !== '';
    if (!hasAnyAdjudication) {
      remaining.push(source);
      continue;
    }
    if (row.adjudicatedLabel === '' || row.adjudicationReviewer.trim() === ''
      || !validReviewedAt(row.adjudicatedAt.trim()) || row.adjudicationNotes.trim() === '') {
      throw new Error(`Incomplete adjudication: ${source.caseId}`);
    }
    const adjudication = {
      humanLabel: row.adjudicatedLabel,
      humanReviewer: row.adjudicationReviewer.trim(),
      humanReviewedAt: row.adjudicatedAt.trim(),
      humanNotes: row.adjudicationNotes.trim(),
    };
    adjudicated.push({
      ...source,
      humanLabel: adjudication.humanLabel,
      adjudication,
      labelStatus: 'human_reviewed_gold',
    });
  }
  const pairs = [...review.agreedGold, ...review.needsAdjudication].map((value) => ({
    caseId: value.caseId,
    reviewerALabel: value.firstPass[0].humanLabel,
    reviewerBLabel: value.firstPass[1].humanLabel,
  }));
  const goldCases = [...review.agreedGold, ...adjudicated];
  return {
    goldCases,
    needsAdjudication: remaining,
    pendingCaseIds: [...review.pendingCaseIds],
    summary: reviewSummary({
      totalCaseCount: review.summary.totalCaseCount,
      pairs,
      agreedCaseIds: review.agreedGold.map((value) => value.caseId),
      disagreedCaseIds: remaining.map((value) => value.caseId),
      adjudicatedCaseIds: adjudicated.map((value) => value.caseId),
      pendingCaseIds: review.pendingCaseIds,
    }),
  };
}

export function toComparisonGoldLabels(
  goldCases: readonly HumanReviewedGoldCase[],
): ComparisonGoldLabels {
  const labels = Object.create(null) as ComparisonGoldLabels['labels'];
  const ambiguous: string[] = [];
  const excluded: string[] = [];
  const seen = new Set<string>();
  for (const value of goldCases) {
    if (seen.has(value.caseId)) throw new Error(`Duplicate gold caseId: ${value.caseId}`);
    seen.add(value.caseId);
    if (value.humanLabel === 'ambiguous') ambiguous.push(value.caseId);
    else if (value.humanLabel === 'exclude') excluded.push(value.caseId);
    else labels[value.caseId] = {
      expected: value.humanLabel,
      labelStatus: 'human_reviewed_gold',
    };
  }
  ambiguous.sort();
  excluded.sort();
  return {
    labels,
    ambiguous: { count: ambiguous.length, caseIds: ambiguous },
    excluded: { count: excluded.length, caseIds: excluded },
  };
}
