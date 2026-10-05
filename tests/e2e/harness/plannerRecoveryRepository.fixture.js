// Test-only external persistence controls. All writes still use the production
// local repository and its ScheduleEvent authority; no hook state is fabricated.
import { installPlanRestoreStorageFault } from './planRestoreStorageFault.fixture.js';
import { scheduleEventToMonthEvent } from '../../../src/domain/scheduleEvent';
import { createAuthRepository } from '../../../src/repositories/authRepository';
import { createLocalAuthStorageGateway } from '../../../src/repositories/localStorageGateway';
import { createLocalPlannerRepository } from '../../../src/repositories/createLocalPlannerRepository';

const real = createLocalPlannerRepository();
export const authRepository = createAuthRepository(createLocalAuthStorageGateway());
const calls = [];
let holdActualDispatch = false;
let heldActualDispatch = null;
let holdActualAcknowledgment = false;
let heldAcknowledgment = null;
let holdPlanWrite = false;
let heldPlanWrite = null;
let holdMonthWrite = false;
let heldMonthWrite = null;
let planRestoreFault = null;
let holdProjectionReads = false;
const heldReads = [];
const failures = { getDayNotes: 0, getActuals: 0, getStudyMaterials: 0, getMonthEvents: 0, getPlans: 0, getTodos: 0 };
const targetMethods = new Set(Object.keys(failures));
const snapshot = () => structuredClone({ calls, pendingActualDispatches: heldActualDispatch ? 1 : 0, pendingAcknowledgments: heldAcknowledgment ? 1 : 0,
  pendingPlanWrites: heldPlanWrite ? 1 : 0, pendingMonthWrites: heldMonthWrite ? 1 : 0, pendingReads: heldReads.map(item => item.method) });

export const plannerRepository = Object.fromEntries(Object.entries(real).map(([method, original]) => [method, async (...args) => {
  calls.push({ method, phase: 'called' });
  if (method === 'upsertActualWithMaterialProgress' && holdActualDispatch) {
    holdActualDispatch = false;
    // Test-only remote-latency stand-in BEFORE entering the native local queue.
    // Native local saves are not claimed to have a cross-event query window.
    await new Promise(resolve => { heldActualDispatch = resolve; });
  }
  if (method === holdPlanWrite) {
    holdPlanWrite = false;
    // Remote-latency stand-in before the production repository queue.
    await new Promise(resolve => { heldPlanWrite = resolve; });
  }
  if (method === 'upsertMonthEvent' && holdMonthWrite) {
    holdMonthWrite = false;
    // Gate BEFORE calling the real repository: the accepted full read must
    // observe the old durable calendar, not an already-persisted optimistic row.
    await new Promise(resolve => { heldMonthWrite = resolve; });
  }
  if (targetMethods.has(method)) {
    if (holdProjectionReads) await new Promise(resolve => heldReads.push({ method, resolve }));
    if (failures[method] > 0) {
      failures[method] -= 1;
      calls.push({ method, phase: 'failed' });
      throw new Error(`Synthetic ${method} read failure`);
    }
  }
  let result;
  try {
    result = await original(...args);
  } catch (error) {
    calls.push({ method, phase: 'rejected', error: String(error) });
    throw error;
  }
  calls.push({ method, phase: 'durable-result' });
  if (method === 'upsertActualWithMaterialProgress' && holdActualAcknowledgment) {
    holdActualAcknowledgment = false;
    // Crucially AFTER both Actual and material writes succeeded, outside the
    // real repository's rollback catch. Releasing this gate cannot replay them.
    await new Promise(resolve => { heldAcknowledgment = resolve; });
  }
  calls.push({ method, phase: 'returned' });
  return result;
}]));

