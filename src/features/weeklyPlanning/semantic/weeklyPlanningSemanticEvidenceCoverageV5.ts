import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';

// Live A/C omissions leave >=8 code points uncovered; complete captured A/B/E
// planning deltas leave at most 5. This is audit eligibility, never semantic truth.
export const WEEKLY_PLANNING_EVIDENCE_COVERAGE_GAP_CODE_POINTS = 8;

/** Literal evidence class only, never a numeric interpretation. */
export function isWeeklyPlanningEvidenceDigitV5(point: string): boolean {
  const code = point.codePointAt(0)!;
  return (code >= 0x30 && code <= 0x39) || (code >= 0xff10 && code <= 0xff19);
}

/** Literal numeric evidence bound shared by focused answers and modification audits. */
export function boundedEffortEvidenceV5(span: string): boolean {
  let run = 0;
  for (const point of span) {
    run = isWeeklyPlanningEvidenceDigitV5(point) ? 0 : run + 1;
    if (run >= WEEKLY_PLANNING_EVIDENCE_COVERAGE_GAP_CODE_POINTS) return false;
  }
  return true;
}

/** Number of maximal runs of literal ASCII/full-width digits; a count only, never a numeric reading. */
export function literalDigitRunCountV5(span: string): number {
  let runs = 0;
  let inRun = false;
  for (const point of span) {
    const digit = isWeeklyPlanningEvidenceDigitV5(point);
    if (digit && !inRun) runs += 1;
    inRun = digit;
  }
  return runs;
}

function withoutLiteralWorkloadAnchors(source: string, labels: readonly string[]): string {
  const removed = new Uint8Array(source.length);
  for (const label of new Set(labels.filter(label => label.length > 0))) {
    for (let start = source.indexOf(label); start >= 0; start = source.indexOf(label, start + 1)) {
      removed.fill(1, start, start + label.length);
    }
  }
  return source.split('').filter((_point, index) => !removed[index]).join('');
}

export interface WeeklyPlanningSemanticEvidenceCoverageV5 {
  route: 'partial_leaf_evidence_coverage';
  eligible: boolean;
  coveredCodePoints: number;
  maxUncoveredSpanCodePoints: number;
  uncoveredDigitCodePoints?: number;
  excludedNumericSourceCount?: number;
}

