import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { doc, getDocFromServer, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { APPROVAL_COUNT, fixtures, NOW, OWNER } from './firestoreReadLoad.fixtures';
import { context, type Counts } from './firestore-read-load-emulator.integration';
import { createFirebasePlannerRepository } from '../../src/repositories/firebasePlannerRepository';
import { createFirebaseScheduleEventAuthority } from '../../src/repositories/firebaseScheduleEventAuthority';
import { createScheduleEventBackedPlannerRepository } from '../../src/repositories/scheduleEventAuthorityRepository';
import { createFirestoreWeeklyPlanningApprovalPlanRepository } from '../../src/features/weeklyPlanning/application/weeklyPlanningApprovalFirestoreRepository';
import { buildWeeklyPlanningPlanSourceId } from '../../src/features/weeklyPlanning/planning/weeklyPlanningPlanProvenance';
import { createEmptyPlanDraft } from '../../src/domain/planner';
import { scheduleEventFromPlan, scheduleEventIdForLegacy } from '../../src/domain/scheduleEvent';
import { resolveApprovalDraftIdentity, resolveAtomicApprovalSave, resolveApprovalCompletion,
  type StoredApprovalOperation } from '../../src/features/weeklyPlanning/application/weeklyPlanningApprovalPersistencePolicy';
import { stripUndefinedDeep } from '../../src/repositories/plannerWritePreparation';
import { normalizePlanRecord } from '../../src/repositories/repositoryUtils';
import { usePlannerAppState } from '../../src/hooks/usePlannerAppState';
import { expandPlansForDateRange } from '../../src/lib/planRecurrence';
import { doesMonthEventOccurOnDate } from '../../src/lib/monthEvents';
import type { Plan, PlanDraft } from '../../src/types/domain';

type AppState = ReturnType<typeof usePlannerAppState>;
type Measure = <T>(operation: string, action: () => Promise<T>, size?: number) => Promise<{ value: T; counts: Counts }>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, canonical(value)]));
  return value;
}
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function snapshot(state: AppState) {
  return Object.fromEntries(['plans', 'actuals', 'dayNotes', 'monthEvents', 'todos', 'studySubjects', 'studyMaterials',
    'scheduleTemplates', 'timetableTerms', 'timetablePeriods'].map(key => {
      const rows = key === 'plans' ? state.plans.map(normalizePlanRecord) : state[key as keyof AppState];
      return [key, rows === null ? null : [...rows as Array<{ id: string }>]
        .sort((left, right) => left.id.localeCompare(right.id))];
    }));
}

