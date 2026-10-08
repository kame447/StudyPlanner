import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

// Live A/C omissions leave >=8 code points uncovered; complete captured A/B/E
// planning deltas leave at most 5. This is audit eligibility, never semantic truth.
export const WEEKLY_PLANNING_EVIDENCE_COVERAGE_GAP_CODE_POINTS = 8;

/** Literal evidence class only, never a numeric interpretation. */
export function isWeeklyPlanningEvidenceDigitV5(point: string): boolean {
  const code = point.codePointAt(0)!;
  return (code >= 0x30 && code <= 0x39) || (code >= 0xff10 && code <= 0xff19);
}

export interface WeeklyPlanningSemanticEvidenceCoverageV5 {
  route: 'partial_leaf_evidence_coverage';
  eligible: boolean;
  coveredCodePoints: number;
  maxUncoveredSpanCodePoints: number;
  uncoveredDigitCodePoints?: number;
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
}): WeeklyPlanningSemanticEvidenceCoverageV5 {
  const { userText, document } = params;
  const sources: string[] = [...(params.additionalSourceTexts ?? [])];
  const add = (fact: { sourceText: string } | null | undefined) => {
    if (!params.additionalSourceTextsOnly && fact?.sourceText) sources.push(fact.sourceText);
  };
  add(document.planningWindow);
  for (const facts of [document.relations, document.availabilityDeclarations,
    document.constraintSourceRequests, document.userContextFacts ?? [], document.uncertainties,
    document.corrections, document.decisions]) facts.forEach(add);
  for (const task of document.tasks) {
    // Task/document sourceText may quote the whole utterance despite missing
    // nested facts. Only individually represented leaf facts contribute.
    for (const facts of [task.workloads, task.effortEstimates, task.temporalConstraints,
      task.recurrence, task.durableContextSignals ?? []]) facts.forEach(add);
    for (const component of task.study?.components ?? []) {
      add(component);
      component.workloads.forEach(add);
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
    // Entirely empty coverage belongs to the existing no-op/act handling,
    // rather than a second completeness path for explanation/consultation.
    eligible: coveredCodePoints > 0 && maxUncoveredSpanCodePoints >= WEEKLY_PLANNING_EVIDENCE_COVERAGE_GAP_CODE_POINTS,
    coveredCodePoints,
    maxUncoveredSpanCodePoints,
    ...(params.includeUncoveredDigits ? { uncoveredDigitCodePoints } : {}),
  };
}