export function measureWeeklyPlanningSemanticEvidenceCoverageV5(params: {
  userText: string;
  document: WeeklyPlanningSemanticDocumentV5;
  /** Validated conversational source spans, without creating planning facts. */
  additionalSourceTexts?: readonly string[];
  /** Focused acceptance anchors only; document leaf quotes remain provenance. */
  additionalSourceTextsOnly?: boolean;
  /** Focused acceptance only; absent preserves the original result shape. */
  includeUncoveredDigits?: boolean;
  /** Accepted-task modification audit only; numeric quotes remain valid provenance. */
  boundedNumericSourceTexts?: boolean;
  /** Same-owner active material labels/title for the opted-in workload quote bound. */
  committedGraph?: WeeklyPlanningFactGraphV5;
}): WeeklyPlanningSemanticEvidenceCoverageV5 {
  const { userText, document } = params;
  const sources: string[] = [...(params.additionalSourceTexts ?? [])];
  let excludedNumericSourceCount = 0;
  const add = (fact: { sourceText: string } | null | undefined) => {
    if (!params.additionalSourceTextsOnly && fact?.sourceText) sources.push(fact.sourceText);
  };
  // `numericSlots` is how many numbers the typed fact can account for. A quote with more literal digit
  // runs than that states a number no typed value represents (X3-T3: 「3章ぶん、1章40分」 on a workload of 3),
  // so it is cited provenance but earns no coverage and the gap stays visible to the audit.
  const addNumeric = (fact: { sourceText: string }, boundedSource: string = fact.sourceText, numericSlots = Number.POSITIVE_INFINITY) => {
    if (params.boundedNumericSourceTexts && !params.additionalSourceTextsOnly
      && (!boundedEffortEvidenceV5(boundedSource) || literalDigitRunCountV5(boundedSource) > numericSlots)) {
      if (fact.sourceText && userText.includes(fact.sourceText)) excludedNumericSourceCount += 1;
    } else add(fact);
  };
  add(document.planningWindow);
  for (const facts of [document.relations, document.availabilityDeclarations,
    document.constraintSourceRequests, document.userContextFacts ?? [], document.uncertainties,
    document.corrections, document.decisions]) facts.forEach(add);
  const active = params.boundedNumericSourceTexts && params.committedGraph
    ? createWeeklyPlanningActiveSchedulerGraphViewV5(params.committedGraph) : undefined;
  for (const task of document.tasks) {
    // Task/document sourceText may quote the whole utterance despite missing
    // nested facts. Only individually represented leaf facts contribute.
    const owner = active?.tasks.find(owner => owner.id === task.existingPublicId);
    const labels = params.boundedNumericSourceTexts ? [
      ...(task.study?.components ?? []).filter(component => component.role === 'material').map(component => component.label),
      ...(owner && active ? [owner.title, ...active.components
        .filter(component => component.taskId === owner.id && component.role === 'material').map(component => component.label)] : []),
    ] : [];
    const addWorkload = (fact: { sourceText: string; rangeStart?: unknown; rangeEnd?: unknown }) => addNumeric(fact,
      labels.length > 0 ? withoutLiteralWorkloadAnchors(fact.sourceText, labels) : fact.sourceText,
      1 + (fact.rangeStart != null ? 1 : 0) + (fact.rangeEnd != null ? 1 : 0));
    task.workloads.forEach(addWorkload);
    task.effortEstimates.forEach(fact => addNumeric(fact, fact.sourceText, fact.kind === 'duration_per_unit' ? 2 : 1));
    task.temporalConstraints.forEach(add);
    task.recurrence.forEach(fact => fact.count === null ? add(fact) : addNumeric(fact, fact.sourceText, 1));
    (task.durableContextSignals ?? []).forEach(add);
    for (const component of task.study?.components ?? []) {
      add(component);
      component.workloads.forEach(addWorkload);
      (component.durableContextSignals ?? []).forEach(add);
    }
  }

  const covered = new Uint8Array(userText.length);
  for (const source of new Set(sources)) {
    for (let start = userText.indexOf(source); start >= 0; start = userText.indexOf(source, start + 1)) {
      covered.fill(1, start, start + source.length);
    }
  }
  let offset = 0;
  let gap = 0;
  let coveredCodePoints = 0;
  let maxUncoveredSpanCodePoints = 0;
  let uncoveredDigitCodePoints = 0;
  // Count Unicode code points literally, including punctuation/whitespace.
  // The opt-in focused digit count is literal quantity evidence only. Omitted
  // flags keep the original result; no Japanese keywords or tokenization.
  for (const point of userText) {
    if (covered[offset]) {
      coveredCodePoints += 1;
      gap = 0;
    } else {
      gap += 1;
      maxUncoveredSpanCodePoints = Math.max(maxUncoveredSpanCodePoints, gap);
      if (params.includeUncoveredDigits && isWeeklyPlanningEvidenceDigitV5(point)) uncoveredDigitCodePoints += 1;
    }
    offset += point.length;
  }
  return {
    route: 'partial_leaf_evidence_coverage',
    // Empty documents still use no-op/act handling. An excluded literal numeric
    // quote remains cited leaf provenance on the opted-in modification route.
    eligible: (coveredCodePoints > 0 || excludedNumericSourceCount > 0)
      && maxUncoveredSpanCodePoints >= WEEKLY_PLANNING_EVIDENCE_COVERAGE_GAP_CODE_POINTS,
    coveredCodePoints,
    maxUncoveredSpanCodePoints,
    ...(params.includeUncoveredDigits ? { uncoveredDigitCodePoints } : {}),
    ...(params.boundedNumericSourceTexts ? { excludedNumericSourceCount } : {}),
  };
}