export async function runApprovalMeasurement(db: Firestore, options: { measure: Measure; mode: 'before' | 'after'; scale: number; replay?: boolean }) {
  const runtime = {
    repository: createScheduleEventBackedPlannerRepository(createFirebasePlannerRepository(db), createFirebaseScheduleEventAuthority(db)),
    approval: createFirestoreWeeklyPlanningApprovalPlanRepository(db),
    owner: { id: OWNER, email: 'synthetic@example.invalid', username: 'Synthetic', avatar: '', createdAt: NOW },
    bootstrap: Promise.resolve(), loader: null as null | ((ownerId: string) => Promise<void>), id: 0,
    noop: () => undefined, asyncNoop: async () => undefined,
    bootstrapSession: (load: (ownerId: string) => Promise<void>) => {
      runtime.loader = load; runtime.bootstrap = load(OWNER);
      // The app intentionally launches bootstrap without awaiting it. Capture
      // the same rejection for the caller without an unhandled process promise.
      void runtime.bootstrap.catch(() => undefined);
      return runtime.bootstrap;
    },
  };
  (globalThis as unknown as { __firestoreReadLoadApp: typeof runtime }).__firestoreReadLoadApp = runtime;
  const data = fixtures(options.scale);
  const operationId = 'emulator-approval-operation';
  function approvalDraft(index: number): PlanDraft {
    return { ...createEmptyPlanDraft(OWNER, '2026-10-08'), title: `Approved block ${index}`, subject: 'Math',
      startTime: '13:00', endTime: '14:00', sourceType: 'weekly-planning', sourceId: buildWeeklyPlanningPlanSourceId({
        approvalOperationId: operationId, sourceDraftBlockId: `block-${index}` }) };
  }
  let currentStage = 'seed';
  let state: AppState | undefined;
  let renderer: ReactTestRenderer | undefined;
  const saved: Plan[] = [];
  const phases: unknown[] = [];
  const readState = () => { assert(state, 'App hook has not rendered'); return state; };
  function Harness() { state = usePlannerAppState(); return null; }
  const baseReport = { mode: options.mode, replay: options.replay ?? false, scale: options.scale,
    seedPlanCount: data.plans.length + (options.replay ? APPROVAL_COUNT : 0),
    seedMonthEventCount: data.events.length, approvalCount: APPROVAL_COUNT, fixtureDigest: digest(data.documents),
    scenario: options.replay
      ? 'Cold planner launch with five already-saved approval plans, then idempotent replay and completion under unchanged Rules. This does not prove first-save success.'
      : 'Cold planner launch, then five new approved plans and operation completion; no earlier manual or single approval save.' };
  async function phase(label: string, action: () => Promise<void>) {
    currentStage = label;
    const result = await options.measure(`${options.mode}:${label}`, action,
      data.plans.length + data.events.length + (options.replay ? APPROVAL_COUNT : 0));
    const current = readState();
    assert.equal(current.plannerDataAvailability.status, 'ready');
    if (options.replay && label === 'approved-save-K-and-complete') {
      assert.equal(result.counts.commitRequests, 6);
      assert.equal(result.counts.writeRequests.weekly_planning_approval_operations, 6);
      assert.equal(result.counts.writeRequests.weekly_planning_approval_items, 10);
      assert.equal(result.counts.writeRequests.schedule_events ?? 0, 0);
      assert.equal(result.counts.writeRequests.schedule_event_migrations ?? 0, 0);
      assert.equal(result.counts.verifyDocumentPreconditions, 16);
    }
    phases.push({ operation: label, counts: result.counts, dataDigest: digest(snapshot(current)),
      projectionDigest: digest({ plans: expandPlansForDateRange(current.plans.map(normalizePlanRecord), '2026-10-08', '2026-10-10'),
        monthEventIds: current.monthEvents.filter(event => doesMonthEventOccurOnDate(event, '2026-10-08')).map(event => event.id).sort() }) });
  }
  try {
    // Use ordinary owner-authenticated writes under the unchanged Rules. A
    // separate seed client keeps the measured client's document cache cold.
    const seedClient = context(OWNER);
    const lease = { schemaVersion: 1, migrationVersion: 1, userId: OWNER, status: 'migrating',
      operationId: `schedule-event-migration-v1:${OWNER}`, revision: 1, startedAt: NOW, completedAt: null };
    try {
      await setDoc(doc(seedClient.db, 'schedule_event_migrations', OWNER), lease);
      const records = Object.entries(data.documents).filter(([collection]) => collection !== 'schedule_event_migrations')
        .flatMap(([collection, documents]) => documents.filter(document => document.userId === OWNER).map(document => ({ collection, document })));
      for (let index = 0; index < records.length; index += 200) {
        const batch = writeBatch(seedClient.db);
        for (const { collection, document } of records.slice(index, index + 200)) {
          batch.set(doc(seedClient.db, collection, String(document.id)), stripUndefinedDeep(document));
        }
        await batch.commit();
      }
      await setDoc(doc(seedClient.db, 'schedule_event_migrations', OWNER), { ...lease, status: 'completed', completedAt: NOW,
        sourcePlanCount: data.plans.length, sourceMonthEventCount: data.events.length, eventCount: data.plans.length + data.events.length });
      if (options.replay) {
        // Seed a legitimate already-completed operation using the same pure
        // persistence policy as production, through ordinary owner-authenticated
        // writes. No Rules changes or emulator-admin bypass are used.
        const batch = writeBatch(seedClient.db);
        let operation: StoredApprovalOperation | null = null;
        let operationDocumentId = '';
        for (let index = 0; index < APPROVAL_COUNT; index++) {
          const draft = approvalDraft(index);
          const identity = resolveApprovalDraftIdentity(draft);
          const resolution = resolveAtomicApprovalSave({ draft, identity,
            snapshot: { operation, item: null, plan: null }, now: new Date(NOW) });
          operation = resolution.operation;
          operationDocumentId = identity.operationDocumentId;
          const operationRef = doc(seedClient.db, 'weekly_planning_approval_operations', operationDocumentId);
          batch.set(doc(operationRef, 'weekly_planning_approval_items', identity.itemDocumentId), resolution.item);
          const event = scheduleEventFromPlan(resolution.plan);
          batch.set(doc(seedClient.db, 'schedule_events', event.id), stripUndefinedDeep(event));
        }
        batch.set(doc(seedClient.db, 'weekly_planning_approval_operations', operationDocumentId), resolveApprovalCompletion({
          operation, userId: OWNER, approvalOperationId: operationId,
          durableItemCount: APPROVAL_COUNT, expectedItemCount: APPROVAL_COUNT, now: new Date(NOW),
        }));
        await batch.commit();
      }
    } finally { await seedClient.close(); }

    await phase('cold-planner-launch', async () => {
      await act(async () => { renderer = create(createElement(Harness)); });
      await act(async () => { await runtime.bootstrap; });
    });
    assert.equal(readState().plans.length, data.plans.length + (options.replay ? APPROVAL_COUNT : 0));
    assert.equal(readState().actuals.length, 12 * options.scale);
    assert.deepEqual(expandPlansForDateRange(readState().plans, '2026-10-08', '2026-10-10')
      .filter(plan => plan.id === 'plan-0').map(plan => plan.occurrenceDate), ['2026-10-08', '2026-10-10']);
    assert(readState().monthEvents.some(event => event.id === 'event-0' && doesMonthEventOccurOnDate(event, '2026-10-08')));
    const initialState = canonical(snapshot(readState()));
    await phase('approved-save-K-and-complete', async () => {
      for (let index = 0; index < APPROVAL_COUNT; index++) {
        currentStage = `approved-save-${index + 1}-of-${APPROVAL_COUNT}`;
        const draft = approvalDraft(index);
        await act(async () => { saved.push(await readState().saveWeeklyApprovedPlan(draft)); });
      }
      currentStage = 'complete-approval-operation';
      await act(async () => { await readState().completeWeeklyApprovalOperation({ approvalOperationId: operationId, userId: OWNER,
        previewId: 'emulator-preview', previewStateRevision: 1, startedAt: NOW, completedAt: NOW, status: 'completed',
        items: saved.map((plan, index) => ({ sourceDraftBlockId: `block-${index}`, savedPlanId: plan.id,
          status: 'saved', attemptCount: 1, updatedAt: NOW })) }); });
    });
    assert.equal(readState().plans.length, data.plans.length + APPROVAL_COUNT);
    if (options.replay) assert.deepEqual(canonical(snapshot(readState())), initialState);
    assert(saved.every(plan => readState().plans.some(current => current.id === plan.id)));
    const beforeRefresh = canonical(snapshot(readState()));
    await phase('explicit-planner-reload', async () => {
      assert(runtime.loader); await act(async () => { await runtime.loader!(OWNER); });
    });
    assert.deepEqual(canonical(snapshot(readState())), beforeRefresh);
    // Independent server reads verify that each acknowledged plan was persisted.
    // These verification reads are deliberately outside the measured phases.
    currentStage = 'verify-persisted-plans';
    const persisted = [];
    for (const plan of saved) {
      const document = await getDocFromServer(doc(db, 'schedule_events', scheduleEventIdForLegacy({ kind: 'plan', id: plan.id })));
      assert(document.exists()); assert.equal(document.data().userId, OWNER); persisted.push(document.data());
    }
    return { ...baseReport, status: 'passed', successfulSavedCount: saved.length, phases,
      finalDataDigest: digest(snapshot(readState())), persistedApprovedPlanDigest: digest(persisted),
      checks: ['initial planner completeness', 'historical recurring exclusion', 'multi-day event',
        'all five acknowledged plans visible', 'reload preserves requested normalized state', 'independent server existence of all five saved plans'],
      uncountedVerificationReads: saved.length };
  } catch (error) {
    const details = error as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
    return { ...baseReport, status: 'blocked', blockedPhase: currentStage, successfulSavedCount: saved.length, phases,
      error: { code: details.code ?? null, message: details.message ?? String(error),
        causeCode: details.cause?.code ?? null, causeMessage: details.cause?.message ?? null },
      rulesChanged: false, claim: 'An incomplete or denied save is not evidence of successful read reduction.' };
  } finally { if (renderer) await act(async () => renderer!.unmount()); }
}
