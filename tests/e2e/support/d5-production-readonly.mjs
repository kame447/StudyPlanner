import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { boundedSmokeError, redactedSmokeStep, redactedWriteObservation, redactedComposerReadiness } from './d5-production-smoke-observation.mjs';
import { CONTROLLED_CANDIDATE_COMMIT_REJECTIONS } from '../../../shared/controlledCandidateCommit.ts';

const rejectionFromCode = code => CONTROLLED_CANDIDATE_COMMIT_REJECTIONS.find(reason => code === `candidate_commit_${reason}`) ?? null;
const traceOutcomes = ['discarded_commit_rejected', 'discarded_stale', 'failed', 'revision_pending', 'needs_scope', 'draft_ready', 'idle',
  'stable_v5_normalization_rejected', 'stable_v5_provider_failure', 'stable_v5_canonicalization_rejected'];
const traceErrors = ['commit_rejected', 'stale_async_result_discarded', 'stable_v5_required_effort_ack_failed',
  ...CONTROLLED_CANDIDATE_COMMIT_REJECTIONS.map(reason => `candidate_commit_${reason}`)];
const redactedAnswerTrace = row => ({
  outcome: traceOutcomes.includes(row?.outcome) ? row.outcome : null,
  errorCode: traceErrors.includes(row?.errorCode) ? row.errorCode : null,
  rejectionReason: CONTROLLED_CANDIDATE_COMMIT_REJECTIONS.includes(row?.rejectionReason) ? row.rejectionReason : null,
  fallback: ['luna_scheduled', 'none'].includes(row?.fallback) ? row.fallback : null,
});

/** Match only this synthetic answer's observed request identities. Never export a trace body or identifier. */
export function observeOwnAnswerTrace(body, requestIds) {
  if (!Array.isArray(body?.entries) || !(requestIds instanceof Set)) return [];
  return body.entries.filter(entry => entry?.kind === 'turn_diagnostic' && typeof entry.requestId === 'string' && requestIds.has(entry.requestId))
    .map(entry => {
      const [branch, fallback] = typeof entry.decision?.reason === 'string' ? entry.decision.reason.split(':') : [];
      const reason = rejectionFromCode(branch);
      return redactedAnswerTrace({ outcome: entry.diagnostics?.outcome, errorCode: entry.diagnostics?.error?.type,
        rejectionReason: reason ?? rejectionFromCode(entry.diagnostics?.error?.type), fallback: reason ? fallback : null });
    });
}

/** Null means unread/unavailable, rather than an inferred negative result after a failed wait. */
export function observeAnswerCheckpoint(snapshot, oldMessageIds, receiptConsumed = null) {
  const state = snapshot?.planningState;
  const messages = state?.messages;
  const count = Array.isArray(messages) && oldMessageIds instanceof Set
    ? messages.filter(message => message?.role === 'assistant' && typeof message.id === 'string' && !oldMessageIds.has(message.id)).length : null;
  return { pendingTurnPresent: state && Array.isArray(messages) ? state.pendingTurn != null : null,
    newAssistant: count === null ? null : count === 0 ? 'none' : count === 1 ? 'one' : 'multiple',
    receiptConsumed: typeof receiptConsumed === 'boolean' ? receiptConsumed : null };
}

// Canonical public production route (README.md); Worker CORS origins also include previews/dev.
const PRODUCTION_ORIGINS = new Set(['https://laplance.com']);
export function classifyProductionOrigin(raw) {
  try {
    const url = new URL(raw);
    return url.username === '' && url.password === '' && PRODUCTION_ORIGINS.has(url.origin)
      ? 'production' : 'non_production';
  } catch { return 'non_production'; }
}
export function requireProductionOrigin(raw) {
  if (classifyProductionOrigin(raw) !== 'production') throw new Error('non_production: D5 production smoke target rejected.');
}

/** Default to enabled-release verification; an OFF drill must be explicitly selected. */
export function productionSmokeExpectation(env = process.env) {
  const fallback = env.EXPECT_FALLBACK ?? '0';
  const jev = env.EXPECT_JEV ?? (fallback === '1' ? '0' : '1');
  if (![jev, fallback].every(flag => ['0', '1'].includes(flag))) throw new Error('EXPECT_JEV and EXPECT_FALLBACK must be 0 or 1.');
  if (jev === fallback) throw new Error('Select exactly one of EXPECT_JEV and EXPECT_FALLBACK.');
  return fallback === '1' ? 'EXPECT_FALLBACK' : 'EXPECT_JEV';
}

