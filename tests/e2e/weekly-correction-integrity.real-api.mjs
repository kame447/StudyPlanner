import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { request } from '@playwright/test';
import { expect, test, newFixedClockContext } from './support/fixed-clock.mjs';

// Explicit dispatch profile only. The default *.spec/*.test collection excludes this file.
// Real App/gateway/client/semantic commit/renderer; only URL/auth transport and local owner differ.
const ENABLED = process.env.STUDYPLANNER_CORRECTION_REAL_API === '1';
const TEMPORAL = process.env.STUDYPLANNER_TEMPORAL_REAL_API === '1';
if (TEMPORAL && !ENABLED) throw new Error('Temporal UI requires the reviewed real-API harness.');
const OWNER = 'planner-recovery-owner';
const HARNESS = 'http://127.0.0.1:4174/full-planner-recovery.html';
const LOCAL_API = 'http://127.0.0.1:4174/__issue488_real_api/v1/chat/completions';
const PROVIDER_API = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-5.6-luna';
const LIMITS = Object.freeze({ cases: 2, turnsPerCase: 3, turns: 6, callsPerCase: 8, calls: 16,
  requestMs: 60_000, turnMs: 120_000, caseMs: 300_000 });
const INITIAL = '2026年8月24日から30日で、数学の問題集を20問進める計画のプレビューを作って。1問3分、1回30分、毎日20時以降で。';
const CORRECTION_CASES = Object.freeze([
  { id: 'paired-workload-effort', amount: 40, pace: 2, session: 20, durations: [20, 20, 20, 20], start: '2026-08-24', end: '2026-08-30',
    correction: '20問ではなく40問に変更。1問2分、1回20分にして。期間と20時以降の条件はそのまま。',
    continuation: 'その条件でプレビューを作って。' },
  { id: 'pending-window-date', amount: 20, pace: 3, session: 30, durations: [30, 30], start: '2026-08-31', end: '2026-09-06',
    correction: '開始日を8月31日に変更したいけど、終了日はまだ迷っています。それ以外の条件は同じです。',
    continuation: '終了日は9月6日です。他の条件は変えません。' },
]);
const TEMPORAL_CASES = Object.freeze([
  { id: 'task-weekday-scope-repair',
    initial: '来週の計画のプレビューを作って。数学の問題集を12問、1問5分、1回30分で進めます。数学というタスクの日時希望は金曜日の20時から22時です。',
    correction: '対象期間を8月24日から26日までに変更してください。数学の金曜20時から22時という希望と作業量は変更しません。',
    continuation: '数学の日時希望を8月26日水曜日の20時から22時に変更します。他はそのままでプレビューを作って。' },
  { id: 'plan-weekday-to-overnight-hard',
    initial: '来週の計画のプレビューを作って。数学の問題集を12問、1問5分、1回30分で進めます。計画全体の時間帯の希望として、金曜日20時から22時を優先してください。',
    correction: '計画全体の金曜20時から22時の希望を取り下げます。8月28日23時30分から翌8月29日1時30分までだけが使える必須条件です。作業量はそのままでプレビューを作り直して。',
    continuation: '受理した8月28日23時30分から翌29日1時30分だけという条件でプレビューを作って。' },
]);
const CASES = TEMPORAL ? TEMPORAL_CASES : CORRECTION_CASES;
const nav = page => page.getByRole('navigation', { name: '主要ナビゲーション' });
const composer = page => page.locator('.ai-planning-composer textarea');
const preview = page => page.getByRole('dialog', { name: '計画プレビュー', exact: true });
const digest = value => createHash('sha256').update(value).digest('hex');
const sort = rows => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const pick = row => ({ title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime });

