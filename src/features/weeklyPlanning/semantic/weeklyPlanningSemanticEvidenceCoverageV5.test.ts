import { describe, expect, it } from 'vitest';
import calibration from '../testUtils/weeklyPlanningSemanticEvidenceCoverageCalibration.json';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { measureWeeklyPlanningSemanticEvidenceCoverageV5 } from './weeklyPlanningSemanticEvidenceCoverageV5';
import { hasWeeklyPlanningEvidenceCoverageMissingEffortV5 } from './weeklyPlanningSemanticEvidenceCoverageNeedV5';
import { coverageDocument } from '../testUtils/weeklyPlanningSemanticEvidenceCoverageFixture';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';

describe('partial leaf-evidence coverage as AI audit eligibility', () => {
  it.each(calibration)('$capture response $responseIndex preserves the live calibration', (entry) => {
    const result = measureWeeklyPlanningSemanticEvidenceCoverageV5({ userText: entry.userText, document: entry.document as WeeklyPlanningSemanticDocumentV5 });
    expect(result.eligible).toBe(entry.expectedEligible);
    if (entry.expectedEligible) expect(result.maxUncoveredSpanCodePoints).toBe(27);
  });

  it('catches the short C rate tail even when task sourceText quotes everything', () => {
    const source = calibration.find((entry) => entry.expectedEligible)!;
    const text = '来週、アルゴリズムイントロダクションを30ページ読みたい。1ページ4分くらい';
    const document = structuredClone(source.document) as WeeklyPlanningSemanticDocumentV5;
    document.tasks[0].sourceText = text;
    document.tasks[0].study!.components[0].workloads[0].sourceText = '30ページ';
    const result = measureWeeklyPlanningSemanticEvidenceCoverageV5({ userText: text, document });
    expect(result.eligible).toBe(true);
    expect(result.maxUncoveredSpanCodePoints).toBe(14);
  });

  it('counts literal Unicode code points and merges overlapping/exact repeated evidence', () => {
    const document = structuredClone(calibration[0].document) as WeeklyPlanningSemanticDocumentV5;
    document.planningWindow!.sourceText = '😀a';
    document.tasks = [];
    const result = measureWeeklyPlanningSemanticEvidenceCoverageV5({ userText: '😀a😀a😀😀😀😀😀😀😀😀', document });
    expect(result).toMatchObject({ coveredCodePoints: 4, maxUncoveredSpanCodePoints: 8, eligible: true });
  });

  it('requires an actual missing effort need, rather than auditing complete or intrinsic-time work', () => {
    expect(hasWeeklyPlanningEvidenceCoverageMissingEffortV5({ document: coverageDocument() })).toBe(true);
    expect(hasWeeklyPlanningEvidenceCoverageMissingEffortV5({ document: coverageDocument(true) })).toBe(false);
    const intrinsic = coverageDocument();
    const workload = intrinsic.tasks[0].study!.components[0].workloads[0];
    workload.unitCode = 'hour'; workload.amount = 2;
    expect(hasWeeklyPlanningEvidenceCoverageMissingEffortV5({ document: intrinsic })).toBe(false);
  });

  it('uses accepted active effort without mutating the graph or inventing an unmet need', () => {
    const initial = coverageDocument();
    initial.tasks[0].effortEstimates = [{ localId: 'known-rate', targetLocalId: 'workload-1', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'exact', sourceText: '1ページ3分' }];
    const canonical = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: createEmptyWeeklyPlanningFactGraphV5(), document: initial,
      context: { conversationId: 'accepted', turnId: 'initial', expectedRevision: 0 },
    });
    const graph = canonical.graph;
    const before = structuredClone(graph);
    const next = coverageDocument();
    next.tasks[0].existingPublicId = canonical.localToFactId['task-1'];
    next.tasks[0].study!.components[0].existingPublicId = canonical.localToFactId['component-1'];
    expect(hasWeeklyPlanningEvidenceCoverageMissingEffortV5({ document: next, committedGraph: graph })).toBe(false);
    expect(graph).toEqual(before);
  });
});