/** No frontend commit asset/meta exists in this app. Null means external Pages readback is required.
 * If a served identifier is supplied, mismatch can never be treated as missing evidence.
 */
export function verifyFrontendIdentity(expectedSha, servedSha = null) {
  if (typeof expectedSha !== 'string' || !/^[0-9a-f]{40}$/u.test(expectedSha)) {
    throw new Error('EXPECTED_FRONTEND_SHA must be a full lowercase 40-hex commit SHA.');
  }
  if (servedSha === null) return 'out_of_band_pages_readback_required';
  if (servedSha !== expectedSha) throw new Error('frontend_identity_mismatch');
  return 'match';
}

/** Production SDK requests use either a database query parameter or a REST path. */
export function productionDatabaseFromRequestUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'firestore.googleapis.com') return null;
  const database = url.searchParams.get('database')
    ?? url.pathname.match(/\/(projects\/[^/]+\/databases\/[^/]+)(?:\/|:|$)/u)?.[1];
  return typeof database === 'string' && /^projects\/[^/]+\/databases\/[^/]+$/u.test(database) ? database : null;
}

/** Self-contained so Playwright serializes this read-only function into the same Page. */
export function readOwnedConversation(owner) {
  const index = JSON.parse(localStorage.getItem(`studyplanner.aiPlanning.chats.v1.${owner}`) ?? 'null');
  if (!index) return null;
  const snapshot = JSON.parse(localStorage.getItem(`studyplanner.aiPlanning.chat.v1.${owner}.${index.activeChatId}`) ?? 'null');
  if (!snapshot) return null;
  if (snapshot.ownerId !== owner || snapshot.version !== 'studyplanner-weekly-planning-stable-v5-session-v1'
    || !snapshot.graph || !snapshot.planningState || !Array.isArray(snapshot.graph.factLifecycles)) {
    throw new Error('Owned conversation checkpoint is incomplete.');
  }
  return snapshot;
}

/** Correlate the actual canonical receipt key, selected candidate ID and manifest hash. */
export function consumedD5Request(snapshot, request, owner, target) {
  const selected = request.menu.options.find(option => option.kind === 'leaf'
    && option.candidate.tuple.minutes === 15 && option.candidate.tuple.measurement === 'duration_per_unit'
    && option.candidate.tuple.perUnit === 'problem' && option.candidate.tuple.precision === 'exact');
  const ledger = snapshot.planningState.intakeState?.c5SelectionLedger;
  return Boolean(selected && request.context.target.id === target && snapshot.ownerId === owner
    && ledger?.ownerId === owner && ledger.conversationId === snapshot.conversationId
    && ledger.consumed.some(receipt => receipt.requestKey === JSON.stringify([owner, snapshot.conversationId, request.requestId])
      && receipt.candidateSetHash === request.candidateSetHash && receipt.candidateId === selected.candidate.id));
}

/** Full owned reads; operations own item SUBCOLLECTIONS, never a root items query.
 * Self-contained for page.evaluate. Missing/denied/malformed responses fail closed.
 */
export async function readProductionServerSnapshot({ uid, idToken, database }) {
  if (!/^projects\/[^/]+\/databases\/[^/]+$/u.test(database)) throw new Error('Invalid production database.');
  const prefix = `${database}/documents`;
  const rows = {};
  const query = async (parent, collectionId) => {
    const response = await fetch(`https://firestore.googleapis.com/v1/${parent}:runQuery`, {
      method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: uid } } } } }),
    });
    if (!response.ok) throw new Error(`Read-only ${collectionId} server read unavailable (HTTP ${response.status}).`);
    const result = await response.json();
    if (!Array.isArray(result) || result.length === 0 || result.some(row => !row || row.error
      || row.skippedResults > 0 || (!row.document && typeof row.readTime !== 'string'))) {
      throw new Error('Incomplete server readback.');
    }
    const documents = result.filter(row => row.document).map(row => row.document);
    const seen = new Set();
    for (const doc of documents) {
      if (typeof doc.name !== 'string' || !doc.name.startsWith(`${parent}/${collectionId}/`)
        || doc.name.slice(`${parent}/${collectionId}/`.length).includes('/') || seen.has(doc.name)
        || doc.fields?.userId?.stringValue !== uid) throw new Error('Unexpected server document scope.');
      seen.add(doc.name);
    }
    return documents.sort((a, b) => a.name.localeCompare(b.name));
  };
  for (const name of ['schedule_events', 'plans', 'month_events', 'weekly_planning_approval_operations']) {
    rows[name] = await query(prefix, name);
  }
  rows.weekly_planning_approval_items = [];
  for (const operation of rows.weekly_planning_approval_operations) {
    rows.weekly_planning_approval_items.push(...await query(operation.name, 'weekly_planning_approval_items'));
  }
  rows.weekly_planning_approval_items.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/** The OFF drill must exercise the enabled client, not accidentally pass with no D5 attempt. */
