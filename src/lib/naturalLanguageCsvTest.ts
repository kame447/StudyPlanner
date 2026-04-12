import type { AiProvider } from './aiConfig';
import type { NaturalLanguageMode, NaturalLanguageSuggestion } from '../types/domain';

export interface NaturalLanguageCsvRow {
  caseId: string;
  input: string;
  selectedDate: string;
  provider: string;
  expectedIndex: number;
  expectedTitle: string;
  expectedSubject: string;
  expectedDate: string;
  expectedStart: string;
  expectedEnd: string;
  expectedRepeat: string;
}

export interface NaturalLanguageCsvCase {
  caseId: string;
  input: string;
  selectedDate: string;
  provider: string;
  rows: NaturalLanguageCsvRow[];
}

export type CsvAssertionStatus = 'pass' | 'fail' | 'partial' | 'skip';

export interface NaturalLanguageCsvRowResult {
  expected: NaturalLanguageCsvRow;
  actual?: NaturalLanguageSuggestion;
  status: CsvAssertionStatus;
  mismatches: string[];
  notes: string[];
}

export interface NaturalLanguageCsvCaseResult {
  testCase: NaturalLanguageCsvCase;
  mode: NaturalLanguageMode;
  status: CsvAssertionStatus;
  reason?: string;
  rowResults: NaturalLanguageCsvRowResult[];
  extraActuals: NaturalLanguageSuggestion[];
}

interface RepeatExpectation {
  baseRepeat: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  repeatUntil?: string;
  notes: string[];
  acceptedActualRepeats?: Array<'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'>;
}

const EDIT_EXPECTATION_LABELS = new Set([
  'modify',
  'delete',
  'replace',
  'modify_series',
  'modify_all',
]);

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      const nextChar = line[index + 1];

      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function parseNaturalLanguageCsv(text: string): NaturalLanguageCsvRow[] {
  const normalizedText = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();

  if (!normalizedText) {
    return [];
  }

  const [headerLine, ...lines] = normalizedText.split('\n').filter(Boolean);
  const headers = parseCsvLine(headerLine);

  const requiredHeaders = [
    'case_id',
    'input',
    'selected_date',
    'provider',
    'expected_index',
    'expected_title',
    'expected_subject',
    'expected_date',
    'expected_start',
    'expected_end',
    'expected_repeat',
  ];

  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    throw new Error(`CSVヘッダーが不足しています: ${missingHeaders.join(', ')}`);
  }

  return lines.map((line, lineIndex) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));

    const expectedIndex = Number(row.expected_index);

    if (!row.case_id || !row.input || !row.selected_date || Number.isNaN(expectedIndex)) {
      throw new Error(`CSV ${lineIndex + 2}行目の必須項目が不正です。`);
    }

    return {
      caseId: row.case_id,
      input: row.input,
      selectedDate: row.selected_date,
      provider: row.provider,
      expectedIndex,
      expectedTitle: row.expected_title,
      expectedSubject: row.expected_subject,
      expectedDate: row.expected_date,
      expectedStart: row.expected_start,
      expectedEnd: row.expected_end,
      expectedRepeat: row.expected_repeat,
    };
  });
}

export function buildNaturalLanguageCsvCases(
  rows: NaturalLanguageCsvRow[],
): NaturalLanguageCsvCase[] {
  const grouped = new Map<string, NaturalLanguageCsvCase>();

  rows.forEach((row) => {
    const existing = grouped.get(row.caseId);

    if (existing) {
      existing.rows.push(row);
      return;
    }

    grouped.set(row.caseId, {
      caseId: row.caseId,
      input: row.input,
      selectedDate: row.selectedDate,
      provider: row.provider,
      rows: [row],
    });
  });

  return Array.from(grouped.values()).map((testCase) => ({
    ...testCase,
    rows: [...testCase.rows].sort((left, right) => left.expectedIndex - right.expectedIndex),
  }));
}

