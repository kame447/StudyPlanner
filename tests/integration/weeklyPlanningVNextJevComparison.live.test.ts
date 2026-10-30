import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { startVNextJevRemote, type ProviderUsage } from '../../scripts/vnext-jev-remote';
import type { CandidateChoiceWireRequest, CandidateChoiceEvaluation } from '../../shared/candidateChoiceDecision';
import {
  createCandidateManifest, selectApplicationCandidate,
  type CalibratedChoicePolicy, type CandidateChoiceRequest,
} from '../../src/features/weeklyPlanning/application/candidateSelection';
import { createWeeklyPlanningVNextOptionChoiceInterpreter, vnextOptionChoiceBasis } from '../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextOptionChoice';
import { presentWeeklyPlanningVNextQuestion } from '../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextQuestionText';
import { parseWeeklyApprovalLedger } from '../../src/features/weeklyPlanning/planning/weeklyPlanningApproval';
import {
  approveWeeklyPlanningVNextExperimentalPreview, readWeeklyPlanningVNextExperimentalSession, submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope,
} from '../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextExperimentalSession';
import { projectWeeklyPlanningVNext } from '../../src/features/weeklyPlanning/vnext/projection/weeklyPlanningVNextProjection';
import { createWeeklyPlanningVNextProviderInterpreter } from '../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProvider';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextTransaction';
import { createVNextLineageResolver } from '../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextWorkIdentity';
import type { WeeklyPlanningVNextInterpreter } from '../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import { VNEXT_JEV_COMPARISON_CASES, VNEXT_JEV_COMPARISON_SPLIT_SHA256,
  VNEXT_JEV_COMPARISON_DEV_CASES, VNEXT_JEV_COMPARISON_DEV_CASES_SHA256,
  type VNextJevComparisonCase, type VNextJevFinalStateOracle, type VNextJevMenuShape, type VNextJevWorkOracle }
  from '../../src/features/weeklyPlanning/evals/vnextJevComparisonCases';

const live = process.env.VNEXT_JEV_REMOTE === '1' && process.env.CI !== 'true';
const repeatCount = 3;
const devRawArtifactSha256 = '84407271248b860e7b4f8e76f3ba38737c9741932c0a38b884ac5004f9d3d528';
const artifactDirectory = resolve(process.env.VNEXT_JEV_COMPARISON_ARTIFACT_DIR ?? 'artifacts/vnext-jev-comparison');
const devRawArtifactPath = process.env.VNEXT_JEV_DEV_RAW_ARTIFACT ? resolve(process.env.VNEXT_JEV_DEV_RAW_ARTIFACT) : null;
const approvedCalibrationEvidenceId = process.env.VNEXT_JEV_HOLDOUT_POLICY_ID ?? null;
const reportPath = resolve(artifactDirectory, 'vnext-jev-comparison-report.md');
const rawObservationsPath = resolve(artifactDirectory, 'holdout-observations.json');
const offlineRescoreObservationsPath = process.env.VNEXT_JEV_HOLDOUT_OBSERVATIONS_PATH
  ? resolve(process.env.VNEXT_JEV_HOLDOUT_OBSERVATIONS_PATH) : null;
const shapes: readonly VNextJevMenuShape[] = ['remaining_conflict', 'one_target_same_or_distinct', 'two_work_keep_or_distinct'];

interface CalibrationSample {
  caseId: string;
  shape: VNextJevMenuShape;
  expectedChoice: string | null;
  selectedChoice: string | null;
  topProbability: number | null;
  margin: number | null;
  conditionChange: number | null;
  independentMeaning: number | null;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null; latencyMs: number };
  result: CandidateChoiceEvaluation | { status: 'unavailable'; reason: string };
}

interface DevRawCall {
  caseId: string;
  repetition: number;
  menuShape: VNextJevMenuShape;
  menu: { kind: string; depth: number; optionCount: number };
  expectedChoice: string;
  expectedWireOptionId: string;
  requestSha256: string;
  status: string;
  optionId: string | null;
  choice: string | null;
  probabilities: Array<{ optionId: string; probability: number }>;
  conditionChange: number | null;
  independentMeaning: number | null;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null; latencyMs: number;
    servedModel: string; httpStatus: number };
}

interface DevRawArtifact {
  schemaVersion: 'vnext-jev-dev-raw-v1';
  split: 'dev';
  splitHash: string;
  devCasesHash: string;
  codeHead: string;
  repetitions: number;
  caseCount: number;
  completed: boolean;
  calls: DevRawCall[];
}

interface CaseObservation {
  caseId: string;
  caseClass: 'option_choice' | 'full_reading';
  split: 'holdout';
  repetition: number;
  arm: 'luna_only' | 'jev_to_luna';
  outcome: string;
  route: 'option_choice' | 'full_reading' | null;
  selectedOptionId: string | null;
  expectedSelectionCorrect: boolean | null;
  finalStateCorrect: boolean;
  differences: string[];
  questionCode: string | null;
  deferredQuestionCodes: string[];
  interpretationStatus: string | null;
  interpretationCalls: number;
  interpretationLatencyMs: number;
  appliedDelta: unknown;
  errors: unknown[];
  previewBlockedBy: string[];
  savedPlanCount: number;
  usage: { luna: ProviderUsage; jev: ProviderUsage };
  approvalLifecycle: ApprovalLifecycleObservation | null;
}

interface ApprovalLifecycleObservation {
  completedAfterFailure: boolean;
  failedReceiptRecorded: boolean;
  repeatedApprovalNoop: boolean;
  savedPlanCountMatchesPreview: boolean;
  previewBlockCount: number;
  savedPlanCount: number;
  saveAttempts: number;
  syntheticCloseoutTurn: boolean;
  reloadMatchesCheckpoint: boolean;
  legacyV5Unchanged: boolean;
}

function emptyDelta(): VNextTurnDelta {
  return { add: [], patch: [], remove: [], relate: [], defer: [] };
}

function taskSeedDelta(testCase: VNextJevComparisonCase) {
  return { ...emptyDelta(), add: [
    { kind: 'task' as const, localId: 'task', category: 'study' as const, title: testCase.seed.taskTitle },
    ...testCase.seed.facts,
  ] };
}

function makeScope(testCase: VNextJevComparisonCase, repetition: number): WeeklyPlanningVNextExperimentalScope {
  return {
    ownerId: 'synthetic-jev-luna-comparison',
    weekStartDate: testCase.seed.acceptedDate,
    conversationId: `jev-comparison:${testCase.id}:r${repetition}`,
    clock: { currentDate: testCase.seed.acceptedDate, planningStartDate: testCase.seed.acceptedDate,
      planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
    notBeforeTime: '09:00',
  };
}

function makeHarness(testCase: VNextJevComparisonCase, repetition: number, client: Parameters<WeeklyPlanningVNextInterpreter>[0]['client'], interpreter: WeeklyPlanningVNextInterpreter, failSaveOnce?: number) {
  const slots = new Map<string, string>();
  const slot = (name: string) => ({ read: () => slots.get(name) ?? null, write: (raw: string) => { slots.set(name, raw); } });
  const saved = new Map<string, unknown>();
  let seedPending = true;
  let saveCalls = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client,
    async interpret(input) {
      if (!seedPending) return interpreter(input);
      seedPending = false;
      return { status: 'interpreted', delta: taskSeedDelta(testCase), answer: null,
        metrics: { calls: 0, repairs: 0, latencyMs: 0 } };
    },
    checkpoint: slot('vnext'), legacyV5Checkpoint: { read: slot('v5').read }, approvalLedger: slot('ledger'),
    plans: {
      async findExistingPlanId(id) { return saved.has(id) ? `plan:${id}` : undefined; },
      async saveBlock(block) {
        saveCalls++;
        if (saveCalls === failSaveOnce) throw new Error('synthetic save failure');
        saved.set(block.id, block);
        return { planId: `plan:${block.id}` };
      },
    },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    // This comparison measures interpretation; the reply text is not compared.
    createRenderer: () => ({ render: async () => ({ status: 'rendered' as const, text: '（説明）', rawResponse: '' }) }),
    now: () => '2026-11-02T09:00:00.000Z',
  };
  return { ports, saved, slots, saveCalls: () => saveCalls };
}

function activeQuestion(state: WeeklyPlanningVNextState) {
  return projectWeeklyPlanningVNext(state).questions[0] ?? null;
}

