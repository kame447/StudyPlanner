import { classifyFirestoreWrite } from './d5-production-smoke-observation.mjs';

// Phase-scoped record of the page's Firestore writes (classification and collection names only; never bodies).
// A flow declares which phases may write: every phase starts as 'none' (no write is allowed); the sweep, the approved save
// and the cleanup are authorized phases whose writes are recorded but are not violations. The emulator's Firestore host
// is classified exactly like production's, so the same contract runs in CI.
const HOSTS = new Set(['firestore.googleapis.com', '127.0.0.1', 'localhost']);
const PRODUCTION_HOST = 'firestore.googleapis.com';
const EMULATOR_PORT = '8180';

export const NO_WRITE_PHASE = 'none';

// Exact allow-lists of the authorized phases, from the product's own write paths, checked PER OPERATION as (kind -> collections):
// a write in an authorized phase that is not listed (other collection, other kind, wrong pairing, unclassified) is a violation.
//  save: the approval transaction sets the operation and item documents and the plan (canonical `schedule_events`, legacy `plans`):
//    weeklyPlanningApprovalFirestoreRepository.ts:203-207 (saveApprovedPlan), :297-305 (completeOperation); collections :38-40, plan ref :94-107.
//    Everything else the transaction touches is only READ and reaches the wire as a verify: the operation, item, migration and plan
//    documents (:170-188 saveApprovedPlan reads, :232-250 completeOperation reads).
//  sweep, cleanup: 「予定を削除」 -> deletePlanWithDependents: batch.delete of the plan (`schedule_events` canonical, `plans` legacy) and of
//    its `actuals`: firebaseScheduleEventAuthority.ts:614-643 (:360 planEventDeleteOperation), firebasePlannerRepository.ts:502-517.
//    Its only non-delete write is a `todos` merge when the plan has a linked todo; the flow's test plan has none, so it is not allowed.
const APPROVAL_DOCUMENTS = ['plans', 'schedule_events', 'weekly_planning_approval_operations', 'weekly_planning_approval_items'];
export const PHASE_ALLOWLISTS = {
  save: { update: APPROVAL_DOCUMENTS, verify: [...APPROVAL_DOCUMENTS, 'schedule_event_migrations'] },
  sweep: { delete: ['plans', 'schedule_events', 'actuals'] },
  cleanup: { delete: ['plans', 'schedule_events', 'actuals'] },
};

function permitted(write) {
  // Transport handshakes (no mutation) and profile writes (auth may normalize a profile) are fine in every phase.
  if (write.classification === 'protocol' || write.classification === 'allowed') return true;
  if (write.phase === NO_WRITE_PHASE) return false;
  const list = PHASE_ALLOWLISTS[write.phase];
  if (!list || write.classification !== 'forbidden' || !write.operations?.length) return false; // unclassified, unknown phase, no per-write detail
  return write.operations.every(({ kind, collection }) => list[kind]?.includes(collection));
}

export function createWriteLedger() {
  let phase = NO_WRITE_PHASE;
  const writes = [];
  return {
    get phase() { return phase; },
    setPhase(name) { phase = name; },
    /** Run `body` with writes authorized under `name`; the previous (no-write) phase is restored afterwards. */
    async during(name, body) {
      const previous = phase;
      phase = name;
      try { return await body(); } finally { phase = previous; }
    },
    record({ url, method, postData }) {
      let parsed;
      try { parsed = new URL(url); } catch { return null; }
      if (!HOSTS.has(parsed.hostname)) return null;
      if (parsed.hostname !== PRODUCTION_HOST && parsed.port !== EMULATOR_PORT) return null; // not the Firestore emulator
      parsed.hostname = PRODUCTION_HOST; // same path shapes on the emulator; the classifier only knows the production host
      parsed.port = '';
      parsed.protocol = 'https:';
      const write = classifyFirestoreWrite({ url: parsed.toString(), method, postData }, { withOperations: true });
      if (!write) return null;
      const entry = { phase, ...write };
      writes.push(entry);
      return entry;
    },
    writes: () => [...writes],
    /** Writes outside their phase's contract: any forbidden/unclassified write in the no-write phase, and in an authorized
     *  phase any write that is not on that phase's exact allow-list. */
    violations: () => writes.filter(write => !permitted(write)),
    inPhase: name => writes.filter(write => write.phase === name),
  };
}

/** The approved save must be visible to the observer: a forbidden-classified write to a protected collection. */
export const protectedWritesIn = writes => writes.filter(write => write.classification === 'forbidden');

export function attachWriteLedger(page, ledger = createWriteLedger()) {
  page.on('request', request => { ledger.record({ url: request.url(), method: request.method(), postData: request.postData() }); });
  return ledger;
}