async function checkpoint(page) {
  return page.evaluate(owner => {
    const rawIndex = localStorage.getItem(`studyplanner.weeklyPlanning.activeSession.${owner}`);
    if (!rawIndex) return null;
    const index = JSON.parse(rawIndex);
    if (index.ownerId !== owner || !index.weekStartDate) return null;
    const raw = localStorage.getItem(`studyplanner.weeklyPlanning.stableV5.${owner}.${index.weekStartDate}`);
    return raw ? JSON.parse(raw) : null;
  }, OWNER);
}
function active(graph, field) {
  expect(Array.isArray(graph.factLifecycles), 'required lifecycle observer').toBe(true);
  expect(Array.isArray(graph[field]), `required ${field} observer`).toBe(true);
  const ids = new Set(graph.factLifecycles.filter(row => row.status === 'active').map(row => row.factId));
  return graph[field].filter(row => ids.has(row.id));
}
function requireGraph(snapshot) {
  expect(snapshot?.ownerId).toBe(OWNER);
  expect(typeof snapshot?.conversationId).toBe('string');
  expect(snapshot.conversationId.length).toBeGreaterThan(0);
  expect(Number.isSafeInteger(snapshot.graph?.revision)).toBe(true);
  expect(Array.isArray(snapshot.planningState?.messages)).toBe(true);
  const graph = snapshot.graph;
  expect(Array.isArray(graph.factLifecycles), 'required lifecycle observer').toBe(true);
  const activeIds = new Set(graph.factLifecycles.filter(row => row.status === 'active').map(row => row.factId));
  // Independent typed-reference oracle. Operation targets intentionally keep history.
  const references = {
    studyContexts: ['taskId'], components: ['taskId', 'parentComponentId'],
    workloads: ['taskId', 'componentId'], effortEstimates: ['taskId', 'targetFactId'],
    temporalConstraints: ['taskId', 'targetFactId'], taskDateRules: ['taskId', 'targetFactId'],
    recurrences: ['taskId', 'targetFactId'], relations: ['fromTaskId', 'toTaskId'],
    uncertainties: ['targetFactId'],
  };
  for (const [field, keys] of Object.entries(references)) {
    for (const fact of active(graph, field)) for (const key of keys) {
      const nullable = key === 'parentComponentId' || key === 'componentId' || field === 'uncertainties';
      if (nullable && fact[key] === null) continue;
      expect(typeof fact[key], `${field}.${key} requires a target identity`).toBe('string');
      expect(activeIds.has(fact[key]), `${field}.${key} must target a current fact`).toBe(true);
    }
  }
  return graph;
}
async function plans(page) {
  const rows = await page.evaluate(() => {
    const read = key => JSON.parse(localStorage.getItem(key) ?? '[]');
    const pick = row => ({ id: row.id, userId: row.userId, title: row.title, date: row.date,
      startTime: row.startTime, endTime: row.endTime });
    return [...read('studyplanner.plans').map(pick), ...read('studyplanner.scheduleEvents.v1')
      .filter(row => row.provenance?.legacy?.kind === 'plan')
      .map(row => pick({ ...row, id: row.provenance.legacy.id }))];
  });
  for (const row of rows) {
    expect(row.userId, 'fresh synthetic profile cannot write another owner').toBe(OWNER);
    expect(typeof row.id).toBe('string');
    expect(row.id.length).toBeGreaterThan(0);
  }
  return rows;
}
async function assertNoImplicitPlanWrites(page, observations, scenario, stage) {
  const writes = await page.evaluate(() => window.__plannerRecoveryStorageWrites
    ?.filter(row => ['studyplanner.plans', 'studyplanner.scheduleEvents.v1'].includes(row.key)));
  expect(Array.isArray(writes), 'coverage incomplete: durable write observer missing').toBe(true);
  const planWrites = writes.filter(row => {
    const rows = JSON.parse(row.value);
    expect(Array.isArray(rows), 'durable repository values must be arrays').toBe(true);
    return row.key === 'studyplanner.plans' ? rows.length > 0
      : rows.some(event => event.provenance?.legacy?.kind === 'plan');
  });
  observations.push({ kind: 'preapproval-plan-writes', scenario: scenario.id, stage,
    inspectedWrites: writes.length, planWrites });
  // Empty bootstrap writes are harmless; even a later-deleted Plan is an implicit write.
  expect(planWrites, 'no Plan may be written before explicit approval').toEqual([]);
}
function assertWorkFacts(snapshot, scenario) {
  const graph = requireGraph(snapshot);
  expect(active(graph, 'workloads')).toEqual(expect.arrayContaining([
    expect.objectContaining({ quantityRole: 'target', amount: scenario.amount, unitCode: 'problem' }),
  ]));
  const targetWork = active(graph, 'workloads').filter(row => row.quantityRole === 'target' && row.unitCode === 'problem');
  expect(targetWork.reduce((sum, row) => sum + row.amount, 0), 'no old workload remains current').toBe(scenario.amount);
  const efforts = active(graph, 'effortEstimates');
  expect(efforts.filter(row => row.kind === 'duration_per_unit').map(row => row.minutes)).toEqual([scenario.pace]);
  expect(efforts.filter(row => row.kind === 'session_duration').map(row => row.minutes)).toEqual([scenario.session]);
  return { graph, targetWork, efforts };
}
function assertCandidateIntegrity(snapshot, scenario, previousCandidates, allowed) {
  const { graph, targetWork, efforts } = assertWorkFacts(snapshot, scenario);
  const candidates = snapshot.planningState.previewCandidates;
  expect(Array.isArray(candidates)).toBe(true);
  expect(candidates.length).toBeGreaterThan(0);
  const currentIds = new Set(graph.factLifecycles.filter(row => row.status === 'active').map(row => row.factId));
  const oldKeys = new Set(previousCandidates.map(row => row.stableKey));
  expect(new Set(candidates.map(row => row.stableKey)).size, 'candidate identities must be unique').toBe(candidates.length);
  const ordered = [...candidates].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    if (previous.date === ordered[index].date) {
      expect(previous.endTime <= ordered[index].startTime, 'candidate intervals must not overlap').toBe(true);
    }
  }
  const pace = efforts.find(row => row.kind === 'duration_per_unit');
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  // Independent accepted-cap oracles, with no observations/calibration in this fresh profile:
  // 20×3 / cap30 => two whole 10-question blocks / [30,30], total60.
  // 40×2 / cap20 => four whole 10-question blocks / [20,20,20,20], total80.
  // Uncapped buffer/rounding was70/90; cap priority leaves no margin in THESE cases.
  // Separate compiler control 40×2 / cap30 remains [30,30,30], total90, margin10.
  expect(candidates.map(row => row.durationMinutes).sort((a, b) => a - b)).toEqual([...scenario.durations].sort((a, b) => a - b));
  expect(candidates.reduce((sum, row) => sum + row.durationMinutes, 0), 'exact occupied total under accepted session cap')
    .toBe(scenario.durations.reduce((sum, value) => sum + value, 0));
  const taskIds = [...new Set(targetWork.map(row => row.taskId))];
  expect(taskIds, 'fixture work remains on one canonical task').toHaveLength(1);
  const session = efforts.find(row => row.kind === 'session_duration');
  expect(pace.taskId).toBe(taskIds[0]);
  expect(session.taskId).toBe(taskIds[0]);
  for (const candidate of candidates) {
    expect(oldKeys.has(candidate.stableKey), 'old preview identity cannot survive an accepted correction').toBe(false);
    expect(candidate.approvalStatus).toBe('unapproved');
    expect(candidate.durationMinutes).toBeLessThanOrEqual(scenario.session);
    expect(candidate.durationMinutes).toBe(minutes(candidate.endTime) - minutes(candidate.startTime));
    expect(candidate.estimatedMinutes).toBe(candidate.durationMinutes);
    const metadata = candidate.stableV5Metadata;
    expect(metadata).toMatchObject({ runtime: 'stable_v5', conversationId: snapshot.conversationId, graphRevision: graph.revision });
    expect(active(graph, 'tasks').some(row => row.id === metadata.taskId)).toBe(true);
    expect(metadata.taskId).toBe(taskIds[0]);
    expect(Array.isArray(metadata.sourceFactRefs)).toBe(true);
    for (const ref of metadata.sourceFactRefs) expect(currentIds.has(ref), 'candidate cannot depend on retired facts').toBe(true);
    expect(metadata.sourceFactRefs).toEqual(expect.arrayContaining([pace.id, session.id]));
    expect(targetWork.filter(row => row.taskId === metadata.taskId && metadata.sourceFactRefs.includes(row.id))).not.toHaveLength(0);
    expect(allowed(candidate), 'candidate must satisfy accepted date/clock boundaries').toBe(true);
    expect(candidate.endTime > candidate.startTime).toBe(true);
  }
  return candidates;
}
function assertExpectedFacts(snapshot, scenario, previousCandidates = []) {
  const { graph, targetWork } = assertWorkFacts(snapshot, scenario);
  const windows = active(graph, 'planningWindows');
  expect(windows).toEqual([expect.objectContaining({ start: scenario.start, end: scenario.end })]);
  // Observe the original supported C2 seam, rather than infer a hard clock from output/ref labels.
  expect(active(graph, 'temporalConstraints').some(row => row.kind === 'earliest_start'
    && row.constraintLevel === 'hard' && row.dateExpression === null && row.startTime === '20:00'
    && row.taskId === targetWork[0].taskId && row.targetFactId === targetWork[0].taskId),
  'coverage incomplete: accepted task-scoped dateless hard20:00 was not observed').toBe(true);
  return assertCandidateIntegrity(snapshot, scenario, previousCandidates,
    row => row.date >= scenario.start && row.date <= scenario.end && row.startTime >= '20:00');
}