async function captureCandidateRequest(testCase: VNextJevComparisonCase, repetition: number, rawDev = false): Promise<{
  request: CandidateChoiceRequest; expectedChoice: string | null;
}> {
  const conversationId = rawDev ? `vnext-jev-dev:${testCase.id}` : `jev-comparison:${testCase.id}:r${repetition}`;
  const ownerId = rawDev ? 'synthetic-dev' : 'synthetic-jev-luna-comparison';
  const scope = { ...makeScope(testCase, repetition), ownerId, conversationId };
  const seedDelta = taskSeedDelta(testCase);
  const seed = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), seedDelta, {
    expectedRevision: 0, acceptedDate: testCase.seed.acceptedDate, weekStartsOn: scope.clock.weekStartsOn,
    defaultPlanningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate },
    planningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate }, turnKey: 'seed',
    conversationId: scope.conversationId, turnId: 'seed', sourceText: rawDev ? 'Synthetic development seed' : 'synthetic seed',
  });
  if (seed.status !== 'applied') throw new Error(`Invalid seed for ${testCase.id}.`);
  const question = activeQuestion(seed.state);
  if (!question) throw new Error(`Seed did not present a question for ${testCase.id}.`);
  const presentation = presentWeeklyPlanningVNextQuestion(seed.state, question);
  const basis = await vnextOptionChoiceBasis({ ownerId: scope.ownerId, conversationId: scope.conversationId,
    graphRevision: seed.state.graph.revision, question, presentation });
  const manifest = await createCandidateManifest(basis);
  let captured: CandidateChoiceRequest | undefined;
  await selectApplicationCandidate({
    manifest, wholeUtterance: testCase.userText, maximumChildrenPerMenu: question.options.length, maximumDecisions: 1,
    policy: { id: 'local-capture-only', calibrationEvidenceId: 'no-provider-call', rules: [{ menuKind: 'leaves',
      optionCount: question.options.length + 1, depth: 0, minimumTopProbability: 0, minimumMargin: 0 }] },
    readCurrent: () => ({ ...basis, sourceAccess: 'allowed', intentProvenance: 'validated_current_turn',
      targetStatus: 'active', questionPresentation: 'fresh', formalEligibility: 'eligible' }),
    choose: async (request, beforeDispatch) => { beforeDispatch(); captured = request; return {}; },
  });
  if (!captured) throw new Error(`Unable to capture application choice request for ${testCase.id}.`);
  const leafIds = captured.menu.options.flatMap((option) => option.kind === 'leaf' && typeof option.candidate.tuple.optionId === 'string'
    ? [option.candidate.tuple.optionId] : []);
  const expectedChoice = typeof testCase.expectedChoice === 'string' ? testCase.expectedChoice
    : testCase.expectedChoice ? leafIds.find((id) => selectionMatches(testCase, id, seed.state) === true) ?? null : null;
  return { request: captured, expectedChoice };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDevRawArtifact(path: string, expectedFileSha256: string | null = devRawArtifactSha256): DevRawArtifact {
  const bytes = readFileSync(path);
  if (expectedFileSha256 !== null && createHash('sha256').update(bytes).digest('hex') !== expectedFileSha256) {
    throw new Error('Dev raw artifact file hash differs from the frozen collection receipt.');
  }
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isRecord(parsed) || parsed.schemaVersion !== 'vnext-jev-dev-raw-v1' || parsed.split !== 'dev'
    || parsed.splitHash !== VNEXT_JEV_COMPARISON_SPLIT_SHA256
    || parsed.devCasesHash !== VNEXT_JEV_COMPARISON_DEV_CASES_SHA256
    || parsed.codeHead !== '9873f0428497bbe38f7afe29f1bb1f94e20770c7' || parsed.repetitions !== repeatCount
    || parsed.caseCount !== VNEXT_JEV_COMPARISON_DEV_CASES.length
    || parsed.completed !== true || !Array.isArray(parsed.calls)) {
    throw new Error('Dev raw artifact does not match the frozen corpus/schema/code snapshot.');
  }
  const expectedPairs = new Set(VNEXT_JEV_COMPARISON_DEV_CASES.flatMap((item) =>
    Array.from({ length: repeatCount }, (_, index) => `${item.id}:${index + 1}`)));
  if (parsed.calls.length !== expectedPairs.size) throw new Error('Dev raw artifact has an unexpected call count.');
  for (const value of parsed.calls) {
    if (!isRecord(value) || typeof value.caseId !== 'string' || !Number.isInteger(value.repetition)
      || !expectedPairs.delete(`${value.caseId}:${value.repetition}`)
      || !shapes.includes(value.menuShape as VNextJevMenuShape)
      || !isRecord(value.menu) || typeof value.menu.kind !== 'string' || !Number.isInteger(value.menu.depth)
      || !Number.isInteger(value.menu.optionCount) || typeof value.expectedChoice !== 'string'
      || typeof value.expectedWireOptionId !== 'string' || typeof value.requestSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.requestSha256) || typeof value.status !== 'string'
      || !(typeof value.optionId === 'string' || value.optionId === null)
      || !(typeof value.choice === 'string' || value.choice === null)
      || !Array.isArray(value.probabilities)
      || !(typeof value.conditionChange === 'number' || value.conditionChange === null)
      || !(typeof value.independentMeaning === 'number' || value.independentMeaning === null)
      || !isRecord(value.usage) || !Number.isSafeInteger(value.usage.inputTokens) || Number(value.usage.inputTokens) < 0
      || !Number.isSafeInteger(value.usage.outputTokens) || Number(value.usage.outputTokens) < 0
      || !(value.usage.costUsd === null || (typeof value.usage.costUsd === 'number'
        && Number.isFinite(value.usage.costUsd) && value.usage.costUsd >= 0))
      || typeof value.usage.latencyMs !== 'number' || !Number.isFinite(value.usage.latencyMs) || value.usage.latencyMs < 0
      || typeof value.usage.servedModel !== 'string' || typeof value.usage.httpStatus !== 'number') {
      throw new Error('Dev raw artifact contains a malformed or duplicate call receipt.');
    }
    for (const item of value.probabilities) {
      if (!isRecord(item) || typeof item.optionId !== 'string' || typeof item.probability !== 'number'
        || !Number.isFinite(item.probability) || item.probability < 0 || item.probability > 1) {
        throw new Error(`Dev raw probabilities are malformed for ${value.caseId}.`);
      }
    }
  }
  if (expectedPairs.size) throw new Error('Dev raw artifact is missing one or more frozen observations.');
  return parsed as unknown as DevRawArtifact;
}

async function calibrateFromRawArtifact(path: string, expectedFileSha256: string | null = devRawArtifactSha256): Promise<CalibrationSample[]> {
  const artifact = readDevRawArtifact(path, expectedFileSha256);
  const receipts = new Map(artifact.calls.map((item) => [`${item.caseId}:${item.repetition}`, item]));
  const samples: CalibrationSample[] = [];
  for (const testCase of VNEXT_JEV_COMPARISON_DEV_CASES) {
    for (let repetition = 1; repetition <= repeatCount; repetition++) {
      const receipt = receipts.get(`${testCase.id}:${repetition}`)!;
      const { request, expectedChoice } = await captureCandidateRequest(testCase, repetition, true);
      const wireRequest = request as CandidateChoiceWireRequest;
      const actualRequestHash = createHash('sha256').update(JSON.stringify(request), 'utf8').digest('hex');
      if (actualRequestHash !== receipt.requestSha256 || receipt.menuShape !== testCase.menuShape
        || receipt.menu.kind !== request.menu.kind || receipt.menu.depth !== request.menu.depth
        || receipt.menu.optionCount !== request.menu.options.length) {
        throw new Error(`Dev raw request does not match the independently rebuilt request for ${testCase.id}/${repetition}.`);
      }
      const normalizedExpected = receipt.expectedChoice === 'none' ? null : receipt.expectedChoice;
      if (normalizedExpected !== expectedChoice) throw new Error(`Dev raw expected choice differs from the frozen oracle for ${testCase.id}.`);
      const expectedWireOptionId = expectedChoice === null ? 'none' : request.menu.options.find((option) =>
        option.kind === 'leaf' && option.candidate.tuple.optionId === expectedChoice)?.id;
      if (receipt.expectedWireOptionId !== expectedWireOptionId) throw new Error(`Dev raw expected wire ID differs for ${testCase.id}.`);
      const offeredIds = request.menu.options.map((option) => option.id);
      const probabilityIds = receipt.probabilities.map((item) => item.optionId);
      const fullProbabilityVector = new Set(probabilityIds).size === probabilityIds.length
        && offeredIds.length === probabilityIds.length && offeredIds.every((id) => probabilityIds.includes(id));
      if ((receipt.status === 'evaluated' && !fullProbabilityVector)
        || (receipt.status !== 'evaluated' && probabilityIds.length > 0 && !fullProbabilityVector)) {
        throw new Error(`Dev raw probability vector does not cover the offered menu for ${testCase.id}/${repetition}.`);
      }
      let result: CalibrationSample['result'];
      let selected: string | null = null;
      if (receipt.status === 'evaluated') {
        if (receipt.optionId === null) throw new Error(`Evaluated raw receipt is missing a wire option for ${testCase.id}.`);
        selected = selectedChoice(wireRequest, { status: 'evaluated', optionId: receipt.optionId,
          catalogVersion: 'complete-candidate-choice-2026-10-13-v2', requestId: request.requestId,
          selectionEpoch: request.selectionEpoch, candidateSetHash: request.candidateSetHash,
          nodeId: request.menu.nodeId, probabilities: receipt.probabilities,
          conditionChange: receipt.conditionChange ?? 0, independentMeaning: receipt.independentMeaning ?? 0 });
        const selectedDomainChoice = selected ?? 'none';
        if (receipt.choice !== selectedDomainChoice || !offeredIds.includes(receipt.optionId)
          || receipt.conditionChange === null || receipt.independentMeaning === null) {
          throw new Error(`Dev raw choice/heads do not match its offered wire result for ${testCase.id}/${repetition}.`);
        }
        result = { status: 'evaluated', catalogVersion: 'complete-candidate-choice-2026-10-13-v2',
          requestId: request.requestId, selectionEpoch: request.selectionEpoch, candidateSetHash: request.candidateSetHash,
          nodeId: request.menu.nodeId, optionId: receipt.optionId, probabilities: receipt.probabilities,
          conditionChange: receipt.conditionChange, independentMeaning: receipt.independentMeaning };
      } else {
        if (receipt.optionId !== null || receipt.choice !== null) throw new Error(`Non-evaluated raw receipt has a selected choice for ${testCase.id}.`);
        result = { status: 'unavailable', reason: receipt.status };
      }
      const scores = probabilityShape(result);
      samples.push({ caseId: testCase.id, shape: testCase.menuShape, expectedChoice,
        selectedChoice: selected, topProbability: scores.top, margin: scores.margin,
        conditionChange: result.status === 'evaluated' ? result.conditionChange : null,
        independentMeaning: result.status === 'evaluated' ? result.independentMeaning : null,
        usage: { inputTokens: receipt.usage.inputTokens, outputTokens: receipt.usage.outputTokens,
          costUsd: receipt.usage.costUsd, latencyMs: receipt.usage.latencyMs }, result });
    }
  }
  return samples;
}

function selectedChoice(request: CandidateChoiceWireRequest, result: CalibrationSample['result']): string | null {
  if (result.status !== 'evaluated' || result.optionId === 'none') return null;
  const selected = request.menu.options.find((option) => option.id === result.optionId);
  if (!selected || selected.kind !== 'leaf') return null;
  const optionId = selected.candidate.tuple.optionId;
  return typeof optionId === 'string' ? optionId : null;
}

function probabilityShape(result: CalibrationSample['result']) {
  if (result.status !== 'evaluated') return { top: null, margin: null };
  const ordered = [...result.probabilities].sort((a, b) => b.probability - a.probability);
  return { top: ordered[0]?.probability ?? null,
    margin: ordered.length > 1 ? ordered[0].probability - ordered[1].probability : null };
}

function thresholdGrid(values: readonly number[]): number[] {
  const options = new Set<number>([0, 1]);
  for (const value of values) {
    options.add(value);
    if (value < 1) options.add(Math.min(1, value + 1e-9));
  }
  return [...options].sort((a, b) => a - b);
}

function popcount(mask: number): number {
  let bits = mask >>> 0;
  let count = 0;
  while (bits) { bits &= bits - 1; count++; }
  return count;
}

interface RuleMask { minimumTopProbability: number; minimumMargin: number; correct: number; wrong: number }
interface ShapeRules { shape: VNextJevMenuShape; optionCount: number; candidates: RuleMask[] }

