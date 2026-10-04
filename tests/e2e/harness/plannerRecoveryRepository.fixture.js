// Test-only external persistence controls. All writes still use the production
// local repository and its ScheduleEvent authority; no hook state is fabricated.
import { scheduleEventToMonthEvent } from '../../../src/domain/scheduleEvent';
import { createRepositories } from '../../../src/repositories/createRepositories';
import { createLocalAuthStorageGateway, createLocalPlannerStorageGateway } from '../../../src/repositories/localStorageGateway';
import { createLocalScheduleEventAuthority } from '../../../src/repositories/localScheduleEventAuthority';
import { createScheduleEventBackedPlannerRepository } from '../../../src/repositories/scheduleEventAuthorityRepository';

const gateway = createLocalPlannerStorageGateway();
const local = createRepositories({ authStorageGateway: createLocalAuthStorageGateway(), plannerStorageGateway: gateway });
const real = createScheduleEventBackedPlannerRepository(local.plannerRepository, createLocalScheduleEventAuthority(gateway));
export const authRepository = local.authRepository;
const calls = [];
let holdActualAcknowledgment = false;
let heldAcknowledgment = null;
let holdMonthWrite = false;
let heldMonthWrite = null;
let holdProjectionReads = false;
const heldReads = [];
const failures = { getActuals: 0, getStudyMaterials: 0, getMonthEvents: 0 };
const targetMethods = new Set(Object.keys(failures));
const snapshot = () => structuredClone({ calls, pendingAcknowledgments: heldAcknowledgment ? 1 : 0,
  pendingMonthWrites: heldMonthWrite ? 1 : 0, pendingReads: heldReads.map(item => item.method) });

export const plannerRepository = Object.fromEntries(Object.entries(real).map(([method, original]) => [method, async (...args) => {
  calls.push({ method, phase: 'called' });
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
  const result = await original(...args);
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
  holdNextActualAcknowledgment() { holdActualAcknowledgment = true; },
  releaseActualAcknowledgment() {
    const release = heldAcknowledgment;
    if (!release) return false;
    heldAcknowledgment = null;
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
  failNextMonthRead() { failures.getMonthEvents += 1; },
  failNextActualRead() { failures.getActuals += 1; },
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