function parseExpectedRepeat(rawValue: string): RepeatExpectation {
  const value = rawValue.trim();

  if (!value || value === 'none') {
    return { baseRepeat: 'none', notes: [], acceptedActualRepeats: ['none'] };
  }

  if (
    value === 'daily' ||
    value === 'weekly' ||
    value === 'monthly' ||
    value === 'yearly'
  ) {
    return { baseRepeat: value, notes: [], acceptedActualRepeats: [value] };
  }

  const untilMatch = value.match(/^(daily|weekly|monthly|yearly)(?:_[a-z_]+)?_until_(\d{4}-\d{2}-\d{2})$/);

  if (untilMatch) {
    return {
      baseRepeat: untilMatch[1] as RepeatExpectation['baseRepeat'],
      repeatUntil: untilMatch[2],
      acceptedActualRepeats: [untilMatch[1] as RepeatExpectation['baseRepeat']],
      notes:
        untilMatch[0] === `${untilMatch[1]}_until_${untilMatch[2]}`
          ? []
          : ['曜日や条件の細分までは比較していません。'],
    };
  }

  if (/^weekly_/.test(value)) {
    return {
      baseRepeat: 'weekly',
      acceptedActualRepeats: ['weekly'],
      notes: ['曜日の組み合わせまでは比較していません。'],
    };
  }

  if (/^daily_/.test(value)) {
    return {
      baseRepeat: 'daily',
      acceptedActualRepeats: ['daily'],
      notes: ['繰り返し回数や条件までは比較していません。'],
    };
  }

  if (/^weekdays/.test(value) || /^weekends/.test(value)) {
    return {
      baseRepeat: 'weekly',
      acceptedActualRepeats: ['weekly', 'daily'],
      notes: ['平日・週末条件までは比較していません。'],
    };
  }

  return {
    baseRepeat: 'none',
    acceptedActualRepeats: ['none'],
    notes: [`未対応の repeat ラベルです: ${value}`],
  };
}

function shouldCompareExactDate(expectation: RepeatExpectation): boolean {
  return expectation.notes.length === 0;
}

function inferCaseMode(testCase: NaturalLanguageCsvCase): NaturalLanguageMode | undefined {
  const hasEditExpectation = testCase.rows.some(
    (row) =>
      EDIT_EXPECTATION_LABELS.has(row.expectedRepeat) ||
      row.expectedStart === 'same' ||
      row.expectedEnd === 'same' ||
      row.expectedStart.startsWith('+') ||
      row.expectedEnd.startsWith('+') ||
      row.expectedStart === '' ||
      row.expectedEnd === '',
  );

  return hasEditExpectation ? undefined : 'add';
}

function doesRepeatMatch(
  expectation: RepeatExpectation,
  actualRepeat: NaturalLanguageSuggestion['parsedPlan']['repeat'],
): boolean {
  return (expectation.acceptedActualRepeats ?? [expectation.baseRepeat]).includes(actualRepeat);
}

function compareExpectedRowToActual(
  expectedRow: NaturalLanguageCsvRow,
  actual: NaturalLanguageSuggestion,
): NaturalLanguageCsvRowResult {
  const repeatExpectation = parseExpectedRepeat(expectedRow.expectedRepeat);
  const mismatches: string[] = [];
  const notes: string[] = [...repeatExpectation.notes];

  if (expectedRow.expectedTitle && actual.parsedPlan.title !== expectedRow.expectedTitle) {
    mismatches.push(
      `title: expected=${expectedRow.expectedTitle}, actual=${actual.parsedPlan.title}`,
    );
  }

  if (
    expectedRow.expectedSubject &&
    actual.parsedPlan.subject !== expectedRow.expectedSubject
  ) {
    mismatches.push(
      `subject: expected=${expectedRow.expectedSubject}, actual=${actual.parsedPlan.subject}`,
    );
  }

  if (
    expectedRow.expectedDate &&
    shouldCompareExactDate(repeatExpectation) &&
    actual.parsedPlan.date !== expectedRow.expectedDate
  ) {
    mismatches.push(
      `date: expected=${expectedRow.expectedDate}, actual=${actual.parsedPlan.date}`,
    );
  }

  if (
    expectedRow.expectedStart &&
    /^[0-2]\d:\d{2}$/.test(expectedRow.expectedStart) &&
    actual.parsedPlan.startTime !== expectedRow.expectedStart
  ) {
    mismatches.push(
      `start: expected=${expectedRow.expectedStart}, actual=${actual.parsedPlan.startTime}`,
    );
  }

  if (
    expectedRow.expectedEnd &&
    /^[0-2]\d:\d{2}$/.test(expectedRow.expectedEnd) &&
    actual.parsedPlan.endTime !== expectedRow.expectedEnd
  ) {
    mismatches.push(
      `end: expected=${expectedRow.expectedEnd}, actual=${actual.parsedPlan.endTime}`,
    );
  }

  if (!doesRepeatMatch(repeatExpectation, actual.parsedPlan.repeat)) {
    mismatches.push(
      `repeat: expected=${repeatExpectation.baseRepeat}, actual=${actual.parsedPlan.repeat}`,
    );
  }

  if (
    repeatExpectation.repeatUntil &&
    actual.parsedPlan.repeatUntil !== repeatExpectation.repeatUntil
  ) {
    mismatches.push(
      `repeatUntil: expected=${repeatExpectation.repeatUntil}, actual=${actual.parsedPlan.repeatUntil ?? 'null'}`,
    );
  }

  return {
    expected: expectedRow,
    actual,
    status:
      mismatches.length > 0
        ? ('fail' as const)
        : notes.length > 0
          ? ('partial' as const)
          : ('pass' as const),
    mismatches,
    notes,
  };
}