function calibrate(samples: readonly CalibrationSample[]) {
  const gateCondition = thresholdGrid(samples.flatMap((item) => item.conditionChange === null ? [] : [item.conditionChange]));
  const gateMeaning = thresholdGrid(samples.flatMap((item) => item.independentMeaning === null ? [] : [item.independentMeaning]));
  const byShape: ShapeRules[] = shapes.map((shape) => {
    const subset = samples.filter((sample) => sample.shape === shape);
    const tops = thresholdGrid(subset.flatMap((item) => item.topProbability === null ? [] : [item.topProbability]));
    const margins = thresholdGrid(subset.flatMap((item) => item.margin === null ? [] : [item.margin]));
    const optionCount = shape === 'two_work_keep_or_distinct' ? 4 : 3;
    const candidates: RuleMask[] = [];
    for (const minimumTopProbability of tops) for (const minimumMargin of margins) {
      let correct = 0; let wrong = 0;
      subset.forEach((sample, index) => {
        if (sample.selectedChoice === null || sample.topProbability === null || sample.margin === null
          || sample.topProbability < minimumTopProbability || sample.margin < minimumMargin) return;
        if (sample.expectedChoice !== null && sample.selectedChoice === sample.expectedChoice) correct |= 1 << index;
        else wrong |= 1 << index;
      });
      candidates.push({ minimumTopProbability, minimumMargin, correct, wrong });
    }
    return { shape, optionCount, candidates };
  });

  let best: { condition: number; meaning: number; rules: RuleMask[]; correctCount: number } | null = null;
  for (const maximumConditionChange of gateCondition) for (const maximumIndependentMeaning of gateMeaning) {
    const selectedRules: RuleMask[] = [];
    let correctCount = 0; let safe = true;
    for (const group of byShape) {
      const subset = samples.filter((sample) => sample.shape === group.shape);
      let allowed = 0;
      subset.forEach((sample, index) => {
        if (sample.conditionChange !== null && sample.independentMeaning !== null
          && sample.conditionChange <= maximumConditionChange && sample.independentMeaning <= maximumIndependentMeaning) allowed |= 1 << index;
      });
      let localBest: RuleMask | null = null; let localCorrect = -1;
      for (const candidate of group.candidates) {
        if ((candidate.wrong & allowed) !== 0) continue;
        const count = popcount(candidate.correct & allowed);
        const saferTieBreak = localBest !== null && count === localCorrect
          && (candidate.minimumTopProbability > localBest.minimumTopProbability
            || (candidate.minimumTopProbability === localBest.minimumTopProbability
              && candidate.minimumMargin > localBest.minimumMargin));
        if (count > localCorrect || saferTieBreak) { localBest = candidate; localCorrect = count; }
      }
      if (!localBest) { safe = false; break; }
      selectedRules.push(localBest); correctCount += Math.max(0, localCorrect);
    }
    if (safe && (!best || correctCount > best.correctCount)) {
      best = { condition: maximumConditionChange, meaning: maximumIndependentMeaning,
        rules: selectedRules, correctCount };
    }
  }
  if (!best) return null;
  const probabilityFloors = new Map<number, { minimumTopProbability: number; minimumMargin: number }>();
  for (const group of byShape) {
    const positives = samples.filter((sample) => sample.shape === group.shape
      && sample.expectedChoice !== null && sample.selectedChoice === sample.expectedChoice
      && sample.topProbability !== null && sample.margin !== null);
    if (!positives.length) continue;
    const minimumTopProbability = Math.min(...positives.map((sample) => sample.topProbability!));
    const minimumMargin = Math.min(...positives.map((sample) => sample.margin!));
    const existing = probabilityFloors.get(group.optionCount);
    probabilityFloors.set(group.optionCount, existing ? {
      minimumTopProbability: Math.min(existing.minimumTopProbability, minimumTopProbability),
      minimumMargin: Math.min(existing.minimumMargin, minimumMargin),
    } : { minimumTopProbability, minimumMargin });
  }
  if (byShape.some((group) => !probabilityFloors.has(group.optionCount))) return null;
  const strictRules = byShape.map((group) => ({
    menuKind: 'leaves' as const, optionCount: group.optionCount, depth: 0,
    ...probabilityFloors.get(group.optionCount)!, menuShape: group.shape,
  }));
  const devSelections = samples.filter((sample) => sample.selectedChoice !== null
    && sample.topProbability !== null && sample.margin !== null
    && sample.conditionChange !== null && sample.independentMeaning !== null
    && sample.conditionChange <= best!.condition && sample.independentMeaning <= best!.meaning
    && sample.topProbability >= probabilityFloors.get(sample.shape === 'two_work_keep_or_distinct' ? 4 : 3)!.minimumTopProbability
    && sample.margin >= probabilityFloors.get(sample.shape === 'two_work_keep_or_distinct' ? 4 : 3)!.minimumMargin);
  const strictCorrectSelections = devSelections.filter((sample) => sample.expectedChoice !== null
    && sample.selectedChoice === sample.expectedChoice).length;
  const strictWrongSelections = devSelections.length - strictCorrectSelections;
  const evidence = {
    version: 1,
    devRawSha256: devRawArtifactSha256,
    splitHash: VNEXT_JEV_COMPARISON_SPLIT_SHA256,
    rule: 'Select only when all calibrated probability and semantic thresholds pass; any none, uncertainty, extra meaning, or failed gate routes the whole utterance to Luna. Require zero wrong dev selections, maximize correct selections, then break equal-correct ties by highest minimumTopProbability and then highest minimumMargin; freeze the strictest floors retaining all accepted dev positives for each wire-menu cardinality.',
    decision: { maximumConditionChange: best.condition, maximumIndependentMeaning: best.meaning,
      rules: strictRules },
    devRawScores: samples.map(({ caseId, shape, expectedChoice, selectedChoice, topProbability, margin, conditionChange, independentMeaning, usage, result }) => ({
      caseId, shape, expectedChoice, selectedChoice, topProbability, margin, conditionChange, independentMeaning,
      usage, result: result.status === 'evaluated' ? { status: result.status, optionId: result.optionId, probabilities: result.probabilities } : result,
    })),
  };
  const calibrationEvidenceId = createHash('sha256').update(JSON.stringify(evidence), 'utf8').digest('hex');
  const artifact = { ...evidence, calibrationEvidenceId,
    hashScope: 'SHA-256 over the JSON artifact fields excluding calibrationEvidenceId.' };
  const policyRules = [...new Map(evidence.decision.rules.map(({ menuKind, optionCount, depth, minimumTopProbability, minimumMargin }) =>
    [`${menuKind}:${optionCount}:${depth}`, { menuKind, optionCount, depth, minimumTopProbability, minimumMargin }])).values()];
  const policy: CalibratedChoicePolicy = { id: 'vnext-jev-dev-calibration-v1', calibrationEvidenceId, rules: policyRules };
  return { policy, semanticPolicy: { calibrationEvidenceId, maximumConditionChange: best.condition,
    maximumIndependentMeaning: best.meaning }, artifact, calibrationEvidenceId,
    devCorrectSelections: strictCorrectSelections, devWrongSelections: strictWrongSelections };
}

function unitMatches(actual: { unitCode: string; unitLabel: string }, expected: VNextJevWorkOracle): boolean {
  if (actual.unitCode === expected.unitCode) {
    return actual.unitCode !== 'custom' || actual.unitLabel.normalize('NFKC').trim() === expected.unitLabel.normalize('NFKC').trim();
  }
  const label = actual.unitLabel.normalize('NFKC').trim();
  const equivalents: Record<string, readonly string[]> = { page: ['枚', 'ページ', '頁'], minute: ['分', '分間'] };
  return actual.unitCode === 'custom' && (equivalents[expected.unitCode] ?? []).includes(label);
}

