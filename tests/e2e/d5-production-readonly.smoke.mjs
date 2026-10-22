import { expect, test } from '@playwright/test';
import { classifyFirestoreWrite, runProductionSmoke, waitForProductionComposer } from './support/d5-production-smoke-observation.mjs';
import { D5_TOP1_ANSWER_POLICY_VERSION } from '../../shared/d5AnswerPolicy.ts';
import { productionDatabaseFromRequestUrl, readOwnedConversation, observeProductionComposerState, readProductionServerSnapshot, relatedActiveEffortEstimates, productionSmokeReflectedEstimate, consumedD5Request, boundOffRollbackCandidate, classifyProductionOrigin, requireProductionOrigin, verifyFrontendIdentity, productionSmokeExpectation, persistRedactedSmokeEvidence } from './support/d5-production-readonly.mjs';
import { observeOwnAnswerTrace, observeAnswerCheckpoint, readOwnedStableConversation, observeAnswerStores, isGroundedD5SmokeAck } from './support/d5-production-readonly.mjs';
import { observeRecomputedD5Preview, observeD5SmokeReload, observedD5RequestRoute, createD5RequestAccounting, recordD5VisibleUsage, d5SendRequestCount } from './support/d5-production-smoke-reload.mjs';

const secret = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const composer = page => page.locator('.ai-planning-composer textarea');

const conversation = (page, uid) => {
  requireProductionOrigin(page.url());
  return page.evaluate(readOwnedConversation, uid);
};

async function signIn(page) {
  await page.goto('/');
  requireProductionOrigin(page.url());
  await expect.poll(async () => await page.getByRole('heading', { name: '限定公開キー' }).isVisible()
    || await page.getByRole('tab', { name: 'ログイン', exact: true }).isVisible()).toBe(true);
  if (await page.getByRole('heading', { name: '限定公開キー' }).isVisible()) {
    await page.getByLabel('閲覧キー').fill(secret('STUDYPLANNER_LIVE_ACCESS_KEY'));
    await page.getByRole('button', { name: 'キーを確認して進む' }).click();
  }
  await page.getByRole('tab', { name: 'ログイン', exact: true }).click();
  requireProductionOrigin(page.url());
  await page.getByLabel('メールアドレス').fill(secret('STUDYPLANNER_LIVE_EMAIL'));
  await page.getByLabel('パスワード', { exact: true }).fill(secret('STUDYPLANNER_LIVE_PASSWORD'));
  // Fresh, normal test-account login, not an extracted profile or an impersonated session.
  const signedIn = page.waitForResponse(r => new URL(r.url()).hostname === 'identitytoolkit.googleapis.com'
    && new URL(r.url()).pathname.endsWith('/accounts:signInWithPassword'));
  await page.getByRole('button', { name: 'ログインする' }).click();
  const response = await signedIn;
  if (!response.ok()) throw new Error('Test-account login failed (credentials redacted).');
  const { localId: uid, idToken } = await response.json();
  if (typeof uid !== 'string' || typeof idToken !== 'string') throw new Error('Missing signed-in test identity.');
  // Onboarding is an operator prerequisite; this smoke never consents or changes preferences.
  await expect(page.locator('.primary-bottom-nav')).toBeVisible();
  requireProductionOrigin(page.url());
  return { uid, idToken };
}

const serverSnapshot = (page, identity, database) => {
  requireProductionOrigin(page.url());
  return page.evaluate(readProductionServerSnapshot, { ...identity, database });
};

async function readyComposer(page, identity, evidence, phase) {
  requireProductionOrigin(page.url());
  await waitForProductionComposer({ evidence, phase,
    observe: () => page.evaluate(observeProductionComposerState, identity.uid),
    wait: (check, timeout) => expect.poll(check, { timeout, message: 'Bounded AI turn UI readiness; see composerReadiness evidence' }).toBe(true),
  });
}
async function send(page, text, identity, evidence) {
  await readyComposer(page, identity, evidence, 'before_send');
  await composer(page).fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await readyComposer(page, identity, evidence, 'after_send');
}

