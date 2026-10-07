import calibration from './weeklyPlanningSemanticEvidenceCoverageCalibration.json';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { ScriptedProviderCall } from './weeklyPlanningScriptedConversationHarness';
import { campaignRendererReply } from './weeklyPlanningRealE2ECampaignFixture';

export const COVERAGE_USER_TEXT = calibration.find((entry) => entry.expectedEligible)!.userText;
export const COVERAGE_C_USER_TEXT = '来週、アルゴリズムイントロダクションを30ページ読みたい。1ページ4分くらい';

export function coverageDocument(complete = false, variant: 'A' | 'C' = 'A'): WeeklyPlanningSemanticDocumentV5 {
  const entry = complete
    ? calibration.find((candidate) => candidate.capture === 'A-T1-e34b3c02-capture.json')!
    : calibration.find((candidate) => candidate.expectedEligible)!;
  const document = structuredClone(entry.document) as WeeklyPlanningSemanticDocumentV5;
  // The native bookshelf id is unrelated to coverage. These fresh-conversation
  // fixtures create the same material instead of referring to a catalog id.
  for (const task of document.tasks) for (const component of task.study?.components ?? []) component.existingPublicId = null;
  if (variant === 'C') {
    document.availabilityDeclarations = [];
    document.tasks[0].sourceText = 'アルゴリズムイントロダクションを30ページ読みたい';
    for (const task of document.tasks) {
      for (const workload of [...task.workloads, ...(task.study?.components ?? []).flatMap((component) => component.workloads)]) {
        workload.amount = 30; workload.sourceText = '30ページ';
      }
      for (const estimate of task.effortEstimates) { estimate.minutes = 4; estimate.sourceText = '1ページ4分くらい'; }
    }
  }
  return document;
}

export function coverageRendererReply(call: ScriptedProviderCall): string {
  return campaignRendererReply(call.payload ?? {});
}