function observedWork(state: WeeklyPlanningVNextState) {
  const active = new Set(state.graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
  const resolver = createVNextLineageResolver(state.graph);
  return state.graph.workloads.filter((fact) => active.has(fact.id)).map((fact) => {
    const taskId = resolver.leafOf(fact.taskId) ?? fact.taskId;
    return { taskTitle: state.graph.tasks.find((task) => task.id === taskId)?.title ?? '',
      quantityRole: fact.quantityRole, amount: fact.amount, unitCode: fact.unitCode, unitLabel: fact.unitLabel };
  });
}

function observedRelations(state: WeeklyPlanningVNextState) {
  const resolver = createVNextLineageResolver(state.graph);
  return state.workRelations.map((relation) => {
    const labels = relation.lineageIds.map((id) => {
      const fact = state.graph.workloads.find((workload) => resolver.lineageOf(workload.id) === id);
      if (!fact) return '';
      const taskId = resolver.leafOf(fact.taskId) ?? fact.taskId;
      const title = state.graph.tasks.find((task) => task.id === taskId)?.title ?? '';
      return `${title} / ${fact.source.semanticLocalId}`;
    }).sort();
    return { kind: relation.kind, leftTaskTitle: labels[0], rightTaskTitle: labels[1] };
  });
}

function compareFinalState(testCase: VNextJevComparisonCase, state: WeeklyPlanningVNextState, savedPlanCount: number) {
  const expected: VNextJevFinalStateOracle = testCase.finalState;
  const projection = projectWeeklyPlanningVNext(state);
  const differences: string[] = [];
  const actualWork = observedWork(state);
  const remaining = [...actualWork];
  for (const wanted of expected.activeWork) {
    const allowedTaskTitles = [wanted.taskTitle, ...(wanted.taskTitleAliases ?? [])];
    const index = remaining.findIndex((actual) => allowedTaskTitles.includes(actual.taskTitle)
      && actual.quantityRole === wanted.quantityRole && actual.amount === wanted.amount && unitMatches(actual, wanted));
    if (index < 0) differences.push(`missing/changed workload ${wanted.taskTitle} ${wanted.quantityRole} ${wanted.amount}${wanted.unitLabel}`);
    else remaining.splice(index, 1);
  }
  if (remaining.length) differences.push(`unexpected workloads: ${JSON.stringify(remaining)}`);
  const normalizeRelations = (items: VNextJevFinalStateOracle['relations']) => items
    .map((item) => `${item.kind}:${[item.leftTaskTitle, item.rightTaskTitle].sort().join(':')}`).sort();
  if (JSON.stringify(normalizeRelations(observedRelations(state))) !== JSON.stringify(normalizeRelations(expected.relations))) {
    differences.push('work relations differ');
  }
  const activeFacts = new Set(state.graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
  const resolver = createVNextLineageResolver(state.graph);
  const actualDeadlines = state.graph.temporalConstraints.filter((fact) => activeFacts.has(fact.id) && fact.constraintLevel === 'hard')
    .map((fact) => ({ taskTitle: state.graph.tasks.find((task) => task.id === (resolver.leafOf(fact.taskId) ?? fact.taskId))?.title ?? '',
      date: fact.dateExpression ?? '', constraintKind: fact.kind }))
    .sort((a, b) => `${a.taskTitle}:${a.date}:${a.constraintKind}`.localeCompare(`${b.taskTitle}:${b.date}:${b.constraintKind}`));
  const expectedDeadlines = expected.hardDeadlines.slice()
    .sort((a, b) => `${a.taskTitle}:${a.date}:${a.constraintKind}`.localeCompare(`${b.taskTitle}:${b.date}:${b.constraintKind}`));
  if (JSON.stringify(actualDeadlines) !== JSON.stringify(expectedDeadlines)) differences.push('hard deadlines differ');
  const questionCodes = projection.questions.map((question) => question.code).sort();
  const deferredCodes = projection.deferredQuestions.map((question) => question.code).sort();
  const acceptedQuestionStates = expected.questionStateAlternatives ?? [{
    openQuestionCodes: expected.openQuestionCodes, deferredQuestionCodes: expected.deferredQuestionCodes,
  }];
  const questionStateMatches = acceptedQuestionStates.some((candidate) =>
    JSON.stringify(questionCodes) === JSON.stringify(candidate.openQuestionCodes.slice().sort())
    && JSON.stringify(deferredCodes) === JSON.stringify(candidate.deferredQuestionCodes.slice().sort()));
  if (!questionStateMatches) differences.push('open/deferred question state differs');
  const minutes = projection.owners.flatMap((owner) => owner.work.map((work) => work.minutes))
    .filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (JSON.stringify(minutes) !== JSON.stringify(expected.scheduledWorkMinutes.slice().sort((a, b) => a - b))) differences.push('scheduled work minutes differ');
  if (savedPlanCount !== expected.savedPlanCount) differences.push(`saved plan count expected=${expected.savedPlanCount} actual=${savedPlanCount}`);
  return { differences, questionCode: questionCodes[0] ?? null, deferredQuestionCodes: deferredCodes };
}

function selectionMatches(testCase: VNextJevComparisonCase, selectedId: string | null, initialState: WeeklyPlanningVNextState): boolean | null {
  if (selectedId === null) return null;
  if (typeof testCase.expectedChoice === 'string') return selectedId === testCase.expectedChoice;
  if (!testCase.expectedChoice || !('keep' in testCase.expectedChoice)) return false;
  const expected = testCase.expectedChoice.keep;
  const question = activeQuestion(initialState);
  if (!question) return false;
  const active = new Set(initialState.graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
  const option = question.options.find((candidate) => candidate.optionId === selectedId && candidate.optionId.startsWith('keep:'));
  if (!option) return false;
  const removedId = option.delta.remove[0]?.targetFactId;
  const retained = initialState.graph.workloads.filter((fact) => active.has(fact.id) && fact.id !== removedId);
  return retained.length === 1 && retained[0].amount === expected.amount && retained[0].quantityRole === expected.quantityRole
    && unitMatches(retained[0], expected);
}

function reconstructObservedState(testCase: VNextJevComparisonCase, observation: CaseObservation): WeeklyPlanningVNextState {
  const scope = makeScope(testCase, observation.repetition);
  const seed = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), taskSeedDelta(testCase), {
    expectedRevision: 0, acceptedDate: testCase.seed.acceptedDate, weekStartsOn: scope.clock.weekStartsOn,
    defaultPlanningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate },
    planningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate },
    turnKey: `${scope.conversationId}:seed`, conversationId: scope.conversationId,
    turnId: 'seed', sourceText: 'synthetic seed',
  });
  if (seed.status !== 'applied') throw new Error(`Cannot rebuild saved holdout seed ${testCase.id}/${observation.repetition}.`);
  if (observation.outcome !== 'applied') return seed.state;
  if (!isRecord(observation.appliedDelta)) throw new Error(`Applied observation lacks a typed delta: ${testCase.id}/${observation.repetition}.`);
  const applied = applyWeeklyPlanningVNextTurn(seed.state, observation.appliedDelta as unknown as VNextTurnDelta, {
    expectedRevision: seed.state.graph.revision, acceptedDate: testCase.seed.acceptedDate,
    weekStartsOn: scope.clock.weekStartsOn,
    defaultPlanningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate },
    planningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate },
    turnKey: `${scope.conversationId}:reply`, conversationId: scope.conversationId,
    turnId: 'reply', sourceText: testCase.userText,
  });
  if (applied.status !== 'applied') throw new Error(`Cannot replay saved holdout delta ${testCase.id}/${observation.repetition}.`);
  return applied.state;
}

async function executeApprovalLifecycle(scope: WeeklyPlanningVNextExperimentalScope, harness: ReturnType<typeof makeHarness>,
  testCase: VNextJevComparisonCase, shownRevision: number | null, arm: string): Promise<ApprovalLifecycleObservation> {
  const legacyBefore = harness.slots.get('v5') ?? null;
  let lifecycleRead = readWeeklyPlanningVNextExperimentalSession(scope, harness.ports);
  if (lifecycleRead.status !== 'ready') throw new Error(`Lifecycle checkpoint unreadable for ${testCase.id}.`);
  const syntheticCloseoutTurn = projectWeeklyPlanningVNext(lifecycleRead.checkpoint.state).questions.length > 0;
  if (syntheticCloseoutTurn) {
    const question = projectWeeklyPlanningVNext(lifecycleRead.checkpoint.state).questions[0];
    const lineageId = question.forWork?.workLineageId;
    const resolver = createVNextLineageResolver(lifecycleRead.checkpoint.state.graph);
    const targetWork = lifecycleRead.checkpoint.state.graph.workloads.find((fact) => resolver.lineageOf(fact.id) === lineageId);
    if (!lineageId || !targetWork) throw new Error(`Cannot close the preview estimate question for ${testCase.id}.`);
    harness.ports.interpret = async () => ({ status: 'interpreted', delta: { ...emptyDelta(), add: [{
      kind: 'effort_estimate', localId: 'synthetic-approval-estimate', taskRef: { factId: targetWork.taskId },
      targetRef: { workLineageId: lineageId }, effortKind: 'total_duration', minutes: 120,
      unitCode: null, unitLabel: null, precision: 'exact',
    }] }, answer: null, metrics: { calls: 0, repairs: 0, latencyMs: 0 } });
    const closeout = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: harness.ports,
      turnId: 'approval-preview-closeout', userText: 'Synthetic setup for preview save lifecycle', shownRevision });
    if (closeout.outcome !== 'applied') throw new Error(`Preview setup turn failed for ${testCase.id}.`);
    lifecycleRead = readWeeklyPlanningVNextExperimentalSession(scope, harness.ports);
    if (lifecycleRead.status !== 'ready') throw new Error(`Preview setup checkpoint unreadable for ${testCase.id}.`);
  }
  const readyProjection = projectWeeklyPlanningVNext(lifecycleRead.checkpoint.state);
  const preview = lifecycleRead.checkpoint.preview;
  if (!preview || readyProjection.questions.length !== 0) throw new Error(`Lifecycle case ${testCase.id} did not reach a question-free preview.`);
  const failed = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: harness.ports });
  const rawLedger = harness.slots.get('ledger');
  if (!rawLedger) throw new Error(`Failed approval did not persist a receipt for ${testCase.id}.`);
  const receipt = parseWeeklyApprovalLedger(rawLedger)?.operations.find((operation) => operation.previewId
    === preview.previewId && operation.previewStateRevision === preview.graphRevision);
  if (!receipt) throw new Error(`Approval receipt missing for ${testCase.id}.`);
  const resumed = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: harness.ports });
  const attemptsAfterResume = harness.saveCalls();
  const repeated = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: harness.ports });
  const reloaded = readWeeklyPlanningVNextExperimentalSession(scope, harness.ports);
  if (reloaded.status !== 'ready') throw new Error(`Post-save reload failed for ${testCase.id}.`);
  const result: ApprovalLifecycleObservation = {
    completedAfterFailure: failed.status === 'executed' && resumed.status === 'executed' && resumed.operation.status === 'completed',
    failedReceiptRecorded: failed.status === 'executed' && receipt.items.some((item) => item.status === 'failed'),
    repeatedApprovalNoop: repeated.status === 'executed' && repeated.operation.status === 'completed'
      && harness.saveCalls() === attemptsAfterResume,
    savedPlanCountMatchesPreview: harness.saved.size === preview.blocks.length,
    previewBlockCount: preview.blocks.length,
    savedPlanCount: harness.saved.size,
    saveAttempts: attemptsAfterResume,
    syntheticCloseoutTurn,
    reloadMatchesCheckpoint: JSON.stringify(reloaded.checkpoint) === JSON.stringify(lifecycleRead.checkpoint),
    legacyV5Unchanged: harness.slots.get('v5') === legacyBefore,
  };
  if (!result.completedAfterFailure || !result.failedReceiptRecorded || !result.repeatedApprovalNoop
    || !result.savedPlanCountMatchesPreview || !result.reloadMatchesCheckpoint || !result.legacyV5Unchanged) {
    throw new Error(`Approval lifecycle failed its save/reload/rollback oracle for ${testCase.id}/${arm}: ${JSON.stringify(result)}.`);
  }
  return result;
}

