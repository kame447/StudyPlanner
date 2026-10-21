import { expect, test } from '@playwright/test';
import { jevPurposeCanarySample } from '../../workers/ai-proxy/src/decision/jevPurposeRollout.ts';
import { D5_TOP1_ANSWER_POLICY_VERSION } from '../../shared/d5AnswerPolicy.ts';
import { productionDatabaseFromRequestUrl, readOwnedConversation, readProductionServerSnapshot, consumedD5Request, boundOffRollbackCandidate, classifyProductionOrigin, requireProductionOrigin, verifyFrontendIdentity, persistRedactedSmokeEvidence } from './support/d5-production-readonly.mjs';

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

async function send(page, text) {
  await composer(page).fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
}

test('explicit production D5 smoke preserves all schedules and never approves', async ({ page, baseURL }, testInfo) => {
  const evidence = { productionOrigin: classifyProductionOrigin(baseURL), frontendIdentity: 'unverified', inCohort5: null, outcome: 'incomplete', candidateChoice: [],
    d5Captured: false, d5Consumed: false, lunaFallbackRoute: null, activeEstimate: false, reflectedEstimate: null, visibleAck: false,
    scheduleReadbackIdentical: false, approvalStartEvents: 0, approvalExecutions: null, scheduleWrites: 0 };
  const observations = new Map();
  const fallbackRequests = new Map();
  const fallbackRequestIds = new Set();
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
    if (url.hostname === 'firestore.googleapis.com') {
      database ??= productionDatabaseFromRequestUrl(request.url());
      // Conservatively count any write-stream, commit, batchWrite or REST mutation.
      if (/\/Write\/channel|:commit|:batchWrite/u.test(url.pathname)
        || ['PATCH', 'DELETE', 'PUT'].includes(request.method())
        || request.method() === 'POST' && /\/documents\//u.test(url.pathname) && !url.pathname.endsWith(':runQuery')) {
        evidence.scheduleWrites++;
      }
    }
    if (request.method() === 'POST' && /weekly-planning-trace|observability/u.test(url.pathname)) {
      try {
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

  try {
    console.log(JSON.stringify({ productionOrigin: evidence.productionOrigin }));
    requireProductionOrigin(baseURL);
    evidence.frontendIdentity = verifyFrontendIdentity(process.env.EXPECTED_FRONTEND_SHA);
    console.log(JSON.stringify({ frontendIdentity: evidence.frontendIdentity }));
    identity = await signIn(page);
    evidence.inCohort5 = jevPurposeCanarySample('candidate_choice', identity.uid) < 0.05;
    console.log(JSON.stringify({ inCohort5: evidence.inCohort5 })); // Boolean only, never UID/hash.
    await expect.poll(() => typeof database === 'string').toBe(true);
    if (!/^projects\/[^/]+\/databases\/[^/]+$/u.test(database)) throw new Error('Missing production database identity.');
    before = await serverSnapshot(page, identity, database);
    approvalBefore = await approvalLedger();
    await page.getByRole('navigation', { name: '主要ナビゲーション' }).getByRole('button', { name: 'AI計画', exact: true }).click();
    await expect(composer(page)).toBeEnabled();
    const previousConversationId = (await conversation(page, identity.uid))?.conversationId;
    await page.getByRole('button', { name: 'チャット一覧を開く' }).click();
    await page.getByRole('button', { name: '新しいチャット', exact: true }).click();
    await expect(composer(page)).toBeEnabled();
    const start = secret('D5_SMOKE_WEEK_START');
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(start) || !Number.isFinite(Date.parse(`${start}T00:00:00Z`))
      || new Date(`${start}T00:00:00Z`).toISOString().slice(0, 10) !== start
      || start <= new Date().toISOString().slice(0, 10)) throw new Error('D5_SMOKE_WEEK_START must be a valid future YYYY-MM-DD.');
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const endDate = end.toISOString().slice(0, 10);
    await send(page, `${start}から${endDate}で数学20問と英語15ページを進めたい。英語15ページは全部で45分。`);
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
    const captured = pending.planningState.intakeState.lastQuestionContext.controlledCandidate;
    evidence.d5Captured = captured?.domainId === 'd5_numeric' && captured.domainPolicyVersion === D5_TOP1_ANSWER_POLICY_VERSION
      && captured.basis.binding.ownerId === identity.uid && captured.basis.binding.conversationId === pending.conversationId
      && captured.basis.binding.target.id === target;
    const consumedBefore = pending.planningState.intakeState.c5SelectionLedger?.consumed.length ?? 0;
    const oldMessages = new Set(pending.planningState.messages.map(message => message.id));
    await send(page, '15');
    await expect.poll(async () => {
      const snapshot = await conversation(page, identity.uid);
      return snapshot?.planningState?.pendingTurn == null && snapshot?.planningState?.messages
        .some(message => message.role === 'assistant' && !oldMessages.has(message.id));
    }).toBe(true);
    await Promise.all(responseTasks);
    const after = await conversation(page, identity.uid);
    expect(after.planningState.pendingApproval == null, 'No pending approval').toBe(true);
    expect(after.planningState.approvalRecovery == null, 'No approval execution/recovery').toBe(true);
    const consumed = after.planningState.intakeState.c5SelectionLedger?.consumed ?? [];
    const active = new Set(after.graph.factLifecycles.filter(fact => fact.status === 'active').map(fact => fact.factId));
    evidence.activeEstimate = after.graph.effortEstimates.some(estimate => active.has(estimate.id)
      && estimate.targetFactId === target && estimate.kind === 'duration_per_unit' && estimate.minutes === 15
      && estimate.unitCode === 'problem' && estimate.precision === 'exact');
    evidence.reflectedEstimate = evidence.activeEstimate ? { minutes: 15, measurement: 'duration_per_unit', unit: 'problem', precision: 'exact' } : null;
    const answer = after.planningState.messages.filter(message => message.role === 'assistant' && !oldMessages.has(message.id)).at(-1);
    // Synthetic setup only: the visible ACK must name math, 15 minutes and per-problem scope.
    evidence.visibleAck = typeof answer?.content === 'string' && /数学/u.test(answer.content)
      && /(?:1|１|一)問(?:あたり)?[^。！？\n]{0,20}(?:15|１５|十五)分/u.test(answer.content)
      && await page.getByText(answer.content, { exact: true }).isVisible();
    const observed = [...observations.values()];
    evidence.d5Consumed = consumed.length === consumedBefore + 1 && observed.some(({ request: r, row, evaluated }) =>
      evaluated && row.v2 && row.selected15 && consumedD5Request(after, r, identity.uid, target));
    evidence.outcome = evidence.d5Consumed ? 'd5_consumed_pending_verification' : 'fallback_no_d5_positive_claim';
    const expectFallback = process.env.EXPECT_FALLBACK === '1';
    const mustUseJev = !expectFallback && (evidence.inCohort5 || process.env.EXPECT_JEV === '1');
    if (mustUseJev) {
      expect(observed.length, 'Exactly one candidate attempt; no silent retries').toBe(1);
      expect(observed.every(({ row, evaluated }) => evaluated && row.provider === 'openrouter'
        && row.status === 'evaluated' && row.v2 && row.question === 'missing_effort_estimate')).toBe(true);
      expect(evidence.d5Consumed, 'D5 must consume the evaluated 15-minute selection').toBe(true);
      expect(evidence.activeEstimate, 'Active math per-problem exact 15-minute estimate').toBe(true);
      expect(evidence.visibleAck, 'Visible grounded math ACK').toBe(true);
    } else {
      if (expectFallback) {
        expect(evidence.d5Captured, 'OFF drill requires real bound D5 capture by the new frontend').toBe(true);
        expect(observed.length, 'OFF drill requires exactly one eligible candidate request').toBe(1);
        expect(boundOffRollbackCandidate(captured, observed, { owner: identity.uid, conversationId: pending.conversationId,
          target, policyVersion: D5_TOP1_ANSWER_POLICY_VERSION }),
        'Bound candidate request must receive unavailable/off with no Jev evaluation').toBe(true);
        expect(consumedBefore, 'Fresh OFF drill starts with no consumed selections').toBe(0);
        expect(consumed.length, 'OFF drill cannot consume any candidate selection').toBe(0);
        expect(evidence.lunaFallbackRoute != null, 'Existing Luna semantic route must complete on the 15 answer').toBe(true);
      }
      expect(evidence.d5Consumed, 'Fallback connectivity only; no D5 positive claim').toBe(false);
      expect(observed.length, 'Fallback must not hide multiple attempts').toBeLessThanOrEqual(1);
      expect(evidence.activeEstimate, 'Luna fallback must still reflect the answer').toBe(true);
      expect(evidence.visibleAck, 'Luna fallback ACK').toBe(true);
      testInfo.annotations.push({ type: 'fallback', description: expectFallback
        ? 'OFF rollback drill: captured D5 unavailable/off; Luna route/ACK verified. No D5 consumption.'
        : 'Out of 5% cohort; Luna connectivity only. D5 NOT verified.' });
    }
    expect(observationErrors.length, 'Network evidence must be complete').toBe(0);
    dialogueVerified = true;
  } finally {
    if (classifyProductionOrigin(page.url()) !== 'production') {
      evidence.productionOrigin = 'non_production';
      evidence.outcome = 'non_production';
    }
    // Always preserve redacted evidence, including failed/none/timeout attempts.
    try {
      if (before && identity && database) {
        evidence.productionOrigin = classifyProductionOrigin(page.url());
        if (evidence.productionOrigin !== 'production') {
          evidence.outcome = 'non_production';
          throw new Error('non_production: browser left the production origin.');
        }
        const after = await serverSnapshot(page, identity, database);
        evidence.scheduleReadbackIdentical = JSON.stringify(before) === JSON.stringify(after);
        const ledgersIdentical = await approvalLedger() === approvalBefore
          && JSON.stringify(before.weekly_planning_approval_operations) === JSON.stringify(after.weekly_planning_approval_operations)
          && JSON.stringify(before.weekly_planning_approval_items) === JSON.stringify(after.weekly_planning_approval_items);
        evidence.approvalExecutions = ledgersIdentical ? 0 : 'changed';
        expect(evidence.scheduleReadbackIdentical, 'All owned schedule/event and approval server records unchanged').toBe(true);
        expect(evidence.approvalExecutions, 'No approval executions').toBe(0);
        expect(evidence.approvalStartEvents, 'No observed approval-start diagnostic').toBe(0);
        expect(evidence.scheduleWrites, 'No Firestore write attempts, including save-and-cleanup').toBe(0);
        requireProductionOrigin(page.url());
        if (dialogueVerified && evidence.d5Consumed) evidence.outcome = 'd5_positive_readonly_smoke';
        else if (dialogueVerified && process.env.EXPECT_FALLBACK === '1') evidence.outcome = 'off_rollback_luna_fallback_verified';
      }
    } finally {
      await persistRedactedSmokeEvidence(testInfo, evidence);
    }
  }
});
