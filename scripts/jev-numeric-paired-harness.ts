/** Offline orchestration only: no provider URL/key, corpus discovery or automatic paid execution. */
import { createSemanticRequestRecorder, type SemanticRequestRecorder } from '../shared/semanticDispatchRecorder';
import { summarizeSemanticTurn, type SemanticPopulation } from '../shared/semanticDispatchLedger';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5';
import { applyWeeklyPlanningStableV5ContextualAnswer } from '../src/features/weeklyPlanning/semantic/weeklyPlanningStableV5ContextualAnswer';
import { readWeeklyPlanningPendingQuestionV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningPendingQuestionV5';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerContractsV5';
import type { NumericPendingChoicePortV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningNumericPendingChoiceV5';
import { tryNumericPendingChoiceRouteV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningNumericPendingChoiceV5';
import { WeeklyPlanningSemanticNormalizerRunV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerRunV5';
import { canonicalCandidateSerialization } from '../src/features/weeklyPlanning/application/candidateSelection';
import { numericPendingBoundToInputV5, numericPendingCandidatesV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningNumericPendingChoiceV5';
import { createFocusedContextualAnswerDocumentV5 } from '../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedContextualAnswerV5';
import type { OpenAiCompatibleClient } from '../src/services/ai/openAiCompatibleClient';

export const NUMERIC_PAIRED_ARMS = ['flat', 'hierarchy', 'unparsed_span', 'luna'] as const;
export type NumericPairedArm = typeof NUMERIC_PAIRED_ARMS[number];
export const NUMERIC_CARDINALITIES = [10, 50, 100, 250] as const;
export interface NumericPairedCase {
  readonly pairId: string;
  readonly source: SemanticPopulation['source'];
  readonly input: WeeklyPlanningSemanticNormalizerInputV5;
  /** Frozen independent proposals; offsets only, no semantic conversion or menu pruning. */
  readonly uninterpretedSpans: readonly { readonly start: number; readonly end: number }[];
  readonly labelProvenance: string;
}
export interface NumericPairedAdapters {
  /** Must wrap ACTUAL Jev/Luna fetch boundaries with the supplied Unit1 recorder. Proxy calls are not dispatches. */
  createLunaClient(arm: NumericPairedArm, recorder: SemanticRequestRecorder): OpenAiCompatibleClient;
  createChoicePort(arm: Exclude<NumericPairedArm, 'luna'>, recorder: SemanticRequestRecorder, uninterpretedSpans: NumericPairedCase['uninterpretedSpans']): NumericPendingChoicePortV5;
}
/** All arms use the same existing normalizer, complete domain leaves, whole-turn policy and graph binder. */
export async function runPairedNumericCase(test: NumericPairedCase, adapters: NumericPairedAdapters) {
  if (!test.labelProvenance.trim() || !test.input.committedGraph) throw new Error('Frozen provenance and graph required.');
  const pending = readWeeklyPlanningPendingQuestionV5(test.input.publicStateSummary);
  if (!pending) throw new Error('Typed pending required.');
  for (const span of test.uninterpretedSpans) if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
    || span.start < 0 || span.end <= span.start || span.end > test.input.userText.length) throw new Error('Invalid unparsed span offsets.');
  const outputs = [];
  let domain: string | null = null;
  let policy: string | null = null;
  let binding: string | null = null;
  let domainPolicyVersion: string | null = null;
  let commonPort: NumericPendingChoicePortV5 | null = null;
  for (const arm of NUMERIC_PAIRED_ARMS) {
    const population: SemanticPopulation = { source: test.source, domain: 'weekly-planning', arm: arm === 'luna' ? 'baseline' : 'treatment', corpusId: crypto.randomUUID() };
    const turnId = crypto.randomUUID(); const requestId = crypto.randomUUID();
    const input = structuredClone(test.input); input.traceRequestId = requestId;
    const startedAtMs = Date.now();
    const recorder = createSemanticRequestRecorder({ population, turnId, requestId, stage: 'focused', boundary: 'direct' });
    const luna = adapters.createLunaClient(arm, recorder);
    let port: NumericPendingChoicePortV5 | undefined;
    if (arm !== 'luna') {
      const supplied = adapters.createChoicePort(arm, recorder, arm === 'unparsed_span' ? test.uninterpretedSpans : []);
      // Flat/span do not silently drop leaves; hierarchy partitions exactly the same complete domain.
      port = { ...supplied, maximumChildrenPerMenu: arm === 'hierarchy' ? 10 : 254 };
      const current = supplied.readCurrent(input);
      if (!current) throw new Error('Missing common binding.');
      const comparableBinding = canonicalCandidateSerialization({ ...current, binding: { ...current.binding, requestId: 'paired' } });
      const currentDomain = canonicalCandidateSerialization(supplied.domainMinutes); const currentPolicy = canonicalCandidateSerialization(supplied.choicePolicy);
      if (domain !== null && (domain !== currentDomain || policy !== currentPolicy || binding !== comparableBinding || domainPolicyVersion !== supplied.domainPolicyVersion)) throw new Error('Asymmetric leaves, binder or whole-turn policy.');
      domain = currentDomain; policy = currentPolicy; binding = comparableBinding;
      domainPolicyVersion = supplied.domainPolicyVersion; commonPort ??= supplied;
    }
    const staged = port ? await tryNumericPendingChoiceRouteV5(new WeeklyPlanningSemanticNormalizerRunV5(luna, input), port) : null;
    const result = staged ?? await createWeeklyPlanningSemanticNormalizerV5(luna).normalize(input);
    // One shared complete-document/leaf gate for EVERY arm, including Luna; the binder cannot silently
    // accept a partial effort from a document that also carries independent meaning or altered precision.
    const current = commonPort?.readCurrent(input);
    const completeLeaf = result.document && current && numericPendingBoundToInputV5(input, current)
      ? numericPendingCandidatesV5(current, commonPort!.domainMinutes).find(candidate => {
        const leaf = candidate.tuple;
        const expected = createFocusedContextualAnswerDocumentV5({ input, decision: { decision: 'effort_answer', effortTarget: 'question_target',
          effortMeasurement: leaf.measurement, minutes: leaf.minutes, precision: leaf.precision, quantityRole: null } });
        return expected !== null && canonicalCandidateSerialization(expected) === canonicalCandidateSerialization(result.document);
      }) : null;
    const graph = result.document && completeLeaf ? applyWeeklyPlanningStableV5ContextualAnswer({ graph: input.committedGraph!, document: result.document, pendingQuestion: pending,
      conversationId: 'paired-evaluation', turnId, expectedRevision: input.committedGraph!.revision, userText: input.userText }) : null;
    recorder.finishMain(); await recorder.settle();
    const summary = summarizeSemanticTurn({ version: 1, population, turnId, pairId: test.pairId, expectedRequestIds: [requestId], sealed: true,
      startedAtMs, completedAtMs: Date.now(), semanticResolution: graph?.status === 'applied' ? 'success' : 'failure', mutatingCommit: false }, [recorder.snapshot()]);
    outputs.push({ arm, result, graph, completeLeafId: completeLeaf?.id ?? null, summary, labelProvenance: test.labelProvenance, spanAuthority: arm === 'unparsed_span' ? 'offset_evidence_only_same_complete_leaves' : null });
  }
  return outputs;
}

/** Diagnostic strata only, never production-frequency evidence or a pooled adoption denominator. */
export function numericCardinalityDiagnostics() {
  return NUMERIC_CARDINALITIES.map(cardinality => ({ cardinality, domainMinutes: Array.from({ length: cardinality }, (_, index) => index + 1), bindingMustRemainFixed: true }));
}

/** Separate paired diagnostic rows; machine binding is frozen across strata, never pooled as frequency. */
export async function runNumericCardinalityDiagnostics(test: NumericPairedCase, adapters: NumericPairedAdapters) {
  let fixedBinding: string | null = null;
  const strata = [];
  for (const diagnostic of numericCardinalityDiagnostics()) {
    const rows = await runPairedNumericCase(test, { ...adapters, createChoicePort(arm, recorder, spans) {
      const port = adapters.createChoicePort(arm, recorder, spans);
      const current = port.readCurrent(test.input);
      if (!current) throw new Error('Missing diagnostic binding.');
      const identity = canonicalCandidateSerialization(current);
      if (fixedBinding !== null && fixedBinding !== identity) throw new Error('Cardinality changed machine binding.');
      fixedBinding = identity;
      return { ...port, domainMinutes: diagnostic.domainMinutes };
    } });
    strata.push({ cardinality: diagnostic.cardinality, rows });
  }
  return strata;
}