async function runSession(testCase: VNextJevComparisonCase, repetition: number, arm: 'luna_only' | 'jev_to_luna', remote: Awaited<ReturnType<typeof startVNextJevRemote>>,
  calibration: NonNullable<ReturnType<typeof calibrate>>, runApprovalLifecycle = false) {
  const scope = makeScope(testCase, repetition);
  const fullReading = createWeeklyPlanningVNextProviderInterpreter();
  const outcomes: Array<{ route: 'option_choice' | 'full_reading'; optionId?: string }> = [];
  const interpreter = arm === 'luna_only' ? fullReading : createWeeklyPlanningVNextOptionChoiceInterpreter({
    fullReading, choice: { policy: calibration.policy, choose: remote.jevChoose(calibration.semanticPolicy) },
    scope: { ownerId: scope.ownerId, conversationId: scope.conversationId }, onOutcome: (outcome) => outcomes.push(outcome),
  });
  const harness = makeHarness(testCase, repetition, remote.lunaClient, interpreter, runApprovalLifecycle ? 1 : undefined);
  const legacyBefore = `baseline-v5-checkpoint:${testCase.id}:${arm}`;
  const seed = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: harness.ports, turnId: 'seed', userText: 'synthetic seed', shownRevision: null });
  if (seed.outcome !== 'applied' || seed.graphRevision === null) throw new Error(`Session seed failed for ${testCase.id}/${repetition}.`);
  const seeded = readWeeklyPlanningVNextExperimentalSession(scope, harness.ports);
  if (seeded.status !== 'ready') throw new Error(`Seed checkpoint unreadable for ${testCase.id}/${repetition}.`);
  const question = activeQuestion(seeded.checkpoint.state);
  if (!question || question.code !== (testCase.menuShape === 'remaining_conflict' ? 'remaining_inconsistent' : 'same_or_distinct_work')) {
    throw new Error(`Unexpected presented question for ${testCase.id}/${repetition}.`);
  }
  const shown = presentWeeklyPlanningVNextQuestion(seeded.checkpoint.state, question);
  if (seed.reply !== shown.text) throw new Error(`Displayed question diverged for ${testCase.id}/${repetition}.`);
  const usageBefore = remote.usage();
  const turn = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: harness.ports, turnId: 'reply', userText: testCase.userText,
    shownRevision: seed.graphRevision });
  const usageAfter = remote.usage();
  const stateRead = readWeeklyPlanningVNextExperimentalSession(scope, harness.ports);
  if (stateRead.status !== 'ready') throw new Error(`Final checkpoint unreadable for ${testCase.id}/${repetition}.`);
  const result = compareFinalState(testCase, stateRead.checkpoint.state, harness.saved.size);
  const savedPlanCountAfterReply = harness.saved.size;
  const route = outcomes[0]?.route ?? (arm === 'luna_only' ? null : 'full_reading');
  const selectedOptionId = outcomes.find((outcome) => outcome.route === 'option_choice')?.optionId ?? null;
  const expectedSelectionCorrect = arm === 'luna_only' ? null : selectionMatches(testCase, selectedOptionId, seeded.checkpoint.state);
  let approvalLifecycle: ApprovalLifecycleObservation | null = null;
  if (runApprovalLifecycle) {
    harness.slots.set('v5', legacyBefore);
    approvalLifecycle = await executeApprovalLifecycle(scope, harness, testCase, turn.graphRevision, arm);
  }
  return {
    caseId: testCase.id, caseClass: testCase.expectedRoute, split: 'holdout' as const, repetition, arm, outcome: turn.outcome,
    route, selectedOptionId, expectedSelectionCorrect, finalStateCorrect: result.differences.length === 0,
    differences: result.differences, questionCode: result.questionCode, deferredQuestionCodes: result.deferredQuestionCodes,
    interpretationStatus: turn.interpretation?.status ?? null, interpretationCalls: turn.interpretation?.metrics.calls ?? 0,
    interpretationLatencyMs: turn.interpretation?.metrics.latencyMs ?? 0, appliedDelta: turn.appliedDelta,
    errors: turn.errors, previewBlockedBy: turn.previewBlockedBy, savedPlanCount: savedPlanCountAfterReply,
    usage: usageDifference(usageBefore, usageAfter), approvalLifecycle,
  } satisfies CaseObservation;
}

function usageDifference(before: { luna: ProviderUsage; jev: ProviderUsage }, after: { luna: ProviderUsage; jev: ProviderUsage }) {
  const one = (a: ProviderUsage, b: ProviderUsage): ProviderUsage => ({
    calls: b.calls - a.calls,
    inputTokens: a.inputTokens === null || b.inputTokens === null ? null : b.inputTokens - a.inputTokens,
    outputTokens: a.outputTokens === null || b.outputTokens === null ? null : b.outputTokens - a.outputTokens,
    costUsd: a.costUsd === null || b.costUsd === null ? null : b.costUsd - a.costUsd,
    latencyMs: b.latencyMs - a.latencyMs,
    servedModels: b.servedModels.filter((model) => !a.servedModels.includes(model)),
    httpStatuses: b.httpStatuses.slice(a.httpStatuses.length),
    lastCall: b.calls === a.calls ? null : b.lastCall,
  });
  return { luna: one(before.luna, after.luna), jev: one(before.jev, after.jev) };
}

function wilson(successes: number, total: number): string {
  if (!total) return 'n/a';
  const z = 1.96; const p = successes / total; const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return `${(p * 100).toFixed(1)}% [${((center - margin) * 100).toFixed(1)}%, ${((center + margin) * 100).toFixed(1)}%]`;
}

function writeReport(params: { calibration: ReturnType<typeof calibrate> | null; calibrationPath: string; samples: CalibrationSample[];
  observations: CaseObservation[]; holdoutStarted: boolean; devRawPath: string }) {
  const off = params.observations.filter((item) => item.arm === 'luna_only');
  const on = params.observations.filter((item) => item.arm === 'jev_to_luna');
  const caseClassRows = (['option_choice', 'full_reading'] as const).map((caseClass) => {
    const offRows = off.filter((item) => item.caseClass === caseClass);
    const onRows = on.filter((item) => item.caseClass === caseClass);
    return `| ${caseClass} | ${offRows.filter((item) => item.finalStateCorrect).length}/${offRows.length} | ${onRows.filter((item) => item.finalStateCorrect).length}/${onRows.length} |`;
  });
  const wrongSelections = on.filter((item) => item.route === 'option_choice' && item.expectedSelectionCorrect !== true).length;
  const aggregate = (items: CaseObservation[], provider: 'luna' | 'jev') => items.reduce((sum, item) => sum + item.usage[provider].calls, 0);
  const providerTotals = (items: CaseObservation[], provider: 'luna' | 'jev') => {
    const receipts = items.map((item) => item.usage[provider]);
    const total = (field: 'inputTokens' | 'outputTokens' | 'costUsd') => receipts.some((item) => item[field] === null)
      ? null : receipts.reduce((sum, item) => sum + (item[field] ?? 0), 0);
    return { calls: aggregate(items, provider), inputTokens: total('inputTokens'), outputTokens: total('outputTokens'),
      costUsd: total('costUsd'), latencyMs: receipts.reduce((sum, item) => sum + item.latencyMs, 0) };
  };
  const offLuna = providerTotals(off, 'luna'); const onLuna = providerTotals(on, 'luna'); const onJev = providerTotals(on, 'jev');
  const averageLatency = (items: CaseObservation[]) => items.length ? items.reduce((sum, item) => sum + item.interpretationLatencyMs, 0) / items.length : 0;
  const adoption = params.holdoutStarted && wrongSelections === 0
    && on.filter((item) => item.finalStateCorrect).length >= off.filter((item) => item.finalStateCorrect).length
    && (aggregate(on, 'luna') + aggregate(on, 'jev') < aggregate(off, 'luna')
      || averageLatency(on) < averageLatency(off));
  const callsOff = aggregate(off, 'luna');
  const callsOn = aggregate(on, 'luna') + aggregate(on, 'jev');
  const callIncreasePercent = callsOff > 0 ? Math.round((callsOn - callsOff) / callsOff * 100) : 0;
  const recommendation = !params.holdoutStarted
    ? 'Holdout not run; remain off'
    : adoption
      ? `pre-registered minimum criterion met; remain off: limited benefit, +${callIncreasePercent}% calls, latency gain comparable to run-to-run variation`
      : 'pre-registered minimum criterion not met; remain off';
  const lines = [
    '# VNext Luna-only vs Jev→Luna comparison', '',
    `- Corpus: ${VNEXT_JEV_COMPARISON_CASES.length} cases; split SHA-256: \`${VNEXT_JEV_COMPARISON_SPLIT_SHA256}\`.`,
    `- Dev raw artifact: \`${params.devRawPath}\`.`,
    `- Holdout run: ${params.holdoutStarted ? 'completed' : 'not run (awaiting explicit policy approval or zero-wrong dev calibration)'}.`,
    `- Calibration artifact: \`${params.calibrationPath}\`.`,
    `- Pre-registered minimum criterion: ${adoption ? 'met' : 'not met'}.`,
    `- Recommendation: ${recommendation}.`,
    `- Jev wrong selections: ${wrongSelections}.`,
    '', '## Dev calibration', '',
    params.calibration ? `- Correct closed choices: ${params.calibration.devCorrectSelections}; wrong selections: ${params.calibration.devWrongSelections}.`
      : '- No policy met the zero-wrong-selection constraint.',
    `- Calibration calls: ${params.samples.length} Jev evaluations (three repetitions per dev case).`,
    `- Calibration usage: ${params.samples.reduce((sum, item) => sum + item.usage.inputTokens, 0)} input + ${params.samples.reduce((sum, item) => sum + item.usage.outputTokens, 0)} output tokens; $${params.samples.some((item) => item.usage.costUsd === null) ? 'not fully reported' : params.samples.reduce((sum, item) => sum + (item.usage.costUsd ?? 0), 0).toFixed(8)}; ${params.samples.reduce((sum, item) => sum + item.usage.latencyMs, 0)} ms total Jev latency.`,
    '', '## Holdout result', '',
    '| Measure | Luna-only | Jev→Luna |', '| --- | ---: | ---: |',
    `| Final-state correct | ${off.filter((item) => item.finalStateCorrect).length}/${off.length} (${wilson(off.filter((item) => item.finalStateCorrect).length, off.length)}) | ${on.filter((item) => item.finalStateCorrect).length}/${on.length} (${wilson(on.filter((item) => item.finalStateCorrect).length, on.length)}) |`,
    '', '| Case class | Luna-only correct | Jev→Luna correct |', '| --- | ---: | ---: |', ...caseClassRows,
    '',
    `| Provider calls | ${aggregate(off, 'luna')} Luna | ${aggregate(on, 'luna')} Luna + ${aggregate(on, 'jev')} Jev |`,
    `| Mean interpreter latency | ${averageLatency(off).toFixed(0)} ms | ${averageLatency(on).toFixed(0)} ms |`,
    `| Provider latency | ${offLuna.latencyMs} ms Luna | ${onLuna.latencyMs} ms Luna + ${onJev.latencyMs} ms Jev |`,
    `| Provider tokens / cost | Luna ${offLuna.calls} calls, ${offLuna.inputTokens ?? 'unknown'}+${offLuna.outputTokens ?? 'unknown'} tokens, $${offLuna.costUsd ?? 'not reported'} | Luna ${onLuna.calls} calls, ${onLuna.inputTokens ?? 'unknown'}+${onLuna.outputTokens ?? 'unknown'} tokens, $${onLuna.costUsd ?? 'not reported'}; Jev ${onJev.calls} calls, ${onJev.inputTokens ?? 'unknown'}+${onJev.outputTokens ?? 'unknown'} tokens, $${onJev.costUsd ?? 'not reported'} |`,
    `| Approval lifecycle checks | ${off.filter((item) => item.approvalLifecycle).length} cases | ${on.filter((item) => item.approvalLifecycle).length} cases; all failed-receipt/resume/duplicate/reload/legacy-checkpoint assertions passed |`,
    '', '## Per-case observations', '',
    '| Case | Arm | Rep | Route | Choice correct | Final state | Calls Luna/Jev | Tokens Luna/Jev (in+out) | Latency | Approval lifecycle | Differences |',
    '| --- | --- | ---: | --- | --- | --- | ---: | --- | ---: | --- | --- |',
    ...params.observations.map((item) => `| ${item.caseId} | ${item.arm} | ${item.repetition} | ${item.route ?? 'Luna'} | ${item.expectedSelectionCorrect ?? '—'} | ${item.finalStateCorrect ? 'pass' : 'fail'} | ${item.usage.luna.calls}/${item.usage.jev.calls} | ${item.usage.luna.inputTokens ?? '?'}+${item.usage.luna.outputTokens ?? '?'} / ${item.usage.jev.inputTokens ?? '?'}+${item.usage.jev.outputTokens ?? '?'} | ${item.interpretationLatencyMs} ms | ${item.approvalLifecycle ? `closeout=${item.approvalLifecycle.syntheticCloseoutTurn}; complete=${item.approvalLifecycle.completedAfterFailure}; failedReceipt=${item.approvalLifecycle.failedReceiptRecorded}; duplicate=${item.approvalLifecycle.repeatedApprovalNoop}; saved=${item.approvalLifecycle.savedPlanCount}/${item.approvalLifecycle.previewBlockCount}; attempts=${item.approvalLifecycle.saveAttempts}; reload=${item.approvalLifecycle.reloadMatchesCheckpoint}; rollback=${item.approvalLifecycle.legacyV5Unchanged}` : '—'} | ${item.differences.join('; ') || '—'} |`),
    '', 'Raw provider request/response bodies are not included in this report.',
  ];
  writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
  writeFileSync(rawObservationsPath, `${JSON.stringify({ schemaVersion: 'vnext-jev-holdout-observations-v1',
    splitHash: VNEXT_JEV_COMPARISON_SPLIT_SHA256, calibrationPath: params.calibrationPath,
    observations: params.observations }, null, 2)}\n`, 'utf8');
}