function scoreRowResult(result: NaturalLanguageCsvRowResult): number {
  const mismatchPenalty = result.mismatches.length * 10;
  const notePenalty = result.notes.length;
  const titlePenalty = result.mismatches.some((item) => item.startsWith('title:')) ? 3 : 0;
  const subjectPenalty = result.mismatches.some((item) => item.startsWith('subject:')) ? 3 : 0;
  return mismatchPenalty + notePenalty + titlePenalty + subjectPenalty;
}

export function compareNaturalLanguageCaseResult(
  testCase: NaturalLanguageCsvCase,
  suggestions: NaturalLanguageSuggestion[],
): NaturalLanguageCsvCaseResult {
  const mode = inferCaseMode(testCase);

  if (!mode) {
    return {
      testCase,
      mode: 'edit',
      status: 'skip',
      reason: '編集系ケースはこのCSVランナーでは未対応です。',
      rowResults: [],
      extraActuals: [],
    };
  }

  const unusedActualIndexes = new Set(suggestions.map((_, index) => index));

  const rowResults = testCase.rows.map((expectedRow) => {
    const repeatExpectation = parseExpectedRepeat(expectedRow.expectedRepeat);

    if (unusedActualIndexes.size === 0) {
      return {
        expected: expectedRow,
        actual: undefined,
        status: repeatExpectation.notes.length > 0 ? ('partial' as const) : ('fail' as const),
        mismatches:
          repeatExpectation.notes.length > 0
            ? []
            : ['想定された件数より実際の提案数が少ないです。'],
        notes:
          repeatExpectation.notes.length > 0
            ? [
                ...repeatExpectation.notes,
                '現行モデルでは条件付き繰り返しの派生予定を完全展開していません。',
              ]
            : [],
      };
    }

    let bestIndex: number | undefined;
    let bestResult: NaturalLanguageCsvRowResult | undefined;
    let bestScore = Number.POSITIVE_INFINITY;

    unusedActualIndexes.forEach((actualIndex) => {
      const candidate = compareExpectedRowToActual(expectedRow, suggestions[actualIndex]);
      const score = scoreRowResult(candidate);

      if (score < bestScore) {
        bestScore = score;
        bestIndex = actualIndex;
        bestResult = candidate;
      }
    });

    if (bestIndex === undefined || !bestResult) {
      return {
        expected: expectedRow,
        actual: undefined,
        status: 'fail' as const,
        mismatches: ['想定された件数より実際の提案数が少ないです。'],
        notes: [],
      };
    }

    unusedActualIndexes.delete(bestIndex);
    return bestResult;
  });

  const extraActuals = Array.from(unusedActualIndexes).map((index) => suggestions[index]);

  if (extraActuals.length > 0) {
    rowResults.push({
      expected: {
        ...testCase.rows[testCase.rows.length - 1],
        expectedIndex: testCase.rows.length + 1,
        expectedTitle: '',
        expectedSubject: '',
        expectedDate: '',
        expectedStart: '',
        expectedEnd: '',
        expectedRepeat: '',
      },
      actual: extraActuals[0],
      status: 'fail',
      mismatches: ['想定より提案数が多いです。'],
      notes: [],
    });
  }

  const status = rowResults.some((row) => row.status === 'fail')
    ? 'fail'
    : rowResults.some((row) => row.status === 'partial')
      ? 'partial'
      : rowResults.length === 0
        ? 'skip'
        : 'pass';

  return {
    testCase,
    mode,
    status,
    rowResults,
    extraActuals,
  };
}

export function canRunNaturalLanguageCsvCase(
  testCase: NaturalLanguageCsvCase,
  provider: AiProvider,
): { runnable: boolean; reason?: string } {
  if (testCase.provider && testCase.provider !== provider) {
    return {
      runnable: false,
      reason: `CSVの provider=${testCase.provider} と現在の provider=${provider} が一致しません。`,
    };
  }

  const mode = inferCaseMode(testCase);

  if (!mode) {
    return {
      runnable: false,
      reason: '編集系ケースはこのCSVランナーでは未対応です。',
    };
  }

  return { runnable: true };
}
