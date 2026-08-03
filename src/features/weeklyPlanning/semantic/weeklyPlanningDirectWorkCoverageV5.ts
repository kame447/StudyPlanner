import type {
  SemanticTaskV5,
  SemanticWorkloadUnitCodeV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_DIRECT_WORK_COVERAGE_CONTRACT_V5 =
  'weekly-planning-direct-work-coverage-v5' as const;

export interface DirectWorkExpectationV5 {
  label: string;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
}

const UNIT_BY_LABEL: Readonly<Record<string, SemanticWorkloadUnitCodeV5>> = {
  時間: 'hour',
  分: 'minute',
  問: 'problem',
  ページ: 'page',
  語: 'word',
  章: 'chapter',
  回: 'session',
  件: 'custom',
  枚: 'custom',
  冊: 'custom',
};

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function cleanedLabel(raw: string): string {
  return raw
    .replace(/^(?:今日|明日|明後日|今週|来週|次の日|翌日|翌週)(?:に|は|で|の)?/, '')
    .replace(/^(?:そして|それから|さらに|加えて|あと|また)/, '')
    .replace(/(?:を|は|が|に|で|の)?$/, '')
    .trim();
}

function hasCorrectionCue(text: string): boolean {
  const normalized = normalizeText(text);
  return /(?:訂正|修正|変更|ではなく|じゃなく|取り消|削除)/.test(normalized);
}

export function extractDirectWorkExpectationsV5(
  userText: string,
): DirectWorkExpectationV5[] {
  if (hasCorrectionCue(userText)) return [];

  const expectations: DirectWorkExpectationV5[] = [];
  const segments = userText
    .normalize('NFKC')
    .split(/[、，,。；;\n・]|(?:そして|それから|さらに|加えて|および|及び)/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const matches = [...segment.matchAll(/(\d+(?:\.\d+)?)\s*(時間|分|問|ページ|語|章|回|件|枚|冊)/g)];
    if (matches.length !== 1) continue;
    const match = matches[0];
    const label = cleanedLabel(segment.slice(0, match.index));
    const amount = Number(match[1]);
    const unitLabel = match[2];
    const unitCode = UNIT_BY_LABEL[unitLabel];
    if (!label || !unitCode || !Number.isFinite(amount) || amount <= 0) continue;
    expectations.push({ label, amount, unitCode, unitLabel });
  }

  const seen = new Set<string>();
  return expectations.filter((expectation) => {
    const key = `${normalizeText(expectation.label)}:${expectation.amount}:${expectation.unitCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workloadMatches(
  expectation: DirectWorkExpectationV5,
  amount: number,
  unitCode: SemanticWorkloadUnitCodeV5,
): boolean {
  return unitCode === expectation.unitCode
    && Math.abs(amount - expectation.amount) < 1e-9;
}

function labelsMatch(expectation: DirectWorkExpectationV5, labels: string[]): boolean {
  const expectedLabel = normalizeText(expectation.label);
  return labels
    .map(normalizeText)
    .filter(Boolean)
    .some((label) => label.includes(expectedLabel) || expectedLabel.includes(label));
}

function taskCoversExpectation(
  task: SemanticTaskV5,
  expectation: DirectWorkExpectationV5,
): boolean {
  const taskLabels = [task.title, task.sourceText];

  if (
    task.workloads.some((workload) =>
      workloadMatches(expectation, workload.amount, workload.unitCode))
    && labelsMatch(expectation, taskLabels)
  ) {
    return true;
  }

  for (const component of task.study?.components ?? []) {
    if (
      component.workloads.some((workload) =>
        workloadMatches(expectation, workload.amount, workload.unitCode))
      && labelsMatch(expectation, [component.label, component.sourceText])
    ) {
      return true;
    }
  }

  if (expectation.unitCode === 'hour' || expectation.unitCode === 'minute') {
    const expectedMinutes = expectation.unitCode === 'hour'
      ? expectation.amount * 60
      : expectation.amount;
    return task.effortEstimates.some((estimate) =>
      Math.abs(estimate.minutes - expectedMinutes) < 1e-9
      && labelsMatch(expectation, taskLabels));
  }

  return false;
}

export function missingDirectWorkExpectationsV5(params: {
  userText: string;
  document: WeeklyPlanningSemanticDocumentV5;
}): DirectWorkExpectationV5[] {
  if (params.document.corrections.length > 0) return [];
  return extractDirectWorkExpectationsV5(params.userText)
    .filter((expectation) =>
      !params.document.tasks.some((task) => taskCoversExpectation(task, expectation)));
}

export function directWorkCoverageErrorsV5(params: {
  userText: string;
  document: WeeklyPlanningSemanticDocumentV5;
}): string[] {
  return missingDirectWorkExpectationsV5(params)
    .map((expectation) =>
      `document.tasks:explicit-work-evidence-omitted:${expectation.label}:${expectation.amount}:${expectation.unitCode}`);
}
