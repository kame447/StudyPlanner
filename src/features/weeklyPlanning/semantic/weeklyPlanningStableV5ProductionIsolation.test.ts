import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEEKLY_PLANNING_ROOT = fileURLToPath(new URL('../', import.meta.url));
const STABLE_MODULE_TOKENS = [
  'weeklyPlanningStableV5',
  'weeklyPlanningSemanticDocumentV5',
  'weeklyPlanningFactGraphV5',
  'weeklyPlanningSemanticNormalizerV5',
  'weeklyPlanningSemanticPipelineV5',
  'weeklyPlanningSemanticDialoguePipelineV5',
  'weeklyPlanningStableV5Persistence',
] as const;

const ALLOWED_PRODUCTION_IMPORTERS = new Set([
  'weeklyPlanningTurnExecutor.ts',
  'weeklyPlanningTurnExecutionTypes.ts',
  'weeklyPlanningOwnedStorage.ts',
  'application/useWeeklyPlanningApplication.ts',
  // C5: derive frozen effort scope from the existing graph/question-slot contract.
  'application/c5LocalSelection/basis.ts',
  // C5: acknowledge one existing V5 session envelope, retaining consumption on quota/recovery.
  'application/c5LocalSelection/checkpoint.ts',
  // C5: typed application continuation/plan boundary, with no default provider.
  'application/c5LocalSelection/contracts.ts',
  // C5: actual runtime finalize/rollback receipt and existing bounded debug diagnostic.
  'application/c5LocalSelection/controlledCommit.ts',
  // C5: typed pure graph replacement and final synchronous Unit 2/domain revalidation.
  'application/c5LocalSelection/selection.ts',
  // Test-only: actual controller/runtime/storage fixtures; production imports prohibited by dormantArchitecture.test.
  'application/c5LocalSelection/controller.testUtils.ts',
  // Test-only: isolated paired graph packets; production imports prohibited by dormantArchitecture.test.
  'application/c5LocalSelection/evaluationHarness.testUtils.ts',
  // Conversational recovery of a failed semantic step: retained machine question text only.
  'application/weeklyPlanningConversationRecovery.ts',
  // Legacy architecture (comparison switch): pre-#488 failure presentation over the compatibility projection.
  'application/weeklyPlanningLegacyFailurePresentation.ts',
  // Interaction layer: typed conversation acts + question identity over the graph; no raw text.
  'application/weeklyPlanningInteractionDecision.ts',
  // Interaction layer: read-only compiled fixed-event state and optional question presentation.
  'application/weeklyPlanningFixedEventOnlyInteraction.ts',
  // Interaction layer: read-only consultation evidence from the actual preview result (type-only).
  'application/weeklyPlanningConsultationCommunication.ts',
  // Interaction layer: read-only hypothetical placement using the canonical scheduler.
  'application/weeklyPlanningConsultationAlternativeEvaluation.ts',
  // Test-only: bind a pending question to its presenting message as the controller does.
  'testUtils/weeklyPlanningFreshPresentationTestUtils.ts',
  // Test-only: scripted-provider full-turn harness over the real controller/runtime.
  'testUtils/weeklyPlanningScriptedConversationHarness.ts',
  'testUtils/weeklyPlanningSemanticEvidenceCoverageFixture.ts',
  'testUtils/weeklyPlanningWorkloadLifecycleFixture.ts',
  // Test-only: real-E2E scenario D follow-up document over the graph's public ids (type import).
  'testUtils/weeklyPlanningConditionPropagationFixture.ts',
  'application/weeklyPlanningApprovalRuntimeLookup.ts',
  'application/weeklyPlanningSessionLifecycle.ts',
  'application/weeklyPlanningStableV5GraphStaging.ts',
  'application/weeklyPlanningStableV5InstrumentedRuntimeExecutor.ts',
  'application/weeklyPlanningStableV5PlanningEvaluation.ts',
  'application/weeklyPlanningStableV5PlanningStage.ts',
  'application/weeklyPlanningStableV5PreviewExecution.ts',
  'application/weeklyPlanningStableV5ProvisionalCapacityPreview.ts',
  'application/weeklyPlanningStableV5ResponseRouting.ts',
  'application/weeklyPlanningStableV5ResultProjection.ts',
  'application/weeklyPlanningStableV5RuntimeExecutor.ts',
  'application/weeklyPlanningStableV5RuntimeQuestions.ts',
  'application/weeklyPlanningStableV5RuntimeSession.ts',
  'application/weeklyPlanningStableV5RuntimeTraceLifecycle.ts',
  'application/weeklyPlanningStableV5SemanticContext.ts',
  'application/weeklyPlanningStableV5SemanticTurn.ts',
  'application/weeklyPlanningStableV5SessionCodec.ts',
  'application/weeklyPlanningStableV5SessionStorage.ts',
  'application/weeklyPlanningStableV5TurnIdempotency.ts',
  'application/weeklyPlanningStableV5TurnResultProjection.ts',
  'application/weeklyPlanningStableV5TurnStaging.ts',
  'application/weeklyPlanningTurnRuntimeGateway.ts',
  'application/weeklyPlanningTurnSideEffects.ts',
  'application/weeklyPlanningTurnTraceSideEffects.ts',
  'chat/aiPlanningChatStore.ts',
  // Interaction architecture: typed communication context (goal / purpose codes) for the renderer; no prose.
  'dialogue/weeklyPlanningStableV5CommunicationContext.ts',
  // Interaction presentation: read-only current-preview/task-date comparison; no authority.
  'dialogue/weeklyPlanningRetainedPreviewCommunication.ts',
  // Interaction architecture: the single emergency wording used only when the renderer cannot run or fails.
  'dialogue/weeklyPlanningInteractionFallbackText.ts',
  // Interaction presentation: compose typed ACK text, then rerun the complete V5 validator.
  'dialogue/weeklyPlanningDialogueAcknowledgementComposition.ts',
  'dialogue/weeklyPlanningStableV5AiDialogueRenderer.ts',
  'dialogue/weeklyPlanningStableV5CurrentTurnGrounding.ts',
  'dialogue/weeklyPlanningStableV5DialoguePrompt.ts',
  'dialogue/weeklyPlanningStableV5DialogueValidation.ts',
  'dialogue/weeklyPlanningStableV5TurnDialogue.ts',
  'dialogue/weeklyPlanningStableV5TurnDialogueTrace.ts',
  'trace/weeklyPlanningStableV5TraceRuntime.ts',
  'trace/weeklyPlanningTraceOutbox.ts',
  'trace/weeklyPlanningTraceRemoteRepository.ts',
  'trace/weeklyPlanningTurnDiagnosticV2.ts',
]);