const TEMPORAL_WORK = Object.freeze({ amount: 12, pace: 5, session: 30, durations: [30, 30] });
function validDate(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function acceptedTemporalDates(snapshot, startDate, endDate) {
  const { graph } = assertWorkFacts(snapshot, TEMPORAL_WORK);
  expect(active(graph, 'workloads')).toEqual([expect.objectContaining({
    quantityRole: 'target', amount: 12, unitCode: 'problem',
  })]);
  const windows = active(graph, 'planningWindows');
  expect(windows).toHaveLength(1);
  const window = windows[0];
  // The accepted-window owner gives explicit endpoints priority, then the latest valid frozen range.
  // An old matching grounding record cannot excuse a different current accepted range.
  if (window.start && window.end) {
    expect({ startDate: window.start, endDate: window.end }).toEqual({ startDate, endDate });
  } else {
    const frozen = [...(snapshot.planningState.intakeState?.groundingRecords ?? [])].reverse().find(row =>
      row.targetFactId === window.id && row.status !== 'rejected'
      && validDate(row.startDate) && validDate(row.endDate) && row.startDate <= row.endDate);
    expect(frozen, 'coverage incomplete: no established accepted date range').toBeTruthy();
    expect({ startDate: frozen.startDate, endDate: frozen.endDate }).toEqual({ startDate, endDate });
  }
  return graph;
}
async function assertNoPreviewApproval(page, snapshot) {
  expect(snapshot.planningState.previewCandidates, 'accepted unresolved correction invalidates the old preview').toEqual([]);
  expect(snapshot.planningState.draftBlocks).toEqual([]);
  await expect(page.getByRole('button', { name: '計画プレビューを確認', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'この内容で仮予定にする', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'この内容で保存', exact: true })).toHaveCount(0);
  expect(await plans(page)).toEqual([]);
}
async function temporalConversation({ page, first, scenario, submit, evidenceDir, observations }) {
  const graph = acceptedTemporalDates(first, '2026-08-24', '2026-08-30');
  const taskId = active(graph, 'workloads')[0].taskId;
  const taskScope = scenario.id === 'task-weekday-scope-repair';
  const preferredField = taskScope ? 'temporalConstraints' : 'availabilityDeclarations';
  const preferences = active(graph, preferredField).filter(row =>
    (taskScope ? row.kind === 'preferred_window' && row.taskId === taskId && row.targetFactId === taskId
      : ['preferred', 'available'].includes(row.kind))
    && row.constraintLevel === 'soft' && row.dateExpression === 'weekday:friday'
    && row.startTime === '20:00' && row.endTime === '22:00');
  expect(preferences, 'coverage incomplete: required canonical Friday scope was not emitted').toHaveLength(1);
  const originalPreference = preferences[0];
  const initialCandidates = assertCandidateIntegrity(first, TEMPORAL_WORK, [],
    row => row.date === '2026-08-28' && row.startTime >= '20:00' && row.endTime <= '22:00');
  await inspectPreview(page, initialCandidates, { id: `${scenario.id}-initial` }, evidenceDir, observations);
  await preview(page).getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(preview(page)).toHaveCount(0);
  let final = await submit(scenario.correction);
  expect(final.conversationId).toBe(first.conversationId);
  expect(final.graph.revision).toBeGreaterThan(first.graph.revision);
  if (taskScope) {
    acceptedTemporalDates(final, '2026-08-24', '2026-08-26');
    expect(active(final.graph, preferredField).find(row => row.id === originalPreference.id)).toEqual(originalPreference);
    expect(final.planningState.intakeState?.lastQuestionContext?.targetSlot)
      .toBe('stable_v5:preferred_date_outside_planning_window');
    await assertNoPreviewApproval(page, final);
    observations.push({ kind: 'accepted-temporal-preview-invalidated', scenario: scenario.id, checkpoint: final });
    final = await submit(scenario.continuation);
    acceptedTemporalDates(final, '2026-08-24', '2026-08-26');
    const dates = active(final.graph, 'temporalConstraints').filter(row => row.kind === 'preferred_window');
    expect(dates.some(row => row.taskId === taskId && row.targetFactId === taskId
      && row.constraintLevel === 'soft' && ['weekday:wednesday', '2026-08-26'].includes(row.dateExpression)
      && row.startTime === '20:00' && row.endTime === '22:00')).toBe(true);
    expect(dates.some(row => row.id === originalPreference.id || row.dateExpression === 'weekday:friday')).toBe(false);
    assertCandidateIntegrity(final, TEMPORAL_WORK, initialCandidates,
      row => row.date === '2026-08-26' && row.startTime >= '20:00' && row.endTime <= '22:00');
  } else {
    if (!final.planningState.previewCandidates?.length) {
      const intake = final.planningState.intakeState;
      expect(intake?.draftGenerationIntent).toBe('assistant_suggested');
      expect(intake?.lastQuestionContext, 'no invented reply to an unrelated question').toBeUndefined();
      final = await submit(scenario.continuation);
    }
    const after = acceptedTemporalDates(final, '2026-08-24', '2026-08-30');
    const availability = active(after, 'availabilityDeclarations');
    expect(availability.filter(row => row.kind === 'available' && row.constraintLevel === 'hard'),
      'coverage incomplete: the accepted only-available interval must not be widened')
      .toEqual([expect.objectContaining({ dateExpression: '2026-08-28', startTime: '23:30', endTime: '01:30' })]);
    expect(availability.some(row => row.id === originalPreference.id
      || (['preferred', 'available'].includes(row.kind) && row.constraintLevel === 'soft'
        && row.dateExpression === 'weekday:friday' && row.startTime === '20:00'))).toBe(false);
    const candidates = assertCandidateIntegrity(final, TEMPORAL_WORK, initialCandidates, row =>
      (row.date === '2026-08-28' && row.startTime >= '23:30' && row.endTime <= '24:00')
      || (row.date === '2026-08-29' && row.startTime >= '00:00' && row.endTime <= '01:30'));
    expect(candidates.some(row => row.date === '2026-08-29'), 'must actually place after midnight').toBe(true);
  }
  expect(active(final.graph, 'workloads')[0].taskId).toBe(taskId);
  expect(final.conversationId).toBe(first.conversationId);
  expect(final.graph.revision).toBeGreaterThan(first.graph.revision);
  expect(final.planningState.previewCandidates).not.toEqual(initialCandidates);
  return { final, initialCandidates };
}

function assertPairedCorrectionSeam(first, corrected) {
  const oldWork = active(first.graph, 'workloads').filter(row => row.quantityRole === 'target' && row.unitCode === 'problem');
  const oldPace = active(first.graph, 'effortEstimates').filter(row => row.kind === 'duration_per_unit');
  expect(oldWork, 'coverage incomplete: one original workload is required').toHaveLength(1);
  expect(oldPace, 'coverage incomplete: one original per-unit effort is required').toHaveLength(1);
  expect(oldPace[0].targetFactId, 'coverage incomplete: original effort must depend on the corrected workload').toBe(oldWork[0].id);
  const corrections = corrected.graph.correctionIntents.filter(row => row.createdRevision > first.graph.revision);
  const workCorrection = corrections.find(row => row.target.kind === 'workload' && row.target.factId === oldWork[0].id);
  const effortCorrection = corrections.find(row => row.target.kind === 'effort_estimate' && row.target.factId === oldPace[0].id);
  expect(workCorrection, 'coverage incomplete: explicit workload correction not observed').toBeTruthy();
  expect(effortCorrection, 'coverage incomplete: explicit dependent effort correction not observed').toBeTruthy();
  expect(['replace', 'modify']).toContain(workCorrection.operation);
  expect(['replace', 'modify']).toContain(effortCorrection.operation);
  expect(effortCorrection.createdRevision).toBe(workCorrection.createdRevision);
  expect(effortCorrection.source.turnId).toBe(workCorrection.source.turnId);
  const newWork = active(corrected.graph, 'workloads').find(row => row.id === workCorrection.replacementFactId);
  const newPace = active(corrected.graph, 'effortEstimates').find(row => row.id === effortCorrection.replacementFactId);
  expect(newWork).toMatchObject({ taskId: oldWork[0].taskId, amount: 40 });
  expect(newPace).toMatchObject({ taskId: oldPace[0].taskId, targetFactId: newWork.id, kind: 'duration_per_unit', minutes: 2 });
  expect(active(corrected.graph, 'workloads').some(row => row.id === oldWork[0].id)).toBe(false);
  expect(active(corrected.graph, 'effortEstimates').some(row => row.id === oldPace[0].id)).toBe(false);
  return { pairedWorkloadEffort: true, corrections };
}

function rendererInputProjection(messages) {
  const bodies = messages.filter(row => row.role === 'user').flatMap(row => {
    try {
      const parsed = JSON.parse(row.content);
      return typeof parsed?.actionId === 'string' && parsed.applicationDecision ? [parsed] : [];
    } catch { return []; }
  });
  if (bodies.length !== 1) throw new Error('Renderer request projection is missing or ambiguous.');
  const { actionId, applicationDecision: decision } = bodies[0];
  return { actionId, actionKind: decision.actionKind, questionCode: decision.questionCode,
    previewCount: decision.previewCount, previewEvidence: decision.previewEvidence ?? null };
}
function assertRendererInput(snapshot, renderer, receipt) {
  const wire = receipt.rendererInput;
  expect(wire, 'coverage incomplete: actual renderer input missing').toBeTruthy();
  expect(wire.actionId).toBe(renderer.actionId);
  expect(wire.actionKind).toBe(renderer.actionKind);
  expect(wire.questionCode).toBe(renderer.questionCode);
  const context = renderer.request?.promptContext;
  expect(context?.traceTruncated, 'coverage incomplete: renderer prompt context truncated').not.toBe(true);
  expect(Array.isArray(context?.messages), 'coverage incomplete: persisted renderer prompt missing').toBe(true);
  // Repair adds a plain instruction; the structured decision is unchanged. Compare that exact projection.
  expect(rendererInputProjection(context.messages)).toEqual(wire);
  if (wire.actionKind !== 'preview_ready') {
    expect(wire.previewEvidence).toBeNull();
    expect(wire.previewCount).toBe(0);
    return;
  }
  const candidates = snapshot.planningState.previewCandidates;
  expect(candidates.length).toBeGreaterThan(0);
  expect(wire.previewCount).toBe(candidates.length);
  const evidence = wire.previewEvidence;
  expect(evidence).toMatchObject({ status: 'available', graphRevision: snapshot.graph.revision,
    phase: 'generated_preview', constraintEvaluation: 'not_evaluated' });
  expect(evidence.summary).toEqual({ scope: 'all_candidates', candidateCount: candidates.length,
    totalDurationMinutes: candidates.reduce((sum, row) => sum + row.durationMinutes, 0),
    minDurationMinutes: Math.min(...candidates.map(row => row.durationMinutes)),
    maxDurationMinutes: Math.max(...candidates.map(row => row.durationMinutes)),
    earliestStartTime: candidates.map(row => row.startTime).sort()[0],
    latestEndTime: candidates.map(row => row.endTime).sort().at(-1) });
  expect(Buffer.byteLength(JSON.stringify(evidence))).toBeLessThanOrEqual(4 * 1024);
  const details = evidence.details;
  expect(details.candidates.length).toBeLessThanOrEqual(8);
  expect(new Set(details.candidates.map(row => row.candidateKey)).size).toBe(details.candidates.length);
  expect(details.omittedCount).toBe(candidates.length - details.candidates.length);
  expect(details.coverage).toBe(details.omittedCount === 0 ? 'complete' : 'partial');
  for (const row of details.candidates) {
    const actual = candidates.find(candidate => candidate.stableKey === row.candidateKey);
    expect(actual, 'detail must name a candidate of this actual preview').toBeTruthy();
    expect(row).toEqual({ candidateKey: actual.stableKey, taskId: actual.stableV5Metadata.taskId,
      workItemKey: actual.workItemKey, date: actual.date, startTime: actual.startTime, endTime: actual.endTime,
      durationMinutes: actual.durationMinutes, approvalStatus: actual.approvalStatus,
      sourceFactRefs: actual.stableV5Metadata.sourceFactRefs });
  }
}

function assertAdoptedRendererReceipt(renderer, receipts) {
  // ACK metadata can be repaired without changing text; select the final response before matching.
  const adopted = receipts.filter(row => row.schema === 'weekly_planning_stable_v5_dialogue_response')
    .sort((a, b) => a.ordinal - b.ordinal).at(-1);
  expect(adopted, 'coverage incomplete: no real renderer receipt for this turn').toBeTruthy();
  expect(typeof adopted.modelOutput).toBe('string');
  expect(typeof renderer.response.rawResponse).toBe('string');
  expect(renderer.response.rawResponse.includes('…[trace truncated]'),
    'coverage incomplete: adopted raw renderer response was truncated').toBe(false);
  // The direct client trims complete content, without normalizing its JSON bytes.
  expect(adopted.modelOutput.trim()).toBe(renderer.response.rawResponse);
  const output = JSON.parse(adopted.modelOutput);
  expect(output.actionId).toBe(renderer.actionId);
  expect(typeof output.text).toBe('string');
  expect(output.text.replace(/\r\n/g, '\n').trim()).toBe(renderer.response.renderedText);
  return adopted;
}

async function inspectRendererAdoption(page, snapshot, receipts, text, scenario, evidenceDir, observations) {
  const sequence = snapshot.planningState.conversationRequestSequence;
  expect(Number.isSafeInteger(sequence) && sequence > 0).toBe(true);
  const requestId = `${snapshot.conversationId}:request:${sequence}`;
  let observation;
  await expect.poll(async () => {
    observation = await page.evaluate(({ ownerId, conversationId, requestId, text }) => {
      const entries = JSON.parse(localStorage.getItem('studyplanner-weekly-planning-trace-entries-v1') ?? '[]');
      const diagnostic = entries.find(row => row.kind === 'turn_diagnostic' && row.userId === ownerId
        && row.logicalConversationId === conversationId && row.requestId === requestId && row.userInput?.text === text);
      if (diagnostic?.diagnostics?.dialogueRenderer) return { storage: 'local_trace', requestId: diagnostic.requestId,
        renderer: diagnostic.diagnostics.dialogueRenderer, truncation: diagnostic.diagnostics.truncation ?? null,
        assistantMessage: diagnostic.assistantOutput.text,
        responseSource: diagnostic.assistantOutput.responseSource };
      // Existing local v2 trace ownership rejection can queue the real input instead.
      // Observe that durable input; an empty entries array is not evidence of fallback.
      const outbox = JSON.parse(localStorage.getItem('studyplanner.weeklyPlanning.trace.outbox.v1') ?? 'null');
      const queued = outbox?.version === 'studyplanner-weekly-planning-trace-outbox-v1'
        ? outbox.items.find(row => row.version === outbox.version && row.input.userId === ownerId
          && row.input.conversationId === conversationId && row.input.requestId === requestId && row.input.userText === text)?.input : null;
      return queued?.dialogueRendererTrace ? { storage: 'trace_outbox', requestId: queued.requestId,
        renderer: queued.dialogueRendererTrace, assistantMessage: queued.assistantMessage,
        responseSource: queued.responseSource } : null;
    }, { ownerId: OWNER, conversationId: snapshot.conversationId, requestId, text });
    return Boolean(observation);
  }).toBe(true);
  const renderer = observation.renderer;
  const assistant = snapshot.planningState.messages.at(-1).content;
  const captured = { kind: 'renderer-observation', scenario: scenario.id, ...observation, assistant };
  observations.push(captured);
  captured.visibleAssistantText = await page.locator('.weekly-planning-chat-message--assistant p').last().innerText();
  expect(renderer.actionId?.startsWith(`stable-v5:${requestId}:`), 'renderer must belong to the same committed request').toBe(true);
  expect(renderer.decision, 'coverage incomplete: captured renderer decision must show actual AI adoption')
    .toMatchObject({ branch: 'ai_rendered', responseSource: 'ai', finalMessage: assistant });
  expect(renderer.response.status).toBe('rendered');
  for (const value of [renderer.response.renderedText, renderer.decision.finalMessage]) {
    expect(typeof value, 'coverage incomplete: adopted renderer observation must contain text').toBe('string');
    expect(value.includes('…[trace truncated]'), 'coverage incomplete: bounded renderer observation was truncated').toBe(false);
  }
  expect(observation.assistantMessage).toBe(assistant);
  expect(observation.responseSource).toBe('ai');
  const adopted = assertAdoptedRendererReceipt(renderer, receipts);
  assertRendererInput(snapshot, renderer, adopted);
  expect(renderer.response.renderedText).toBe(assistant);
  if (renderer.actionKind === 'question') {
    const question = snapshot.planningState.intakeState?.lastQuestionContext;
    const latest = snapshot.planningState.messages.at(-1);
    expect(question?.targetSlot).toBe(`stable_v5:${renderer.questionCode}`);
    expect(latest.role).toBe('assistant');
    expect(latest.id).toBe(`${snapshot.conversationId}:turn:${sequence}:assistant`);
    expect(Number.isSafeInteger(snapshot.planningState.revision) && snapshot.planningState.revision >= 0).toBe(true);
    expect(question.presentation, 'coverage incomplete: question must bind to its actual presenting commit')
      .toMatchObject({ version: 1, turnId: `${snapshot.conversationId}:turn:${sequence}`,
        assistantMessageId: latest.id, planningStateRevision: snapshot.planningState.revision,
        graphRevision: snapshot.graph.revision, content: { responseSource: 'ai' } });
  }
  await expect(page.locator('.weekly-planning-chat-message--assistant p').last()).toHaveText(assistant);
  observations.push({ kind: 'renderer-adoption', scenario: scenario.id, requestId: observation.requestId, storage: observation.storage,
    renderer, providerOrdinal: adopted.ordinal, assistant, naturalness: 'requires human artifact review' });
  await page.screenshot({ path: path.join(evidenceDir, `${scenario.id}-turn-${snapshot.planningState.messages.filter(row => row.role === 'user').length}.png`), fullPage: true });
}

// The real visible calendar columns and hour markers form an independent DOM oracle.
async function inspectPreview(page, candidates, scenario, evidenceDir, observations) {
  await page.getByRole('button', { name: '計画プレビューを確認', exact: true }).click();
  await expect(preview(page)).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const dom = await preview(page).evaluate(root => {
      const labels = [...root.querySelectorAll('.ai-planning-week-header > div strong')].map(el => el.textContent);
      const columns = [...root.querySelectorAll('.ai-planning-week-body > .ai-planning-day-column')];
      // Labels are translated by -50%; their centers, not their tops, mark hours.
      const axis = [...root.querySelectorAll('.ai-planning-time-axis > span')].map(el => {
        const rect = el.getBoundingClientRect();
        return { text: el.textContent, center: rect.top + rect.height / 2 };
      });
      return { labels, axis, blocks: columns.flatMap((column, index) => [...column.querySelectorAll('.ai-planning-draft-block')].map(el => ({
        dateLabel: labels[index], title: el.querySelector('strong')?.textContent,
        time: el.querySelector('small')?.textContent.trim(), top: el.getBoundingClientRect().top,
        height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width,
      }))) };
    });
    expect(dom.labels.length).toBeGreaterThan(0);
    expect(dom.blocks).toHaveLength(candidates.length);
    expect(dom.axis.length).toBeGreaterThan(1);
    const firstMinute = Number(dom.axis[0].text.slice(0, 2)) * 60;
    const pixelsPerMinute = (dom.axis[1].center - dom.axis[0].center) / 60;
    expect(pixelsPerMinute).toBeGreaterThan(0);
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    for (const candidate of candidates) {
      const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(`${candidate.date}T00:00:00Z`).getUTCDay()];
      const label = `${Number(candidate.date.slice(5, 7))}/${Number(candidate.date.slice(8))} ${weekday}`;
      const matches = dom.blocks.filter(row => row.dateLabel === label && row.title === candidate.title
        && row.time === `${candidate.startTime}-${candidate.endTime}`);
      expect(matches, 'candidate date/title/clock must match the rendered column').toHaveLength(1);
      const block = matches[0];
      expect(block.width).toBeGreaterThan(0);
      expect(Math.abs(block.top - (dom.axis[0].center + (minutes(candidate.startTime) - firstMinute) * pixelsPerMinute))).toBeLessThan(3);
      // Main can intentionally impose a minimum visual height on short blocks.
      expect(block.height).toBeGreaterThanOrEqual(Math.max(12, (minutes(candidate.endTime) - minutes(candidate.startTime)) * pixelsPerMinute) - 1);
    }
    observations.push({ kind: 'preview-dom', scenario: scenario.id, width, dom });
    await page.screenshot({ path: path.join(evidenceDir, `${scenario.id}-${width}.png`), fullPage: true });
  }
}