window.__plannerRecoveryRepository = {
  snapshot,
  async seedOpenTodo(userId) {
    const now = new Date().toISOString();
    await plannerRepository.upsertTodo({ id: 'read-repair-todo', userId, title: '予定化するTodo',
      subject: '数学', type: 'study', estimatedMinutes: 60, dueDate: null, dueTime: null,
      memo: '', status: 'open', scheduledPlanId: null, pinned: false, createdAt: now, updatedAt: now });
  },
  async seedMaterialAdmissionPlans({ userId, date }) {
    const material = (await plannerRepository.getStudyMaterials(userId))
      .find(item => item.id === 'material-before-refresh');
    if (!material) throw new Error('Material admission seed requires the harness material');
    const now = new Date().toISOString();
    const plans = [
      { id: 'material-admission-first', title: '同じ教材の学習 A', startTime: '10:00', endTime: '11:00' },
      { id: 'material-admission-second', title: '同じ教材の学習 B', startTime: '11:00', endTime: '12:00' },
    ].map(plan => ({ ...plan, seriesId: plan.id, userId, date, subject: material.subjectName,
      repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'study',
      memo: '', sourceType: 'manual', materialId: material.id, materialName: material.name,
      createdAt: now, updatedAt: now }));
    // Setup alone uses a driver. Both concurrent saves in the regression enter
    // through the actual Home / Study Session controls on the same mounted App.
    for (const plan of plans) await plannerRepository.upsertPlan(plan);
    return plans;
  },
  async seedPlanUndo({ userId, date, withTodo = false, withActual = true }) {
    const now = new Date().toISOString();
    const plan = { id: 'rollback-undo-plan', seriesId: 'rollback-undo-plan', userId,
      title: '復元に失敗する学習予定', subject: '数学', date, startTime: '09:00', endTime: '09:30',
      repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'study',
      memo: '', createdAt: now, updatedAt: now,
      ...(withTodo ? { sourceType: 'todo', sourceId: 'rollback-undo-todo' } : {}) };
    const actual = { id: 'rollback-undo-actual', userId, planId: plan.id, occurrenceDate: date,
      actualStartTime: '09:00', actualEndTime: '09:30', title: plan.title, subject: plan.subject,
      note: 'Undo must restore this linked record or reject', updatedAt: now,
      ...(withTodo ? { materialProgressUpdates: [{ materialId: 'material-before-refresh', deltaUnits: 5 }] } : {}) };
    const todo = withTodo ? { id: plan.sourceId, userId, title: plan.title, subject: plan.subject,
      type: 'study', estimatedMinutes: 30, dueDate: null, dueTime: null, pinned: false, memo: '', status: 'scheduled',
      scheduledPlanId: plan.id, createdAt: now, updatedAt: now } : null;
    // Setup uses the same production facade as the App. The hook subsequently
    // reads these rows and captures its real linked-record Undo closure.
    await plannerRepository.upsertPlan(plan);
    if (withActual) await plannerRepository.upsertActual(actual);
    if (todo) await plannerRepository.upsertTodo(todo);
    return { plan, actual: withActual ? actual : null, ...(todo ? { todo } : {}) };
  },
  armPlanRestoreFault(planId, onPlanRestore) {
    if (planRestoreFault) throw new Error('A Plan restore fault is already installed');
    planRestoreFault = installPlanRestoreStorageFault({ storage: localStorage,
      storagePrototype: Storage.prototype, planId, onPlanRestore });
  },
  planRestoreFaultSnapshot() { return planRestoreFault?.snapshot() ?? null; },
  releasePlanRestoreFault() {
    planRestoreFault?.dispose();
    planRestoreFault = null;
  },
  preserveNextReload() {
    // Consumed once by the test harness entry, never production App code.
    sessionStorage.setItem('studyplanner.e2e.preserve-next-reload', 'true');
  },
  holdNextActualDispatch() { holdActualDispatch = true; },
  releaseActualDispatch() {
    const release = heldActualDispatch;
    if (!release) return false;
    heldActualDispatch = null;
    release();
    return true;
  },
  holdNextActualAcknowledgment() { holdActualAcknowledgment = true; },
  releaseActualAcknowledgment() {
    const release = heldAcknowledgment;
    if (!release) return false;
    heldAcknowledgment = null;
    release();
    return true;
  },
  holdNextPlanWrite() { holdPlanWrite = 'upsertPlan'; },
  holdNextTodoSchedule() { holdPlanWrite = 'scheduleTodoPlan'; },
  releasePlanWrite() {
    const release = heldPlanWrite;
    if (!release) return false;
    heldPlanWrite = null;
    release();
    return true;
  },
  holdNextMonthWrite() { holdMonthWrite = true; },
  releaseMonthWrite() {
    const release = heldMonthWrite;
    if (!release) return false;
    heldMonthWrite = null;
    release();
    return true;
  },
  readDurableMonthEvents() {
    return JSON.parse(localStorage.getItem('studyplanner.scheduleEvents.v1') ?? '[]')
      .map(scheduleEventToMonthEvent).filter(event => event !== null);
  },
  failNextDayNoteRead() { failures.getDayNotes += 1; },
  failNextMonthRead() { failures.getMonthEvents += 1; },
  failNextActualRead() { failures.getActuals += 1; },
  failNextTodoRead() { failures.getTodos += 1; },
  holdTargetReads() { holdProjectionReads = true; },
  releaseTargetReads() {
    holdProjectionReads = false;
    const pending = heldReads.splice(0);
    for (const { resolve } of pending) resolve();
    return pending.length;
  },
  readDurable() {
    return { actuals: JSON.parse(localStorage.getItem('studyplanner.actuals') ?? '[]'),
      materials: JSON.parse(localStorage.getItem('studyplanner.studyMaterials.v1') ?? '[]') };
  },
  installNewerDurableProjection() {
    // A synthetic external edit, deliberately below the app repository counter.
    // Tests compare app write calls AND these persisted bytes across recovery.
    const state = this.readDurable();
    const saved = state.actuals.find(actual => actual.note === 'held actual acknowledgment');
    if (!saved) throw new Error('Actual must be durably saved before replacing the external snapshot');
    const actuals = state.actuals.map(actual => actual.id === saved.id
      ? { ...actual, id: 'actual-after-refresh', note: 'newer authoritative actual' } : actual);
    const materials = state.materials.map(material => ({ ...material, id: 'material-after-refresh', name: '更新された教材', currentUnit: 37 }));
    localStorage.setItem('studyplanner.actuals', JSON.stringify(actuals));
    localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify(materials));
    return { actuals, materials };
  },
};