const STATIC_IMPORT_EXPRESSION = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function normalizedRelative(path: string): string {
  return relative(WEEKLY_PLANNING_ROOT, path).split(sep).join('/');
}

function isTestSource(relativePath: string): boolean {
  return relativePath.startsWith('__tests__/')
    || relativePath.includes('/__tests__/')
    || /\.(test|spec)\.(ts|tsx)$/.test(relativePath);
}

function importedStableModules(source: string): string[] {
  return [...source.matchAll(STATIC_IMPORT_EXPRESSION)]
    .map((match) => match[1])
    .filter((specifier) => STABLE_MODULE_TOKENS.some((token) => specifier.includes(token)));
}

describe('Stable V5 production connection boundary', () => {
  it('allows direct Stable V5 imports only through explicitly audited runtime support modules', () => {
    const violations: string[] = [];
    const connectedImporters = new Set<string>();
    for (const path of sourceFiles(WEEKLY_PLANNING_ROOT)) {
      const relativePath = normalizedRelative(path);
      if (isTestSource(relativePath)) continue;
      if (relativePath.startsWith('semantic/')) continue;

      const imports = importedStableModules(readFileSync(path, 'utf8'));
      if (imports.length === 0) continue;
      if (ALLOWED_PRODUCTION_IMPORTERS.has(relativePath)) {
        connectedImporters.add(relativePath);
        continue;
      }
      imports.forEach((specifier) => violations.push(`${relativePath}:${specifier}`));
    }

    expect(violations).toEqual([]);
    expect(connectedImporters).toEqual(ALLOWED_PRODUCTION_IMPORTERS);
  });
});