export function boundOffRollbackCandidate(captured, observed, { owner, conversationId, target, policyVersion }) {
  const binding = captured?.basis?.binding;
  if (captured?.domainId !== 'd5_numeric' || captured.domainPolicyVersion !== policyVersion
    || binding?.ownerId !== owner || binding.conversationId !== conversationId || binding.target.id !== target
    || observed.length !== 1) return false;
  const { request: r, row, evaluated } = observed[0];
  return Boolean(r && row.v2 && row.status === 'unavailable' && row.off && row.provider == null && !evaluated
    && r.wholeUtterance === '15' && r.context.question.code === 'missing_effort_estimate'
    && r.context.scope.domainPolicyVersion === policyVersion && r.context.question.id === binding.question.id
    && r.context.target.id === target && r.selectionEpoch === binding.selectionEpoch
    && r.menu.kind === 'leaves' && r.menu.depth === 0
    && r.menu.options.some(option => option.kind === 'leaf' && option.candidate.tuple.targetId === target
      && option.candidate.tuple.minutes === 15 && option.candidate.tuple.measurement === 'duration_per_unit'
      && option.candidate.tuple.perUnit === 'problem' && option.candidate.tuple.precision === 'exact'));
}

/** Same-page observation of actual UI/owned checkpoint booleans; no text, ids or React internals exported. */
export function observeProductionComposerState(owner) {
  const input = document.querySelector('.ai-planning-composer textarea');
  let state = null;
  let readable = true;
  try {
    const index = JSON.parse(localStorage.getItem(`studyplanner.aiPlanning.chats.v1.${owner}`) ?? 'null');
    const snapshot = index ? JSON.parse(localStorage.getItem(`studyplanner.aiPlanning.chat.v1.${owner}.${index.activeChatId}`) ?? 'null') : null;
    if (snapshot && (snapshot.ownerId !== owner || snapshot.version !== 'studyplanner-weekly-planning-stable-v5-session-v1' || !snapshot.planningState)) readable = false;
    else state = snapshot?.planningState;
  } catch { readable = false; }
  return { present: Boolean(input), disabled: input?.disabled !== false, readable,
    busyTurn: Boolean(state?.pendingTurn || document.querySelector('[role="status"][aria-label="AIが回答を作成中"]')
      || document.querySelector('button[aria-label="処理をキャンセル"]')),
    pendingApproval: Boolean(state?.pendingApproval), approvalRecovery: Boolean(state?.approvalRecovery),
    initializationBlocked: Boolean(document.querySelector('button[aria-label="読み込めないチャットを残して新規作成"]')),
    listening: Boolean(document.querySelector('button[aria-label="音声入力を停止"][aria-pressed="true"]')) };
}