async function saveAndReload(page, candidates, observations, scenario) {
  expect(await plans(page), 'no save before explicit approval').toEqual([]);
  await assertNoImplicitPlanWrites(page, observations, scenario, 'before-promotion');
  await preview(page).getByRole('button', { name: 'この内容で仮予定にする', exact: true }).click();
  const approve = preview(page).getByRole('button', { name: 'この内容で保存', exact: true });
  await expect(approve).toBeEnabled();
  expect(await plans(page), 'promotion is not approval and cannot persist plans').toEqual([]);
  await assertNoImplicitPlanWrites(page, observations, scenario, 'after-promotion-before-approval');
  await approve.evaluate(button => { button.click(); button.click(); });
  await expect(preview(page)).toHaveCount(0);
  await expect.poll(async () => (await plans(page)).length).toBe(candidates.length);
  const saved = await plans(page);
  expect(new Set(saved.map(row => row.id)).size).toBe(saved.length);
  expect(sort(saved.map(pick))).toEqual(sort(candidates.map(pick)));
  await page.evaluate(() => sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true'));
  await page.reload();
  await expect(nav(page)).toBeVisible();
  expect(sort(await plans(page))).toEqual(sort(saved));
  await nav(page).getByRole('button', { name: 'AI計画', exact: true }).click();
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'この内容で保存', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'この内容で仮予定にする', exact: true })).toHaveCount(0);
  observations.push({ kind: 'local-save-reload', scenario: scenario.id, saved });
}