test('explicit production D5 smoke preserves all schedules and never approves', async ({ page, baseURL }, testInfo) => {
  const evidence = { productionOrigin: classifyProductionOrigin(baseURL), frontendIdentity: 'unverified', expectation: productionSmokeExpectation(), outcome: 'incomplete', candidateChoice: [],
    d5Captured: false, d5Consumed: false, lunaFallbackRoute: null, activeEstimate: false, relatedActiveEstimates: [], relatedActiveEstimatesTruncated: false, reflectedEstimate: null, visibleAck: false,
    scheduleReadbackIdentical: false, approvalStartEvents: 0, approvalExecutions: null, scheduleWrites: 0, unclassifiedWrites: 0, firestoreWrites: [],
    answerPhase: { pendingTurnPresent: null, newAssistant: null, receiptConsumed: null, alertPresent: null }, answerStores: null, visibleAckObserved: null, answerTrace: [], answerTraceTruncated: false,
    recompute: null, reload: { attempted: false }, accounting: createD5RequestAccounting(),
    step: 'target_preflight', failingStep: null, bodyError: null, readbackStep: null, readbackError: null, composerReadiness: 'unobserved', composerWaitPhase: null };
  const observations = new Map();
  const fallbackRequests = new Map();
  const fallbackRequestIds = new Set();
  const candidateRequestIds = new Set();
  const requestRoutes = new Map();
  const responseTasks = [];
  const observationErrors = [];
  let database;
  let before;
  let identity;
  let approvalBefore;
  let dialogueVerified = false;
  const approvalLedger = async () => page.evaluate(uid => localStorage.getItem(
    `studyplanner-weekly-approval-ledger-v2.${encodeURIComponent(uid)}`), identity.uid);

  page.on('request', request => {
    const url = new URL(request.url());
    let accountingBody;
    if (request.method() === 'POST' && url.pathname.endsWith('/chat/completions')) {
      try { accountingBody = request.postDataJSON(); } catch { /* Route remains explicitly unclassified. */ }
    }
    const route = observedD5RequestRoute({ url: request.url(), method: request.method(), body: accountingBody });
    if (route) {
      requestRoutes.set(request, route);
      evidence.accounting.observedRequests[route]++;
    }
    if (url.hostname === 'firestore.googleapis.com') {
      database ??= productionDatabaseFromRequestUrl(request.url());
      const write = classifyFirestoreWrite({ url: request.url(), method: request.method(), postData: request.postData() });
      if (write) {
        evidence.firestoreWrites.push(write);
        if (write.classification === 'forbidden') evidence.scheduleWrites++;
        if (write.classification === 'unclassified') evidence.unclassifiedWrites++;
      }
    }
    if (request.method() === 'POST' && /weekly-planning-trace|observability/u.test(url.pathname)) {
      try {
        const observed = observeOwnAnswerTrace(request.postDataJSON(), candidateRequestIds);
        const combined = [...evidence.answerTrace, ...observed];
        evidence.answerTraceTruncated ||= combined.length > 16;
        evidence.answerTrace = combined.slice(0, 16);
        const countStarts = value => {
          if (!value || typeof value !== 'object') return 0;
          return (value.eventType === 'approval_started' ? 1 : 0)
            + Object.values(value).reduce((sum, child) => sum + countStarts(child), 0);
        };
        evidence.approvalStartEvents += countStarts(request.postDataJSON());
      } catch { observationErrors.push('unreadable_diagnostic_request'); }
    }
    if (url.pathname.endsWith('/weekly-planning/turns') && request.method() === 'POST') {
      try {
        const body = request.postDataJSON();
        if (body?.payload?.input?.userText === '15') {
          fallbackRequests.set(request, body.requestId);
          fallbackRequestIds.add(body.requestId);
        }
      } catch { observationErrors.push('unreadable_durable_request'); }
    }
    if (!url.pathname.endsWith('/chat/completions') || request.method() !== 'POST') return;
    let body;
    try { body = request.postDataJSON(); } catch { observationErrors.push('unreadable_chat_request'); return; }
    if (body?.decisionContext?.purpose !== 'candidate_choice') {
      const schema = body?.response_format?.json_schema?.name;
      if (['weekly_planning_semantic_document_v5', 'weekly_planning_focused_contextual_answer_v5'].includes(schema)) {
        const answer = body.messages?.some(message => {
          try { const prompt = JSON.parse(message.content); return prompt.userText === '15' || prompt.currentUserText === '15'; } catch { return false; }
        });
        if (answer) fallbackRequests.set(request, 'direct-semantic');
      }
      return;
    }
    const r = body.decisionContext.request;
    if (typeof r?.requestId === 'string') candidateRequestIds.add(r.requestId);
    const row = { route: 'candidate_choice', provider: null, status: 'pending', selection: 'pending', selected15: false,
      v2: r?.context?.scope?.domainPolicyVersion === D5_TOP1_ANSWER_POLICY_VERSION,
      question: r?.context?.question?.code, optionCount: r?.menu?.options?.length };
    observations.set(request, { request: r, row });
    evidence.candidateChoice.push(row); // No text, UID, IDs, hashes, tokens or payloads are persisted.
  });
  page.on('requestfailed', request => {
    const observed = observations.get(request);
    if (observed) observed.row.status = 'network_or_timeout_fallback';
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (requestRoutes.get(response.request()) === 'chat_completions_non_candidate') {
      responseTasks.push((async () => {
        const result = await response.json();
        recordD5VisibleUsage(evidence.accounting, result?.usage);
      })().catch(() => { evidence.accounting.visibleUsage.invalidResponses++; }));
    }
    const fallbackId = fallbackRequests.get(response.request()) ?? (url.pathname.endsWith('/weekly-planning/turns') ? url.searchParams.get('requestId') : null);
    if (fallbackId === 'direct-semantic' || fallbackRequestIds.has(fallbackId)) {
      responseTasks.push((async () => {
        if (!response.ok()) return;
        const result = await response.json();
        if (fallbackId === 'direct-semantic' && typeof result.content === 'string'
          && await response.headerValue('x-studyplanner-ai-provider') !== 'openrouter') {
          evidence.lunaFallbackRoute = 'completed_direct_semantic_normalizer';
        } else if (result.status === 'completed' && result.identity?.requestId === fallbackId && typeof result.result === 'string') {
          evidence.lunaFallbackRoute = 'completed_durable_semantic_normalizer';
        }
      })().catch(() => { observationErrors.push('unreadable_fallback_response'); }));
    }
    const observed = observations.get(response.request());
    if (!observed) return;
    responseTasks.push((async () => {
      observed.row.provider = await response.headerValue('x-studyplanner-ai-provider');
      if (!response.ok()) { observed.row.status = `http_${response.status()}_fallback`; return; }
      const result = await response.json();
      observed.row.status = result.status;
      observed.row.off = result.status === 'unavailable' && result.reason === 'off';
      const r = observed.request;
      observed.evaluated = result.status === 'evaluated' && result.requestId === r.requestId
        && result.candidateSetHash === r.candidateSetHash && result.selectionEpoch === r.selectionEpoch
        && result.nodeId === r.menu.nodeId;
      const selected = r.menu.options.find(option => option.id === result.optionId);
      observed.row.selection = result.optionId === 'none' ? 'none' : selected?.kind === 'leaf' ? 'leaf' : 'unavailable_or_invalid';
      observed.row.selected15 = selected?.kind === 'leaf' && selected.candidate.tuple.minutes === 15
        && selected.candidate.tuple.measurement === 'duration_per_unit' && selected.candidate.tuple.precision === 'exact' && selected.candidate.tuple.perUnit === 'problem';
    })().catch(() => { observationErrors.push('unreadable_candidate_response'); }));
  });

  await runProductionSmoke({ evidence, body: async () => {
    console.log(JSON.stringify({ productionOrigin: evidence.productionOrigin }));
    requireProductionOrigin(baseURL);
    evidence.frontendIdentity = verifyFrontendIdentity(process.env.EXPECTED_FRONTEND_SHA);
    console.log(JSON.stringify({ frontendIdentity: evidence.frontendIdentity }));
    evidence.step = 'login';
    identity = await signIn(page);
    await expect.poll(() => typeof database === 'string').toBe(true);
    if (!/^projects\/[^/]+\/databases\/[^/]+$/u.test(database)) throw new Error('Missing production database identity.');
    evidence.step = 'server_snapshot_before';
    before = await serverSnapshot(page, identity, database);
    approvalBefore = await approvalLedger();
    evidence.step = 'fresh_conversation';
    await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
    await readyComposer(page, identity, evidence, 'view_entry');
    const previousConversationId = (await conversation(page, identity.uid))?.conversationId;
    await page.getByRole('button', { name: 'チャット一覧を開く' }).click();
    await page.getByRole('button', { name: '新しいチャット', exact: true }).click();
    await readyComposer(page, identity, evidence, 'view_entry');
    const start = secret('D5_SMOKE_WEEK_START');
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(start) || !Number.isFinite(Date.parse(`${start}T00:00:00Z`))
      || new Date(`${start}T00:00:00Z`).toISOString().slice(0, 10) !== start
      || start <= new Date().toISOString().slice(0, 10)) throw new Error('D5_SMOKE_WEEK_START must be a valid future YYYY-MM-DD.');
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const endDate = end.toISOString().slice(0, 10);
    evidence.step = 'setup_question';
    await send(page, `${start}から${endDate}で数学20問と英語15ページを進めたい。英語15ページは全部で45分。`, identity, evidence);
    await expect.poll(async () => {
      const snapshot = await conversation(page, identity.uid);
      const question = snapshot?.planningState?.intakeState?.lastQuestionContext;
      return question?.targetSlot === 'stable_v5:missing_effort_estimate' && question.intent === 'duration_per_unit'
        && snapshot?.planningState?.pendingTurn == null;
    }).toBe(true);
    const pending = await conversation(page, identity.uid);
    expect(pending.conversationId !== previousConversationId, 'Fresh conversation identity').toBe(true);
    expect(pending.planningState.messages.filter(message => message.role === 'user').length, 'Fresh setup is the only user turn').toBe(1);
    const target = pending.planningState.intakeState.lastQuestionContext.topicId;
    const targetWorkload = pending.graph.workloads.find(w => w.id === target);
    const targetTask = pending.graph.tasks.find(t => t.id === targetWorkload?.taskId);
    if (!targetWorkload || !targetTask?.title.includes('数学')) throw new Error('Setup did not ask the intended math effort question.');
    const activeSetup = new Set(pending.graph.factLifecycles.filter(row => row.status === 'active').map(row => row.factId));
    const englishWorkloads = pending.graph.workloads.filter(workload => activeSetup.has(workload.id)
      && workload.taskId !== targetTask.id && workload.amount === 15 && workload.unitCode === 'page' && workload.quantityRole === 'target');
    if (englishWorkloads.length !== 1) throw new Error('Setup English workload is not uniquely bound.');
    const englishWorkload = englishWorkloads[0];
    const previewTargets = { mathTaskId: targetTask.id, mathWorkloadId: target,
      englishTaskId: englishWorkload.taskId, englishWorkloadId: englishWorkload.id, expectation: evidence.expectation };
    evidence.step = 'd5_capture';
    const captured = pending.planningState.intakeState.lastQuestionContext.controlledCandidate;
    evidence.d5Captured = captured?.domainId === 'd5_numeric' && captured.domainPolicyVersion === D5_TOP1_ANSWER_POLICY_VERSION
      && captured.basis.binding.ownerId === identity.uid && captured.basis.binding.conversationId === pending.conversationId
      && captured.basis.binding.target.id === target;
    const consumedBefore = pending.planningState.intakeState.c5SelectionLedger?.consumed.length ?? 0;
    const oldMessages = new Set(pending.planningState.messages.map(message => message.id));
    const beforeAnswerIndex = await page.evaluate(owner => localStorage.getItem(`studyplanner.aiPlanning.chats.v1.${owner}`), identity.uid);
    evidence.step = 'answer_turn';
    try {
      await send(page, '15', identity, evidence);
      await expect.poll(async () => {
        const snapshot = await conversation(page, identity.uid);
        return snapshot?.planningState?.pendingTurn == null && snapshot?.planningState?.messages
          .some(message => message.role === 'assistant' && !oldMessages.has(message.id));
      }).toBe(true);
    } finally {
      // Failure observations must not overwrite the primary timeout or convert unread state into false.
      const [checkpoint, alert, owned, indexChanged, visibleTexts] = await Promise.allSettled([
        conversation(page, identity.uid), page.locator('.ai-planning-error[role="alert"]').isVisible(),
        page.evaluate(readOwnedStableConversation, { owner: identity.uid, weekStartDate: pending.weekStartDate, conversationId: pending.conversationId }),
        // Serialized metadata change, not access to React's in-memory index reference.
        page.evaluate(({ owner, before }) => localStorage.getItem(`studyplanner.aiPlanning.chats.v1.${owner}`) !== before,
          { owner: identity.uid, before: beforeAnswerIndex }),
        page.locator('.ai-planning-message-row.assistant .ai-planning-bubble:visible').allTextContents(),
      ]);
      if (checkpoint.status === 'fulfilled') {
        const snapshot = checkpoint.value;
        const consumed = snapshot?.planningState?.intakeState?.c5SelectionLedger?.consumed;
        const receipt = Array.isArray(consumed) && consumed.length === consumedBefore ? false
          : Array.isArray(consumed) && [...observations.values()].some(({ request: r }) => consumedD5Request(snapshot, r, identity.uid, target)) ? true : null;
        Object.assign(evidence.answerPhase, observeAnswerCheckpoint(snapshot, oldMessages, receipt));
      }
      if (alert.status === 'fulfilled') evidence.answerPhase.alertPresent = alert.value;
      evidence.answerStores = observeAnswerStores(checkpoint.status === 'fulfilled' ? checkpoint.value : null,
        owned.status === 'fulfilled' ? owned.value : null, oldMessages);
      const ownedSnapshot = owned.status === 'fulfilled' ? owned.value : null;
      if (ownedSnapshot) {
        const receipts = ownedSnapshot.planningState.intakeState?.c5SelectionLedger?.consumed;
        evidence.answerStores.owned.receiptConsumed = Array.isArray(receipts) && receipts.length === consumedBefore ? false
          : Array.isArray(receipts) && [...observations.values()].some(({ request: r }) => consumedD5Request(ownedSnapshot, r, identity.uid, target)) ? true : null;
      }
      evidence.answerStores.chat.receiptConsumed = evidence.answerPhase.receiptConsumed;
      if (indexChanged.status === 'fulfilled') evidence.answerStores.chatIndexChanged = indexChanged.value;
      if (visibleTexts.status === 'fulfilled') evidence.visibleAckObserved = visibleTexts.value.some(isGroundedD5SmokeAck);
    }
    await Promise.all(responseTasks);
    evidence.step = 'answer_state';
    const after = await conversation(page, identity.uid);
    expect(after.planningState.pendingApproval == null, 'No pending approval').toBe(true);
    expect(after.planningState.approvalRecovery == null, 'No approval execution/recovery').toBe(true);
    const consumed = after.planningState.intakeState.c5SelectionLedger?.consumed ?? [];
    const related = relatedActiveEffortEstimates(after.graph, { mathTaskId: targetTask.id, questionTopicId: target });
    evidence.relatedActiveEstimates = related.estimates;
    evidence.relatedActiveEstimatesTruncated = related.truncated;
    evidence.reflectedEstimate = productionSmokeReflectedEstimate(after.graph, { questionTopicId: target, expectation: evidence.expectation });
    evidence.activeEstimate = evidence.reflectedEstimate !== null;
    const answer = after.planningState.messages.filter(message => message.role === 'assistant' && !oldMessages.has(message.id)).at(-1);
    // Synthetic setup only: the visible ACK must name math, 15 minutes and per-problem scope.
    evidence.visibleAck = isGroundedD5SmokeAck(answer?.content)
      && await page.getByText(answer.content, { exact: true }).isVisible();
    const observed = [...observations.values()];
    evidence.d5Consumed = consumed.length === consumedBefore + 1 && observed.some(({ request: r, row, evaluated }) =>
      evaluated && row.v2 && row.selected15 && consumedD5Request(after, r, identity.uid, target));
    evidence.outcome = evidence.d5Consumed ? 'd5_consumed_pending_verification' : 'fallback_no_d5_positive_claim';
    if (evidence.expectation === 'EXPECT_JEV') {
      evidence.step = 'jev_evaluation';
      expect(observed.length, 'Exactly one candidate attempt; no silent retries').toBe(1);
      expect(observed.every(({ row, evaluated }) => evaluated && row.provider === 'openrouter'
        && row.status === 'evaluated' && row.v2 && row.question === 'missing_effort_estimate')).toBe(true);
      evidence.step = 'd5_consumption';
      expect(evidence.d5Consumed, 'D5 must consume the evaluated 15-minute selection').toBe(true);
      evidence.step = 'active_estimate';
      expect(evidence.activeEstimate, 'Active math per-problem exact 15-minute estimate').toBe(true);
      evidence.step = 'visible_ack';
      expect(evidence.visibleAck, 'Visible grounded math ACK').toBe(true);
    } else {
      evidence.step = 'off_capture';
      expect(evidence.d5Captured, 'OFF drill requires real bound D5 capture by the new frontend').toBe(true);
      evidence.step = 'off_candidate';
      expect(observed.length, 'OFF drill requires exactly one eligible candidate request').toBe(1);
      expect(boundOffRollbackCandidate(captured, observed, { owner: identity.uid, conversationId: pending.conversationId,
        target, policyVersion: D5_TOP1_ANSWER_POLICY_VERSION }),
      'Bound candidate request must receive unavailable/off with no Jev evaluation').toBe(true);
      evidence.step = 'off_consumption';
      expect(consumedBefore, 'Fresh OFF drill starts with no consumed selections').toBe(0);
      expect(consumed.length, 'OFF drill cannot consume any candidate selection').toBe(0);
      evidence.step = 'luna_fallback';
      expect(evidence.lunaFallbackRoute != null, 'Existing Luna semantic route must complete on the 15 answer').toBe(true);
      expect(evidence.d5Consumed, 'OFF drill cannot claim D5 consumption').toBe(false);
      evidence.step = 'active_estimate';
      expect(evidence.activeEstimate, 'Exactly one bound non-approximate Luna 15-minute per-problem estimate').toBe(true);
      evidence.step = 'visible_ack';
      expect(evidence.visibleAck, 'Luna fallback ACK').toBe(true);
      testInfo.annotations.push({ type: 'fallback', description:
        'OFF rollback drill: captured D5 unavailable/off; Luna route/ACK verified. No D5 consumption.' });
    }
    evidence.step = 'network_evidence';
    expect(evidence.answerStores?.replyStores, 'Committed assistant must survive in both owned and chat checkpoints').toBe('both');
    expect(evidence.answerStores?.checkpointsAgree, 'Graph and complete planning state must agree across checkpoints').toBe(true);
    expect(evidence.visibleAckObserved, 'DOM ACK observation runs independently of checkpoint success').toBe(true);
    expect(observationErrors.length, 'Network evidence must be complete').toBe(0);
    evidence.step = 'recompute';
    const preReloadOwned = await page.evaluate(readOwnedStableConversation,
      { owner: identity.uid, weekStartDate: after.weekStartDate, conversationId: after.conversationId });
    evidence.recompute = observeRecomputedD5Preview(pending, preReloadOwned, previewTargets);
    expect(evidence.recompute.status, 'Actual persisted fresh preview must use math base300/English45 and the production allocation oracle').toBe('verified');
    const preReloadChat = await conversation(page, identity.uid);
    const sendsBeforeReload = d5SendRequestCount(evidence.accounting);
    evidence.step = 'reload';
    evidence.reload.attempted = true;
    try {
      await page.reload();
      requireProductionOrigin(page.url());
      await expect(page.locator('.primary-bottom-nav')).toBeVisible();
      await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
      await readyComposer(page, identity, evidence, 'view_entry');
    } finally {
      const [chat, owned, visible] = await Promise.allSettled([
        conversation(page, identity.uid), page.evaluate(readOwnedStableConversation,
          { owner: identity.uid, weekStartDate: after.weekStartDate, conversationId: after.conversationId }),
        page.getByText(answer.content, { exact: true }).isVisible(),
      ]);
      Object.assign(evidence.reload, observeD5SmokeReload(preReloadChat, preReloadOwned,
        chat.status === 'fulfilled' ? chat.value : null, owned.status === 'fulfilled' ? owned.value : null, answer.id));
      if (visible.status === 'fulfilled') evidence.reload.visibleAck = visible.value && isGroundedD5SmokeAck(answer.content);
      evidence.reload.noNewSend = d5SendRequestCount(evidence.accounting) === sendsBeforeReload;
    }
    evidence.step = 'reload_state';
    for (const key of ['chatUnchanged', 'ownedUnchanged', 'storesAgree', 'sameAssistant', 'revisionSame', 'receiptSame', 'previewSame', 'estimateSame', 'visibleAck', 'noNewSend']) {
      expect(evidence.reload[key], `Reload must preserve ${key} without another send`).toBe(true);
    }
    for (const key of ['pendingTurnPresent', 'pendingApprovalPresent', 'approvalRecoveryPresent']) expect(evidence.reload[key], `Reload has no ${key}`).toBe(false);
    await Promise.all(responseTasks);
    dialogueVerified = true;
  }, readback: async () => {
    evidence.step = 'server_snapshot_after';
    if (classifyProductionOrigin(page.url()) !== 'production') {
      evidence.productionOrigin = 'non_production';
      evidence.outcome = 'non_production';
    }
    if (before && identity && database) {
      requireProductionOrigin(page.url());
      const after = await serverSnapshot(page, identity, database);
      evidence.scheduleReadbackIdentical = JSON.stringify(before) === JSON.stringify(after);
      const ledgersIdentical = await approvalLedger() === approvalBefore
        && JSON.stringify(before.weekly_planning_approval_operations) === JSON.stringify(after.weekly_planning_approval_operations)
        && JSON.stringify(before.weekly_planning_approval_items) === JSON.stringify(after.weekly_planning_approval_items);
      evidence.approvalExecutions = ledgersIdentical ? 0 : 'changed';
      expect(evidence.scheduleReadbackIdentical, 'All owned schedule/event and approval server records unchanged').toBe(true);
      evidence.step = 'approval_readback';
      expect(evidence.approvalExecutions, 'No approval executions').toBe(0);
      expect(evidence.approvalStartEvents, 'No observed approval-start diagnostic').toBe(0);
      evidence.step = 'write_scope';
      expect(evidence.scheduleWrites, 'No schedule/event/approval or other planner-data write attempts').toBe(0);
      expect(evidence.unclassifiedWrites, 'Every Firestore write must have a classified, explicitly allowed target').toBe(0);
      requireProductionOrigin(page.url());
      if (dialogueVerified && evidence.d5Consumed) evidence.outcome = 'd5_positive_readonly_smoke';
      else if (dialogueVerified && evidence.expectation === 'EXPECT_FALLBACK') evidence.outcome = 'off_rollback_luna_fallback_verified';
    }
  }, persist: async () => { await Promise.all(responseTasks); return persistRedactedSmokeEvidence(testInfo, evidence); } });
});
