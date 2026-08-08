from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


pipeline = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5.ts'
replace_once(
    pipeline,
    "} from './weeklyPlanningSemanticNormalizerV5';\nimport {\n  recordWeeklyPlanningStableV5DebugTrace,\n} from '../trace/weeklyPlanningStableV5DebugTrace';",
    "} from './weeklyPlanningSemanticNormalizerV5';\nimport type {\n  WeeklyPlanningSemanticNameVerifierV5,\n} from './weeklyPlanningSemanticNameVerifierV5';\nimport {\n  recordWeeklyPlanningStableV5DebugTrace,\n} from '../trace/weeklyPlanningStableV5DebugTrace';",
)
replace_once(
    pipeline,
    "export function createWeeklyPlanningSemanticPipelineV5(\n  normalizer: WeeklyPlanningSemanticNormalizerV5,\n): {",
    "export function createWeeklyPlanningSemanticPipelineV5(\n  normalizer: WeeklyPlanningSemanticNormalizerV5,\n  nameVerifier?: WeeklyPlanningSemanticNameVerifierV5,\n): {",
)
marker = "      const pendingQuestion = readWeeklyPlanningPendingQuestionV5(publicStateSummary);"
block = """      let semanticDocument = normalization.document;
      if (nameVerifier) {
        const nameVerification = await nameVerifier.verify({
          userText: input.userText,
          recentConversation: input.recentConversation,
          document: semanticDocument,
        });
        recordWeeklyPlanningStableV5DebugTrace({
          requestId: input.turnId,
          stage: 'semantic_name_verification_completed',
          severity: nameVerification.status === 'verified' ? 'info' : 'error',
          data: nameVerification,
        });
        if (nameVerification.status === 'provider_failure') {
          recordWeeklyPlanningStableV5FailureDiagnostics({
            turnId: input.turnId,
            status: 'provider_failure',
            diagnostics: {
              ...normalization.diagnostics,
              providerError: `semantic-name-verifier:${nameVerification.providerError ?? 'provider failure'}`,
            },
          });
          return {
            pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
            status: 'provider_failure',
            graph,
            normalization,
            canonicalization: null,
            scheduler: null,
          };
        }
        if (!nameVerification.document) {
          recordWeeklyPlanningStableV5FailureDiagnostics({
            turnId: input.turnId,
            status: 'normalization_rejected',
            diagnostics: {
              ...normalization.diagnostics,
              validationErrors: [
                ...normalization.diagnostics.validationErrors,
                ...nameVerification.errors.map((error) => `semantic-name-verifier:${error}`),
              ],
            },
          });
          return {
            pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
            status: 'normalization_rejected',
            graph,
            normalization,
            canonicalization: null,
            scheduler: null,
          };
        }
        semanticDocument = nameVerification.document;
      }
      const effectiveNormalization: WeeklyPlanningSemanticNormalizerResultV5 = {
        ...normalization,
        document: semanticDocument,
      };

""" + marker
replace_once(pipeline, marker, block)
replace_once(
    pipeline,
    "        normalization,\n        expectedRevision: input.expectedRevision,",
    "        normalization: effectiveNormalization,\n        expectedRevision: input.expectedRevision,",
)
replace_once(
    pipeline,
    "            document: normalization.document,\n            pendingQuestion,",
    "            document: semanticDocument,\n            pendingQuestion,",
)
replace_once(
    pipeline,
    "          document: normalization.document,\n          context: canonicalizationContext,",
    "          document: semanticDocument,\n          context: canonicalizationContext,",
)
replace_once(
    pipeline,
    "            document: normalization.document,\n            canonicalization: baseCanonicalization,",
    "            document: semanticDocument,\n            canonicalization: baseCanonicalization,",
)
replace_once(
    pipeline,
    "            document: normalization.document,\n            context: canonicalizationContext,",
    "            document: semanticDocument,\n            context: canonicalizationContext,",
)
replace_once(
    pipeline,
    """      const result: WeeklyPlanningSemanticPipelineResultV5 = {
        pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
        status,
        graph: canonicalization.graph,
        normalization,
        canonicalization,
        scheduler,
      };""",
    """      const result: WeeklyPlanningSemanticPipelineResultV5 = {
        pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
        status,
        graph: canonicalization.graph,
        normalization: effectiveNormalization,
        canonicalization,
        scheduler,
      };""",
)

runtime = 'src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.ts'
replace_once(
    runtime,
    "import {\n  createWeeklyPlanningSemanticNormalizerV5,\n} from '../semantic/weeklyPlanningSemanticNormalizerV5';\nimport {\n  createWeeklyPlanningSemanticPipelineV5,\n} from '../semantic/weeklyPlanningSemanticPipelineV5';",
    "import {\n  createWeeklyPlanningSemanticNormalizerV5,\n} from '../semantic/weeklyPlanningSemanticNormalizerV5';\nimport {\n  createWeeklyPlanningSemanticNameVerifierV5,\n} from '../semantic/weeklyPlanningSemanticNameVerifierV5';\nimport {\n  createWeeklyPlanningSemanticPipelineV5,\n} from '../semantic/weeklyPlanningSemanticPipelineV5';",
)
replace_once(
    runtime,
    """  const normalizer = createWeeklyPlanningSemanticNormalizerV5(
    createOpenAiCompatibleClient(aiConfig),
  );
  const pipeline = createWeeklyPlanningSemanticPipelineV5(normalizer);""",
    """  const semanticClient = createOpenAiCompatibleClient(aiConfig);
  const normalizer = createWeeklyPlanningSemanticNormalizerV5(semanticClient);
  const nameVerifier = createWeeklyPlanningSemanticNameVerifierV5(semanticClient);
  const pipeline = createWeeklyPlanningSemanticPipelineV5(normalizer, nameVerifier);""",
)
