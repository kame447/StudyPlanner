import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

// Live A/C omissions leave >=8 code points uncovered; complete captured A/B/E
// planning deltas leave at most 5. This is audit eligibility, never semantic truth.
export const WEEKLY_PLANNING_EVIDENCE_COVERAGE_GAP_CODE_POINTS = 8;

export interface WeeklyPlanningSemanticEvidenceCoverageV5 {
  route: 'partial_leaf_evidence_coverage';
  eligible: boolean;
  coveredCodePoints: number;
  maxUncoveredSpanCodePoints: number;
}

export function measureWeeklyPlanningSemanticEvidenceCoverageV5(params: {
  userText: string;
  document: WeeklyPlanningSemanticDocumentV5;
}): WeeklyPlanningSemanticEvidenceCoverageV5 {
  const { userText, document } = params;
  const sources: string[] = [];
  const add = (fact: { sourceText: string } | null | undefined) => {
    if (fact?.sourceText) sources.push(fact.sourceText);
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
  // Count Unicode code points literally, including punctuation/whitespace.
  // No character classes, Japanese keywords, tokenization or normalization.
  for (const point of userText) {
    if (covered[offset]) {
      coveredCodePoints += 1;
      gap = 0;
    } else {
      gap += 1;
      maxUncoveredSpanCodePoints = Math.max(maxUncoveredSpanCodePoints, gap);
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
  };
}