describe.skipIf(!live)('VNext Jev → Luna paired live comparison (explicit local opt-in)', () => {
  it('calibrates only on dev, freezes the artifact, then compares the untouched holdout in both arms', async () => {
    const calibrationSamples: CalibrationSample[] = [];
    const observations: CaseObservation[] = [];
    let calibrationResult: ReturnType<typeof calibrate> | null = null;
    let calibrationPath = resolve(artifactDirectory, 'calibration-not-produced.json');
    let holdoutStarted = false;
    let remote: Awaited<ReturnType<typeof startVNextJevRemote>> | null = null;
    try {
      if (!devRawArtifactPath) throw new Error('Set VNEXT_JEV_DEV_RAW_ARTIFACT to the frozen dev-only raw artifact.');
      calibrationSamples.push(...await calibrateFromRawArtifact(devRawArtifactPath));
      calibrationResult = calibrate(calibrationSamples);
      mkdirSync(artifactDirectory, { recursive: true });
      if (calibrationResult) {
        calibrationPath = resolve(artifactDirectory, `calibration-${calibrationResult.calibrationEvidenceId}.json`);
        writeFileSync(calibrationPath, `${JSON.stringify(calibrationResult.artifact, null, 2)}\n`, 'utf8');
      }
      if (!calibrationResult || calibrationResult.devWrongSelections !== 0) {
        writeReport({ calibration: calibrationResult, calibrationPath, samples: calibrationSamples,
          observations, holdoutStarted: false, devRawPath: devRawArtifactPath });
        throw new Error('Dev did not produce a zero-wrong-selection calibration; holdout was not run.');
      }

      if (approvedCalibrationEvidenceId !== calibrationResult.calibrationEvidenceId) {
        writeReport({ calibration: calibrationResult, calibrationPath, samples: calibrationSamples,
          observations, holdoutStarted: false, devRawPath: devRawArtifactPath });
        return;
      }

      remote = await startVNextJevRemote({ worker: 'studyplanner-ai-proxy', ttlMs: 1_800_000 });
      holdoutStarted = true;
      const holdout = VNEXT_JEV_COMPARISON_CASES.filter((item) => item.split === 'holdout');
      const approvalLifecycleCaseIds = new Set(shapes.map((shape) => {
        const match = holdout.find((item) => item.menuShape === shape && item.expectedRoute === 'option_choice');
        if (!match) throw new Error(`No holdout option-choice case for ${shape}.`);
        return match.id;
      }));
      for (let index = 0; index < holdout.length; index++) for (let repetition = 1; repetition <= repeatCount; repetition++) {
        const testCase = holdout[index];
        const arms: Array<'luna_only' | 'jev_to_luna'> = (index + repetition) % 2 === 0
          ? ['luna_only', 'jev_to_luna'] : ['jev_to_luna', 'luna_only'];
        for (const arm of arms) observations.push(await runSession(testCase, repetition, arm, remote, calibrationResult,
          repetition === 1 && approvalLifecycleCaseIds.has(testCase.id)));
      }
      writeReport({ calibration: calibrationResult, calibrationPath, samples: calibrationSamples,
        observations, holdoutStarted, devRawPath: devRawArtifactPath });
      const offCorrect = observations.filter((item) => item.arm === 'luna_only' && item.finalStateCorrect).length;
      const onCorrect = observations.filter((item) => item.arm === 'jev_to_luna' && item.finalStateCorrect).length;
      const onWrong = observations.filter((item) => item.arm === 'jev_to_luna' && item.route === 'option_choice'
        && item.expectedSelectionCorrect !== true).length;
      expect(onWrong, 'Holdout Jev selections must never choose a wrong or unoffered value').toBe(0);
      expect(onCorrect, 'Jev→Luna final-state correctness must not be lower than Luna-only').toBeGreaterThanOrEqual(offCorrect);
      expect(observations).toHaveLength(holdout.length * repeatCount * 2);
    } finally {
      if (!holdoutStarted || observations.length) writeReport({ calibration: calibrationResult, calibrationPath,
        samples: calibrationSamples, observations, holdoutStarted, devRawPath: devRawArtifactPath ?? 'missing' });
      if (remote) await remote.stop();
    }
  }, 600_000);
});