test('two bounded real-model conversations through the production App', async ({ browser }, testInfo) => {
  test.skip(!ENABLED, 'Explicit dispatch-only profile required.');
  // CLI overrides must not silently multiply authorized calls across workers/retries/repetitions.
  expect(testInfo.config.workers).toBe(1);
  expect(testInfo.config.projects).toHaveLength(1);
  expect(testInfo.config.projects[0].name).toBe('chromium');
  expect(testInfo.config.maxFailures).toBe(1);
  expect(testInfo.project.use.trace).toBe('off');
  expect(testInfo.project.use.video).toBe('off');
  expect(testInfo.project.use.recordHar).toBeUndefined();
  expect(testInfo.project.use.launchOptions.env.OPENAI_API_KEY === '', 'browser credential must be scrubbed').toBe(true);
  expect(testInfo.project.use.launchOptions.env.VITE_AI_API_KEY === '', 'browser Vite credential must be scrubbed').toBe(true);
  expect(testInfo.project.retries).toBe(0);
  expect(testInfo.project.repeatEach).toBe(1);
  expect(testInfo.retry).toBe(0);
  expect(testInfo.repeatEachIndex).toBe(0);
  expect(testInfo.project.name).toBe('chromium');
  const key = process.env.OPENAI_API_KEY;
  if (!key?.trim()) throw new Error('OPENAI_API_KEY is not configured; no provider request was made.');
  const evidenceDir = path.resolve(TEMPORAL ? 'artifacts/weekly-temporal-real-api/evidence' : 'artifacts/weekly-correction-real-api/evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const state = { outcome: 'incomplete', calls: 0, turns: 0, completedCases: [], failure: null, receipts: [], observations: [], externalRequests: [] };
  const api = await request.newContext({ timeout: LIMITS.requestMs, ignoreHTTPSErrors: false });
  const check = () => { if (state.failure) throw new Error(state.failure); };
  const fail = code => { state.failure ??= code; };
  try {
    expect(CASES).toHaveLength(LIMITS.cases);
    for (const scenario of CASES) {
      const scenarioState = { calls: 0, turns: 0, deadline: Date.now() + LIMITS.caseMs };
      const context = await newFixedClockContext(browser, { viewport: { width: 1280, height: 844 }, serviceWorkers: 'block' });
      await context.route('**/*', async route => {
        const incoming = route.request();
        const url = new URL(incoming.url());
        if (incoming.url() !== LOCAL_API) {
          if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
            && ['http:', 'https:'].includes(url.protocol)) return route.continue();
          state.externalRequests.push({ origin: url.origin });
          fail('Unexpected external browser request; no further provider call is allowed.');
          return route.abort();
        }
        const raw = incoming.postData();
        let body;
        try { body = JSON.parse(raw); } catch { /* Invalid shape fails closed below. */ }
        const allowedKeys = ['model', 'messages', 'temperature', 'response_format', 'max_completion_tokens'];
        if (state.failure || incoming.method() !== 'POST' || !body || body.model !== MODEL
          || !Array.isArray(body.messages) || body.messages.length === 0
          || body.messages.some(message => !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')
          || Object.keys(body).some(name => !allowedKeys.includes(name))
          || body.response_format?.type !== 'json_schema' || typeof body.response_format?.json_schema?.name !== 'string'
          || typeof raw !== 'string' || Buffer.byteLength(raw) > 262_144) {
          fail('Unexpected production request shape or stopped run; provider forwarding refused.');
        } else if (state.calls >= LIMITS.calls || scenarioState.calls >= LIMITS.callsPerCase || Date.now() >= scenarioState.deadline) {
          fail('Approved provider request/time budget exhausted; checkpoint is incomplete.');
        }
        if (state.failure) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"evaluation_stopped"}}' });
        let rendererInput;
        if (body.response_format.json_schema.name === 'weekly_planning_stable_v5_dialogue_response') {
          try { rendererInput = rendererInputProjection(body.messages); } catch {
            fail('Actual renderer input observation failed; provider forwarding refused.');
            return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"evaluation_stopped"}}' });
          }
        }
        state.calls += 1;
        scenarioState.calls += 1;
        const receipt = { scenario: scenario.id, ordinal: state.calls, schema: body.response_format.json_schema.name,
          model: body.model, requestSha256: digest(raw), ...(rendererInput ? { rendererInput } : {}) };
        state.receipts.push(receipt);
        try {
          // Preserve the production payload byte-for-byte. Only destination/auth differ.
          const response = await api.post(PROVIDER_API, { data: raw, headers: {
            'Content-Type': 'application/json', Authorization: `Bearer ${key}`,
          }, timeout: Math.max(1, Math.min(LIMITS.requestMs, scenarioState.deadline - Date.now())), maxRetries: 0, maxRedirects: 0 });
          receipt.status = response.status();
          if (!response.ok()) {
            // Never return/log arbitrary auth error text (it may contain credential fragments).
            fail(`Official provider returned HTTP ${response.status()}; no retry was made.`);
            return route.fulfill({ status: response.status(), contentType: 'application/json', body: '{"error":{"code":"evaluation_provider_failure"}}' });
          }
          const result = await response.body();
          const parsed = JSON.parse(result.toString('utf8'));
          receipt.responseSha256 = digest(result);
          receipt.providerId = parsed.id;
          receipt.returnedModel = parsed.model;
          receipt.usage = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens']
            .filter(name => Number.isSafeInteger(parsed.usage?.[name])).map(name => [name, parsed.usage[name]]));
          receipt.modelOutput = parsed.choices?.[0]?.message?.content;
          // No authored semantic reply, normalization, repair or response-schema translation.
          return route.fulfill({ status: response.status(), contentType: 'application/json', body: result });
        } catch {
          fail('Official provider transport/response failed; details suppressed to protect credentials.');
          return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"evaluation_transport_failure"}}' });
        }
      });
      let page;
      try {
        page = await context.newPage();
        await page.goto(HARNESS);
        await expect(nav(page)).toBeVisible();
        await nav(page).getByRole('button', { name: 'AI計画', exact: true }).click();
        await expect(composer(page)).toBeEnabled();
        expect(await plans(page)).toEqual([]);
        const submit = async text => {
          check();
          if (state.turns >= LIMITS.turns || scenarioState.turns >= LIMITS.turnsPerCase || Date.now() >= scenarioState.deadline) {
            throw new Error('Approved user-turn/time budget exhausted; no extra turn is allowed.');
          }
          state.turns += 1; scenarioState.turns += 1;
          const callsBefore = state.calls;
          await composer(page).fill(text);
          await composer(page).press('Enter');
          await expect.poll(async () => {
            check();
            const snap = await checkpoint(page);
            const messages = snap?.planningState?.messages;
            return state.calls > callsBefore && Array.isArray(messages)
              && messages.filter(row => row.role === 'user').at(-1)?.content === text
              && messages.at(-1)?.role === 'assistant' && await composer(page).isEnabled();
          }, { timeout: Math.max(1, Math.min(LIMITS.turnMs, scenarioState.deadline - Date.now())) }).toBe(true);
          check();
          const snap = await checkpoint(page);
          state.observations.push({ kind: 'observed-checkpoint', scenario: scenario.id, turn: scenarioState.turns, checkpoint: snap });
          requireGraph(snap);
          await inspectRendererAdoption(page, snap, state.receipts.slice(callsBefore), text, scenario, evidenceDir, state.observations);
          expect(await plans(page), 'conversation and preview never save implicitly').toEqual([]);
          await assertNoImplicitPlanWrites(page, state.observations, scenario, `turn-${scenarioState.turns}`);
          return snap;
        };
        const first = await submit(scenario.initial ?? INITIAL);
        let firstCandidates;
        let final;
        if (TEMPORAL) {
          const temporal = await temporalConversation({ page, first, scenario, submit, evidenceDir, observations: state.observations });
          firstCandidates = temporal.initialCandidates;
          final = temporal.final;
        } else {
          firstCandidates = assertExpectedFacts(first, { amount: 20, pace: 3, session: 30, durations: [30, 30], start: '2026-08-24', end: '2026-08-30' });
          await inspectPreview(page, firstCandidates, { id: `${scenario.id}-initial` }, evidenceDir, state.observations);
          await preview(page).getByRole('button', { name: '閉じる', exact: true }).click();
          await expect(preview(page)).toHaveCount(0);
          final = await submit(scenario.correction);
        }
        if (scenario.id === 'paired-workload-effort') state.observations.push({ kind: 'correction-seams', scenario: scenario.id, ...assertPairedCorrectionSeam(first, final) });
        if (scenario.id === 'pending-window-date') {
          const pending = final.planningState.intakeState?.lastQuestionContext;
          expect(pending?.targetSlot, 'coverage incomplete: a typed window uncertainty must be asked').toBe('stable_v5:semantic_uncertainty');
          const question = active(final.graph, 'uncertainties').find(row => row.id === pending.topicId);
          expect(question, 'pending topic must identify the actual uncertainty Q').toBeTruthy();
          expect(question.createdRevision, 'coverage incomplete: uncertainty must originate in this correction').toBeGreaterThan(first.graph.revision);
          expect(question.source.turnId).toBe(`${final.conversationId}:request:${final.planningState.conversationRequestSequence}`);
          const pendingWindow = active(final.graph, 'planningWindows').find(row => row.id === question.targetFactId);
          expect(pendingWindow, 'Q must target an active planning window W, not another task').toBeTruthy();
          expect(active(final.graph, 'planningWindows').some(row => row.start === scenario.start && row.end), 'unknown end must not be invented').toBe(false);
          await assertNoPreviewApproval(page, final);
          const beforeAnswer = final;
          final = await submit(scenario.continuation);
          const resolvedWindow = active(final.graph, 'planningWindows');
          expect(resolvedWindow).toEqual([expect.objectContaining({ start: scenario.start, end: scenario.end })]);
          expect(resolvedWindow[0].id).not.toBe(pendingWindow.id);
          expect(final.graph.planningWindows.map(row => row.id)).toContain(pendingWindow.id);
          expect(active(final.graph, 'uncertainties').some(row => row.id === question.id)).toBe(false);
          expect(final.graph.factLifecycles.find(row => row.factId === question.id)?.status).toBe('removed');
          expect(final.planningState.intakeState?.lastQuestionContext?.topicId).not.toBe(question.id);
          state.observations.push({ kind: 'pending-window-seam', scenario: scenario.id,
            questionId: question.id, oldWindowId: pendingWindow.id, newWindowId: resolvedWindow[0].id,
            pendingRevision: beforeAnswer.graph.revision, resolvedRevision: final.graph.revision });
        } else if (!TEMPORAL && !final.planningState.previewCandidates?.length) {
          const intake = final.planningState.intakeState;
          expect(intake?.draftGenerationIntent).toBe('assistant_suggested');
          expect(intake?.lastQuestionContext, 'do not answer an unrelated unresolved question').toBeUndefined();
          final = await submit(scenario.continuation);
        }
        expect(final.conversationId).toBe(first.conversationId);
        expect(final.graph.revision).toBeGreaterThan(first.graph.revision);
        expect([...new Set(active(final.graph, 'workloads').map(row => row.taskId))])
          .toEqual([...new Set(active(first.graph, 'workloads').map(row => row.taskId))]);
        for (const field of ['workloads', 'effortEstimates', 'planningWindows', 'temporalConstraints']) {
          expect(final.graph[field].map(row => row.id), `${field} correction history remains readable`)
            .toEqual(expect.arrayContaining(first.graph[field].map(row => row.id)));
        }
        const candidates = TEMPORAL ? final.planningState.previewCandidates : assertExpectedFacts(final, scenario, firstCandidates);
        await inspectPreview(page, candidates, scenario, evidenceDir, state.observations);
        const callsBeforeSave = state.calls;
        await saveAndReload(page, candidates, state.observations, scenario);
        check();
        expect(state.calls, 'approval/reload never calls the model').toBe(callsBeforeSave);
        expect(Date.now()).toBeLessThan(scenarioState.deadline);
        state.completedCases.push({ id: scenario.id, calls: scenarioState.calls, turns: scenarioState.turns });
      } catch (error) {
        state.outcome = 'failed';
        fail('Correction oracle or UI acceptance failed; inspect captured synthetic evidence.');
        if (page) {
          try {
            const captured = { kind: 'failure-checkpoint', scenario: scenario.id, turn: scenarioState.turns };
            state.observations.push(captured);
            captured.checkpoint = await checkpoint(page);
            captured.visibleAssistantText = await page.locator('.weekly-planning-chat-message--assistant p').allTextContents();
          } catch {
            state.observations.push({ kind: 'failure-capture-unavailable', scenario: scenario.id, turn: scenarioState.turns });
          }
          try {
            await page.screenshot({ path: path.join(evidenceDir, `${scenario.id}-turn-${scenarioState.turns}-failure.png`), fullPage: true });
          } catch {
            state.observations.push({ kind: 'failure-screenshot-unavailable', scenario: scenario.id, turn: scenarioState.turns });
          }
        }
        throw error;
      } finally { await context.close(); }
    }
    check();
    expect(state.externalRequests).toEqual([]);
    expect(state.calls).toBeGreaterThan(0);
    expect(state.completedCases).toHaveLength(LIMITS.cases);
    state.outcome = 'passed';
  } finally {
    await api.dispose();
    // Allowlisted artifact data contains synthetic inputs/results only; headers/key never stored.
    const report = JSON.stringify({ profile: TEMPORAL ? 'temporal-ui' : 'correction-ui', limits: LIMITS, ...state }, null, 2).split(key).join('[redacted]');
    writeFileSync(path.join(evidenceDir, 'observations.json'), `${report}\n`);
  }
});