const EFFORT_KINDS = ['total_duration', 'duration_per_unit', 'session_duration'];
const EFFORT_UNITS = ['minute', 'hour', 'page', 'problem', 'word', 'lesson', 'chapter', 'section', 'exam_year', 'mock_exam', 'session', 'custom'];
const EFFORT_PRECISIONS = ['exact', 'approximate', 'unspecified'];
const EFFORT_TARGET_RELATIONS = ['question_topic', 'same_task_workload', 'same_task', 'other_task'];
const MAX_RELATED_ESTIMATES = 64;
export function redactedRelatedEffortEstimate(value) {
  return { kind: EFFORT_KINDS.includes(value?.kind) ? value.kind : 'unknown',
    minutes: typeof value?.minutes === 'number' && Number.isFinite(value.minutes) && value.minutes > 0 && value.minutes <= 1_000_000 ? value.minutes : null,
    unitCode: value?.unitCode === null ? null : EFFORT_UNITS.includes(value?.unitCode) ? value.unitCode : 'unknown',
    precision: EFFORT_PRECISIONS.includes(value?.precision) ? value.precision : 'unknown',
    targetRelation: EFFORT_TARGET_RELATIONS.includes(value?.targetRelation) ? value.targetRelation : 'unknown' };
}
/** Test oracle only: D5 promises exact; the approved OFF/Luna drill also permits unspecified precision. */
export function productionSmokeReflectedEstimate(graph, { questionTopicId, expectation }) {
  if (!['EXPECT_JEV', 'EXPECT_FALLBACK'].includes(expectation)) return null;
  const active = new Set(graph.factLifecycles.filter(fact => fact.status === 'active').map(fact => fact.factId));
  const perUnit = graph.effortEstimates.filter(estimate => active.has(estimate.id)
    && estimate.targetFactId === questionTopicId && estimate.kind === 'duration_per_unit');
  // Count every active per-unit fact on this target, even one with a conflicting unit/value.
  if (expectation === 'EXPECT_FALLBACK' && perUnit.length !== 1) return null;
  const estimate = perUnit.find(estimate => estimate.minutes === 15 && estimate.unitCode === 'problem'
    && (estimate.precision === 'exact' || expectation === 'EXPECT_FALLBACK' && estimate.precision === 'unspecified'));
  return estimate ? { minutes: 15, measurement: 'duration_per_unit', unit: 'problem', precision: estimate.precision } : null;
}

/** Diagnostics only. This projection never authorizes an answer or changes the strict estimate oracle. */
export function relatedActiveEffortEstimates(graph, { mathTaskId, questionTopicId }) {
  const active = new Set(graph.factLifecycles.filter(fact => fact.status === 'active').map(fact => fact.factId));
  const workloadIds = new Set(graph.workloads.filter(workload => workload.taskId === mathTaskId).map(workload => workload.id));
  const componentIds = new Set(graph.components.filter(component => component.taskId === mathTaskId).map(component => component.id));
  const related = graph.effortEstimates.filter(estimate => active.has(estimate.id)
    && (estimate.taskId === mathTaskId || estimate.targetFactId === questionTopicId || estimate.targetFactId === mathTaskId
      || workloadIds.has(estimate.targetFactId) || componentIds.has(estimate.targetFactId)));
  return { truncated: related.length > MAX_RELATED_ESTIMATES,
    estimates: related.slice(0, MAX_RELATED_ESTIMATES).map(estimate => redactedRelatedEffortEstimate({
      kind: estimate.kind, minutes: estimate.minutes, unitCode: estimate.unitCode, precision: estimate.precision,
      targetRelation: estimate.taskId !== mathTaskId ? 'other_task'
        : estimate.targetFactId === questionTopicId ? 'question_topic'
          : workloadIds.has(estimate.targetFactId) ? 'same_task_workload'
            : estimate.targetFactId === mathTaskId || componentIds.has(estimate.targetFactId) ? 'same_task' : 'other_task',
    })) };
}