describe('VNext Jev comparison session controls (offline)', () => {
  const controlCase = VNEXT_JEV_COMPARISON_CASES.find((item) => item.id === 'dev-remaining-progress')!;
  const controlPolicy: CalibratedChoicePolicy = { id: 'offline-control-only', calibrationEvidenceId: 'synthetic-control',
    rules: [{ menuKind: 'leaves', optionCount: 3, depth: 0, minimumTopProbability: 0.8, minimumMargin: 0.5 }] };
  const interpreted = (delta = emptyDelta()) => ({ status: 'interpreted' as const, delta, answer: null,
    metrics: { calls: 0, repairs: 0, latencyMs: 0 } });

  it('does not dispatch Jev when a reply names an older shown revision', async () => {
    const inputs: Array<Parameters<WeeklyPlanningVNextInterpreter>[0]> = [];
    const fullReading: WeeklyPlanningVNextInterpreter = async (input) => { inputs.push(input); return interpreted(); };
    let chooseCalls = 0;
    const scope = makeScope(controlCase, 1);
    const interpreter = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading, scope: {
      ownerId: scope.ownerId, conversationId: scope.conversationId,
    }, choice: { policy: controlPolicy, choose: async () => { chooseCalls++; return {}; } } });
    const harness = makeHarness(controlCase, 1, {} as Parameters<WeeklyPlanningVNextInterpreter>[0]['client'], interpreter);
    const shown = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: harness.ports,
      turnId: 'seed', userText: 'synthetic seed', shownRevision: null });
    const reply = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: harness.ports,
      turnId: 'stale-reply', userText: controlCase.userText, shownRevision: shown.graphRevision! - 1 });
    expect(reply.outcome).toBe('noop');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].presentedQuestion).toBeNull();
    expect(chooseCalls).toBe(0);
  });

  it('requires deadline kind when comparing a hard temporal constraint', () => {
    const testCase = VNEXT_JEV_COMPARISON_CASES.find((item) => item.id === 'h-mixed-deadline')!;
    const scope = makeScope(testCase, 1);
    const seeded = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), taskSeedDelta(testCase), {
      expectedRevision: 0, acceptedDate: testCase.seed.acceptedDate, weekStartsOn: scope.clock.weekStartsOn,
      defaultPlanningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate },
      planningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate },
      turnKey: `${scope.conversationId}:seed`,
      conversationId: scope.conversationId, turnId: 'seed', sourceText: 'synthetic seed',
    });
    if (seeded.status !== 'applied') throw new Error('Deadline oracle seed failed.');
    const remaining = seeded.state.graph.workloads.find((fact) => fact.quantityRole === 'remaining');
    const taskId = seeded.state.graph.tasks.find((task) => task.title === '数学プリント')?.id;
    if (!remaining || !taskId) throw new Error('Deadline oracle seed facts are missing.');

    const stateWithTemporalKind = (constraintKind: 'deadline' | 'earliest_start') => {
      const delta: VNextTurnDelta = { ...emptyDelta(),
        add: [{ kind: 'temporal_constraint', localId: 'tomorrow-constraint', taskRef: { factId: taskId },
          targetRef: { factId: taskId }, constraintKind, constraintLevel: 'hard', dateExpression: '2026-11-03',
          namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact' }],
        patch: [{ kind: 'workload', localId: 'remaining-eight', targetFactId: remaining.id, amountDelta: null,
          changes: { amount: 8, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null,
            perOccurrence: null, periodExpression: null } }],
      };
      const result = applyWeeklyPlanningVNextTurn(seeded.state, delta, {
        expectedRevision: seeded.state.graph.revision, acceptedDate: testCase.seed.acceptedDate,
        weekStartsOn: scope.clock.weekStartsOn,
        defaultPlanningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate },
        planningHorizon: { startDate: scope.clock.planningStartDate, endDate: scope.clock.planningEndDate },
        turnKey: `${scope.conversationId}:${constraintKind}`, conversationId: scope.conversationId,
        turnId: constraintKind, sourceText: 'synthetic deadline meaning',
      });
      if (result.status !== 'applied') throw new Error(`Temporal control rejected: ${constraintKind}`);
      return result.state;
    };

    expect(testCase.finalState.hardDeadlines).toEqual([{ taskTitle: '数学プリント', date: '2026-11-03', constraintKind: 'deadline' }]);
    expect(compareFinalState(testCase, stateWithTemporalKind('deadline'), 0).differences).toEqual([]);
    expect(compareFinalState(testCase, stateWithTemporalKind('earliest_start'), 0).differences).toContain('hard deadlines differ');
  });

  it('does not overwrite a checkpoint changed while Jev is evaluating the reply', async () => {
    let markDispatched!: () => void;
    let releaseChoice!: (value: unknown) => void;
    const dispatched = new Promise<void>((resolveDispatched) => { markDispatched = resolveDispatched; });
    const delayed = new Promise<unknown>((resolveChoice) => { releaseChoice = resolveChoice; });
    const choiceRequest: { current: CandidateChoiceRequest | null } = { current: null };
    const scope = makeScope(controlCase, 2);
    const fullReading: WeeklyPlanningVNextInterpreter = async () => interpreted();
    const interpreter = createWeeklyPlanningVNextOptionChoiceInterpreter({ fullReading, scope: {
      ownerId: scope.ownerId, conversationId: scope.conversationId,
    }, choice: { policy: controlPolicy, choose: async (request, beforeDispatch) => {
      choiceRequest.current = request;
      beforeDispatch(); markDispatched(); return delayed;
    } } });
    const harness = makeHarness(controlCase, 2, {} as Parameters<WeeklyPlanningVNextInterpreter>[0]['client'], interpreter);
    const shown = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: harness.ports,
      turnId: 'seed', userText: 'synthetic seed', shownRevision: null });
    const pending = submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: harness.ports,
      turnId: 'jev-reply', userText: controlCase.userText, shownRevision: shown.graphRevision });
    await dispatched;

    harness.ports.interpret = async (input) => {
      const completed = input.state.graph.workloads.find((fact) => fact.quantityRole === 'completed');
      if (!completed) throw new Error('Synthetic completed workload missing.');
      return interpreted({ ...emptyDelta(), patch: [{ kind: 'workload', localId: 'concurrent-progress-correction',
        targetFactId: completed.id, amountDelta: null,
        changes: { amount: 13, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null,
          perOccurrence: null, periodExpression: null } }] });
    };
    const concurrent = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: harness.ports,
      turnId: 'other-tab', userText: '別のタブで完了量を訂正', shownRevision: shown.graphRevision });
    expect(concurrent.outcome).toBe('applied');
    const current = readWeeklyPlanningVNextExperimentalSession(scope, harness.ports);
    if (current.status !== 'ready') throw new Error('Concurrent checkpoint unreadable.');
    const changedRaw = harness.slots.get('vnext');
    if (!choiceRequest.current) throw new Error('Jev request was not captured.');
    const request = choiceRequest.current;
    const selected = request.menu.options.find((option) => option.kind === 'leaf'
      && option.candidate.tuple.optionId === 'remaining_follows_progress');
    if (!selected) throw new Error('Expected seeded choice option missing.');
    releaseChoice({ nodeId: request.menu.nodeId, requestId: request.requestId, selectionEpoch: request.selectionEpoch,
      candidateSetHash: request.candidateSetHash, semanticSufficiency: 'only_candidate_meaning', optionId: selected.id,
      probabilities: request.menu.options.map((option) => ({ optionId: option.id,
        probability: option.id === selected.id ? 0.8 : 0.1 })) });
    const stale = await pending;
    expect(stale.outcome).toBe('stale');
    expect(stale.appliedDelta).toBeNull();
    expect(harness.slots.get('vnext')).toBe(changedRaw);
    const after = readWeeklyPlanningVNextExperimentalSession(scope, harness.ports);
    if (after.status !== 'ready') throw new Error('Final checkpoint unreadable.');
    expect(observedWork(after.checkpoint.state).find((fact) => fact.quantityRole === 'completed')?.amount).toBe(13);
  });

  it('exercises preview approval resume, duplicate protection, reload, and V5 rollback baseline for each dev menu shape and arm', async () => {
    for (const shape of shapes) {
      const testCase = VNEXT_JEV_COMPARISON_DEV_CASES.find((item) => item.menuShape === shape && item.expectedRoute === 'option_choice')!;
      for (const arm of ['luna_only', 'jev_to_luna'] as const) {
        const scope = { ...makeScope(testCase, 1), conversationId: `approval-control:${shape}:${arm}` };
        const controlled: WeeklyPlanningVNextInterpreter = async (input) => {
          const question = activeQuestion(input.state);
          if (!question) return interpreted();
          const option = question.options.find((candidate) => selectionMatches(testCase, candidate.optionId, input.state) === true);
          if (!option) throw new Error(`No offline oracle answer available for ${testCase.id}/${question.code}.`);
          return interpreted(option.delta);
        };
        const harness = makeHarness(testCase, 1, {} as Parameters<WeeklyPlanningVNextInterpreter>[0]['client'], controlled, 1);
        const legacyBefore = `offline-v5-baseline:${shape}:${arm}`;
        const seed = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: harness.ports,
          turnId: 'seed', userText: 'synthetic seed', shownRevision: null });
        if (seed.outcome !== 'applied' || seed.graphRevision === null) throw new Error(`Approval-control seed failed for ${shape}/${arm}.`);
        const reply = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: harness.ports,
          turnId: 'reply', userText: testCase.userText, shownRevision: seed.graphRevision });
        if (reply.outcome !== 'applied') throw new Error(`Approval-control answer failed for ${shape}/${arm}.`);
        harness.slots.set('v5', legacyBefore);
        const lifecycle = await executeApprovalLifecycle(scope, harness, testCase, reply.graphRevision, arm);
        expect(lifecycle).toMatchObject({ completedAfterFailure: true, failedReceiptRecorded: true,
          repeatedApprovalNoop: true, savedPlanCountMatchesPreview: true, reloadMatchesCheckpoint: true,
          legacyV5Unchanged: true });
        expect(harness.slots.get('v5')).toBe(legacyBefore);
      }
    }
  });
});

