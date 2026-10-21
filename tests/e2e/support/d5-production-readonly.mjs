import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { boundedSmokeError, redactedSmokeStep, redactedWriteObservation, redactedComposerReadiness } from './d5-production-smoke-observation.mjs';

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
    reflectedEstimate: value.reflectedEstimate?.minutes === 15 && value.reflectedEstimate.measurement === 'duration_per_unit'
      && value.reflectedEstimate.unit === 'problem' && value.reflectedEstimate.precision === 'exact'
      ? { minutes: 15, measurement: 'duration_per_unit', unit: 'problem', precision: 'exact' } : null,
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