/** Export only bounded machine/test outcomes, never raw diagnostics or arbitrary strings. */
export function redactedSmokeEvidence(value) {
  const oneOf = (input, allowed, fallback = null) => allowed.includes(input) ? input : fallback;
  const boolean = input => typeof input === 'boolean' ? input : null;
  const count = input => Number.isSafeInteger(input) && input >= 0 && input <= 10000 ? input : null;
  return {
    productionOrigin: oneOf(value.productionOrigin, ['production', 'non_production'], 'unverified'),
    frontendIdentity: oneOf(value.frontendIdentity, ['match', 'frontend_identity_mismatch', 'out_of_band_pages_readback_required'], 'unverified'),
    expectation: oneOf(value.expectation, ['EXPECT_JEV', 'EXPECT_FALLBACK']),
    composerReadiness: redactedComposerReadiness(value.composerReadiness),
    composerWaitPhase: oneOf(value.composerWaitPhase, ['view_entry', 'before_send', 'after_send']),
    answerPhase: { pendingTurnPresent: boolean(value.answerPhase?.pendingTurnPresent),
      newAssistant: oneOf(value.answerPhase?.newAssistant, ['none', 'one', 'multiple']),
      receiptConsumed: boolean(value.answerPhase?.receiptConsumed), alertPresent: boolean(value.answerPhase?.alertPresent) },
    answerTrace: (Array.isArray(value.answerTrace) ? value.answerTrace : []).slice(0, 16).map(redactedAnswerTrace),
    answerTraceTruncated: value.answerTraceTruncated === true || Array.isArray(value.answerTrace) && value.answerTrace.length > 16,
    outcome: oneOf(value.outcome, ['incomplete', 'non_production', 'd5_consumed_pending_verification',
      'fallback_no_d5_positive_claim', 'd5_positive_readonly_smoke', 'off_rollback_luna_fallback_verified'], 'incomplete'),
    candidateChoice: (Array.isArray(value.candidateChoice) ? value.candidateChoice : []).map(row => ({
      route: 'candidate_choice', provider: oneOf(row.provider, ['openrouter', 'openai']),
      status: typeof row.status === 'string' && /^http_[1-5][0-9]{2}_fallback$/u.test(row.status) ? row.status
        : oneOf(row.status, ['pending', 'evaluated', 'unavailable', 'network_or_timeout_fallback'], 'unknown'),
      selection: oneOf(row.selection, ['pending', 'none', 'leaf', 'unavailable_or_invalid'], 'unknown'),
      selected15: boolean(row.selected15), v2: boolean(row.v2),
      question: oneOf(row.question, ['missing_effort_estimate'], 'other'),
      optionCount: Number.isSafeInteger(row.optionCount) && row.optionCount >= 2 && row.optionCount <= 255 ? row.optionCount : null,
      off: boolean(row.off),
    })),
    d5Captured: boolean(value.d5Captured), d5Consumed: boolean(value.d5Consumed),
    lunaFallbackRoute: oneOf(value.lunaFallbackRoute, ['completed_direct_semantic_normalizer', 'completed_durable_semantic_normalizer']),
    activeEstimate: boolean(value.activeEstimate),
    relatedActiveEstimates: (Array.isArray(value.relatedActiveEstimates) ? value.relatedActiveEstimates : [])
      .slice(0, MAX_RELATED_ESTIMATES).map(redactedRelatedEffortEstimate),
    relatedActiveEstimatesTruncated: value.relatedActiveEstimatesTruncated === true
      || Array.isArray(value.relatedActiveEstimates) && value.relatedActiveEstimates.length > MAX_RELATED_ESTIMATES,
    reflectedEstimate: value.reflectedEstimate?.minutes === 15 && value.reflectedEstimate.measurement === 'duration_per_unit'
      && value.reflectedEstimate.unit === 'problem' && ['exact', 'unspecified'].includes(value.reflectedEstimate.precision)
      ? { minutes: 15, measurement: 'duration_per_unit', unit: 'problem', precision: value.reflectedEstimate.precision } : null,
    visibleAck: boolean(value.visibleAck), scheduleReadbackIdentical: boolean(value.scheduleReadbackIdentical),
    approvalStartEvents: count(value.approvalStartEvents), approvalExecutions: oneOf(value.approvalExecutions, [0, 'changed']),
    scheduleWrites: count(value.scheduleWrites), unclassifiedWrites: count(value.unclassifiedWrites),
    firestoreWrites: (Array.isArray(value.firestoreWrites) ? value.firestoreWrites : []).map(redactedWriteObservation),
    failingStep: value.failingStep == null ? null : redactedSmokeStep(value.failingStep),
    bodyError: boundedSmokeError(value.bodyError, value.failingStep),
    readbackStep: value.readbackStep == null ? null : redactedSmokeStep(value.readbackStep),
    readbackError: boundedSmokeError(value.readbackError, value.readbackStep),
  };
}

/** Body-only attachments are not files with Playwright's list reporter + tracing off. */
export async function persistRedactedSmokeEvidence(testInfo, evidence) {
  const output = testInfo.outputPath('redacted-d5-production-evidence.json');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(redactedSmokeEvidence(evidence), null, 2), 'utf8');
  await testInfo.attach('redacted-d5-production-evidence', { path: output, contentType: 'application/json' });
  return output;
}