describe('VNext Jev holdout oracle rescore (offline)', () => {
  it.skipIf(!offlineRescoreObservationsPath)('replays the saved applied deltas through the current projector and scores corrected frozen-text oracles', () => {
    const artifact = JSON.parse(readFileSync(offlineRescoreObservationsPath!, 'utf8')) as {
      schemaVersion: string; splitHash: string; observations: CaseObservation[];
    };
    expect(artifact.schemaVersion).toBe('vnext-jev-holdout-observations-v1');
    expect(artifact.splitHash).toBe(VNEXT_JEV_COMPARISON_SPLIT_SHA256);
    expect(artifact.observations).toHaveLength(16 * repeatCount * 2);

    const holdoutCases = new Map(VNEXT_JEV_COMPARISON_CASES.filter((item) => item.split === 'holdout').map((item) => [item.id, item]));
    const rescored = artifact.observations.map((observation) => {
      const testCase = holdoutCases.get(observation.caseId);
      if (!testCase) throw new Error(`Observation is not in the frozen holdout: ${observation.caseId}`);
      const state = reconstructObservedState(testCase, observation);
      const result = compareFinalState(testCase, state, observation.savedPlanCount);
      return { ...observation, inputArtifactFinalStateCorrect: observation.finalStateCorrect,
        inputArtifactDifferences: observation.differences, finalStateCorrect: result.differences.length === 0,
        differences: result.differences, questionCode: result.questionCode,
        deferredQuestionCodes: result.deferredQuestionCodes };
    });
    const rows = (arm: CaseObservation['arm'], caseClass: CaseObservation['caseClass']) => {
      const prior = rescored.filter((item) => item.arm === arm && item.caseClass === caseClass);
      return { total: prior.length, before: prior.filter((item) => item.inputArtifactFinalStateCorrect).length,
        after: prior.filter((item) => item.finalStateCorrect).length };
    };
    const totals = Object.fromEntries((['luna_only', 'jev_to_luna'] as const).map((arm) => {
      const items = rescored.filter((item) => item.arm === arm);
      return [arm, { total: items.length, before: items.filter((item) => item.inputArtifactFinalStateCorrect).length,
        after: items.filter((item) => item.finalStateCorrect).length }];
    })) as Record<CaseObservation['arm'], { total: number; before: number; after: number }>;
    const off = rescored.filter((item) => item.arm === 'luna_only');
    const on = rescored.filter((item) => item.arm === 'jev_to_luna');
    const aggregateCalls = (items: typeof rescored, provider: 'luna' | 'jev') =>
      items.reduce((sum, item) => sum + item.usage[provider].calls, 0);
    const averageLatency = (items: typeof rescored) => items.length
      ? items.reduce((sum, item) => sum + item.interpretationLatencyMs, 0) / items.length : 0;
    const wrongSelections = on.filter((item) => item.route === 'option_choice' && item.expectedSelectionCorrect !== true).length;
    const preRegisteredMinimumCriterionMet = rescored.length === 96 && wrongSelections === 0
      && on.filter((item) => item.finalStateCorrect).length >= off.filter((item) => item.finalStateCorrect).length
      && (aggregateCalls(on, 'luna') + aggregateCalls(on, 'jev') < aggregateCalls(off, 'luna')
        || averageLatency(on) < averageLatency(off));
    const callsOff = aggregateCalls(off, 'luna');
    const callsOn = aggregateCalls(on, 'luna') + aggregateCalls(on, 'jev');
    const callIncreasePercent = callsOff ? Math.round((callsOn - callsOff) / callsOff * 100) : 0;
    const meanInterpreterLatencyMs = { luna_only: averageLatency(off), jev_to_luna: averageLatency(on) };
    const recommendation = preRegisteredMinimumCriterionMet
      ? `pre-registered minimum criterion met; remain off: limited benefit, +${callIncreasePercent}% calls, latency gain comparable to run-to-run variation`
      : 'pre-registered minimum criterion not met; remain off';
    const providerTotals = (items: typeof rescored, provider: 'luna' | 'jev') => {
      const receipts = items.map((item) => item.usage[provider]);
      const total = (field: 'inputTokens' | 'outputTokens' | 'costUsd') => receipts.some((item) => item[field] === null)
        ? null : receipts.reduce((sum, item) => sum + (item[field] ?? 0), 0);
      return { calls: aggregateCalls(items, provider), latencyMs: receipts.reduce((sum, item) => sum + item.latencyMs, 0),
        inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), costUsd: total('costUsd') };
    };
    const usage = Object.fromEntries((['luna_only', 'jev_to_luna'] as const).map((arm) => {
      const items = arm === 'luna_only' ? off : on;
      const luna = providerTotals(items, 'luna'); const jev = providerTotals(items, 'jev');
      return [arm, { luna, jev, totalCalls: luna.calls + jev.calls, totalLatencyMs: luna.latencyMs + jev.latencyMs,
        totalCostUsd: luna.costUsd === null || jev.costUsd === null ? null : luna.costUsd + jev.costUsd }];
    })) as Record<CaseObservation['arm'], { luna: ReturnType<typeof providerTotals>; jev: ReturnType<typeof providerTotals>;
      totalCalls: number; totalLatencyMs: number; totalCostUsd: number | null }>;
    const lifecycle = Object.fromEntries((['luna_only', 'jev_to_luna'] as const).map((arm) => {
      const rows = rescored.filter((item) => item.arm === arm && item.approvalLifecycle).map((item) => item.approvalLifecycle!);
      const checks = ['completedAfterFailure', 'failedReceiptRecorded', 'repeatedApprovalNoop',
        'savedPlanCountMatchesPreview', 'reloadMatchesCheckpoint', 'legacyV5Unchanged'] as const;
      return [arm, { cases: rows.length, checks: Object.fromEntries(checks.map((key) =>
        [key, `${rows.filter((row) => row[key]).length}/${rows.length}`])),
      saveAttempts: rows.reduce((sum, row) => sum + row.saveAttempts, 0),
      savedBlocks: rows.reduce((sum, row) => sum + row.savedPlanCount, 0) }];
    }));
    const summary = {
      schemaVersion: 'vnext-jev-holdout-oracle-rescore-v1',
      source: offlineRescoreObservationsPath,
      splitHash: artifact.splitHash,
      observationCount: rescored.length,
      counts: Object.fromEntries((['luna_only', 'jev_to_luna'] as const).flatMap((arm) =>
        (['option_choice', 'full_reading'] as const).map((caseClass) => [`${arm}/${caseClass}`, rows(arm, caseClass)]))),
      totals,
      jevWrongSelections: wrongSelections,
      preRegisteredMinimumCriterionMet,
      recommendation,
      meanInterpreterLatencyMs,
      deadlineKindControl: { expectedConstraintKind: 'deadline', positiveControl: 'hard deadline on 2026-11-03 passes',
        negativeControl: 'hard earliest_start on 2026-11-03 fails' },
      usage,
      lifecycle,
      remainingFailures: rescored.filter((item) => !item.finalStateCorrect).map((item) => ({ caseId: item.caseId,
        arm: item.arm, repetition: item.repetition, differences: item.differences })),
      observations: rescored,
    };
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(resolve(artifactDirectory, 'corrected-interpretation.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    const reasonRows = VNEXT_JEV_COMPARISON_CASES.filter((item) => item.oracleCorrectionReason)
      .map((item) => `| ${item.id} (${item.split}) | ${item.oracleCorrectionReason} |`);
    const scoreRows = (['luna_only', 'jev_to_luna'] as const).flatMap((arm) =>
      (['option_choice', 'full_reading'] as const).map((caseClass) => {
        const value = rows(arm, caseClass);
        return `| ${arm} | ${caseClass} | ${value.before}/${value.total} | ${value.after}/${value.total} |`;
      }).concat((() => {
        const value = summary.totals[arm];
        return [`| ${arm} | all cases | ${value.before}/${value.total} | ${value.after}/${value.total} |`];
      })()));
    const usageRows = (['luna_only', 'jev_to_luna'] as const).map((arm) => {
      const value = summary.usage[arm];
      return `| ${arm} | ${value.luna.calls} / ${value.jev.calls} | ${value.luna.latencyMs} / ${value.jev.latencyMs} / ${value.totalLatencyMs} ms | $${value.luna.costUsd ?? 'unreported'} / $${value.jev.costUsd ?? 'unreported'} |`;
    });
    const lifecycleRows = (['luna_only', 'jev_to_luna'] as const).map((arm) => {
      const value = summary.lifecycle[arm];
      return `| ${arm} | ${value.cases} cases; ${Object.values(value.checks).join(', ')} | ${value.saveAttempts} | ${value.savedBlocks} |`;
    });
    const markdown = [
      '# Corrected interpretation (offline rescore)', '',
      `Source observations: \`${offlineRescoreObservationsPath}\` (${rescored.length} saved outcomes; no provider calls).`,
      `Frozen split SHA-256: \`${artifact.splitHash}\`.`, '',
      `- Pre-registered minimum criterion: ${preRegisteredMinimumCriterionMet ? 'met' : 'not met'} (zero wrong Jev choices; correctness no lower than Luna-only; fewer calls or lower mean interpreter latency).`,
      `- Recommendation: ${recommendation}.`,
      `- Jev wrong selections: ${wrongSelections}.`, '',
      `- Mean interpreter latency: Luna-only ${meanInterpreterLatencyMs.luna_only.toFixed(0)} ms; Jev→Luna ${meanInterpreterLatencyMs.jev_to_luna.toFixed(0)} ms.`,
      'Hard temporal matching requires `constraintKind: deadline`; the offline positive control passes a hard deadline on 2026-11-03, while the negative control rejects hard `earliest_start` on the same date.', '',
      '| Arm | Case class | Score in input artifact | Recomputed corrected-oracle score |', '| --- | --- | ---: | ---: |', ...scoreRows,
      '', '| Arm | Calls (Luna / Jev) | Provider latency (Luna / Jev / total) | Reported cost (Luna / Jev) |',
      '| --- | ---: | --- | --- |', ...usageRows,
      '', '| Arm | Save/reload/rollback checks | Save attempts | Saved blocks |', '| --- | --- | ---: | ---: |', ...lifecycleRows,
      '', '## Corrected oracle meanings', '', '| Case | Reason |', '| --- | --- |', ...reasonRows,
      '', '## Remaining failures', '',
      ...(summary.remainingFailures.length ? summary.remainingFailures.map((item) =>
        `- ${item.caseId} / ${item.arm} r${item.repetition}: ${item.differences.join('; ')}`) : ['- None.']),
      '', 'The original saved observations and first-run report remain unchanged. Corrected scores replay each recorded applied delta through the current TypeScript transaction and projector; no provider was called.',
    ].join('\n') + '\n';
    writeFileSync(resolve(artifactDirectory, 'corrected-interpretation.md'), markdown, 'utf8');
    expect(rescored).toHaveLength(96);
    expect(preRegisteredMinimumCriterionMet).toBe(true);
    if (callsOn >= callsOff) expect(meanInterpreterLatencyMs.jev_to_luna).toBeLessThan(meanInterpreterLatencyMs.luna_only);
    expect(markdown).toContain('- Pre-registered minimum criterion: met');
    expect(markdown).toContain(`- Recommendation: ${recommendation}.`);
    expect(markdown).toContain('rejects hard `earliest_start` on the same date');
  });
});

describe('VNext Jev raw-dev artifact contract (offline)', () => {
  it.skipIf(!devRawArtifactPath)('validates the delivered artifact, rebuilds all 48 requests, and writes the frozen dev-only calibration', async () => {
    const samples = await calibrateFromRawArtifact(devRawArtifactPath!);
    const calibration = calibrate(samples);
    expect(calibration, 'Frozen dev data must yield a zero-wrong-selection policy').not.toBeNull();
    if (!calibration || calibration.devWrongSelections !== 0) throw new Error('Dev calibration did not meet the zero-wrong-selection rule.');
    mkdirSync(artifactDirectory, { recursive: true });
    const path = resolve(artifactDirectory, `calibration-${calibration.calibrationEvidenceId}.json`);
    writeFileSync(path, `${JSON.stringify(calibration.artifact, null, 2)}\n`, 'utf8');
    expect(samples).toHaveLength(VNEXT_JEV_COMPARISON_DEV_CASES.length * repeatCount);
  });

  it('rebuilds every frozen dev request hash and validates the complete 3x receipt set without a provider', async () => {
    const calls: DevRawCall[] = [];
    for (const testCase of VNEXT_JEV_COMPARISON_DEV_CASES) for (let repetition = 1; repetition <= repeatCount; repetition++) {
      const { request, expectedChoice } = await captureCandidateRequest(testCase, repetition, true);
      const expectedWireOptionId = expectedChoice === null ? 'none' : request.menu.options.find((option) =>
        option.kind === 'leaf' && option.candidate.tuple.optionId === expectedChoice)?.id;
      if (!expectedWireOptionId) throw new Error(`No offered oracle option for ${testCase.id}.`);
      calls.push({ caseId: testCase.id, repetition, menuShape: testCase.menuShape,
        menu: { kind: request.menu.kind, depth: request.menu.depth, optionCount: request.menu.options.length },
        expectedChoice: expectedChoice ?? 'none', expectedWireOptionId,
        requestSha256: createHash('sha256').update(JSON.stringify(request), 'utf8').digest('hex'),
        status: 'unavailable', optionId: null, choice: null, probabilities: [],
        conditionChange: null, independentMeaning: null,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: null, latencyMs: 0, servedModel: 'offline', httpStatus: 0 } });
    }
    const directory = mkdtempSync(resolve(tmpdir(), 'vnext-jev-raw-contract-'));
    const path = resolve(directory, 'raw.json');
    try {
      writeFileSync(path, JSON.stringify({ schemaVersion: 'vnext-jev-dev-raw-v1', split: 'dev',
        splitHash: VNEXT_JEV_COMPARISON_SPLIT_SHA256, devCasesHash: VNEXT_JEV_COMPARISON_DEV_CASES_SHA256,
        codeHead: '9873f0428497bbe38f7afe29f1bb1f94e20770c7', repetitions: repeatCount, caseCount: VNEXT_JEV_COMPARISON_DEV_CASES.length,
        completed: true, calls }), 'utf8');
      expect(readDevRawArtifact(path, null).calls).toHaveLength(VNEXT_JEV_COMPARISON_DEV_CASES.length * repeatCount);
      const samples = await calibrateFromRawArtifact(path, null);
      expect(samples).toHaveLength(calls.length);
      expect(samples.every((sample) => sample.selectedChoice === null)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
