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
//  sweep, cleanup: recurring occurrence cancellation retains its update allow-list. Ordinary one-off cleanup (#967) deletes
//    its canonical source instead. That delete is allowed only while the helper has checked the one-off menu and named the
//    exact source id from that block's occurrence identity. No actuals, todos, migration or other source is authorized.
const APPROVAL_DOCUMENTS = ['plans', 'schedule_events', 'weekly_planning_approval_operations', 'weekly_planning_approval_items'];
//  save-actuals: the confirmed study-record save (#973, DESIGN-DECISION.md 5): ONE writeBatch of `actuals/{deterministic id}` documents, one
//    `update` operation per record and nothing else (no plan, schedule event, approval or other collection). A transaction that reads the
//    documents first may add `verify` operations of `actuals`.
export const PHASE_ALLOWLISTS = {
  'save-actuals': { update: ['actuals'], verify: ['actuals'] },
  save: { update: APPROVAL_DOCUMENTS, verify: [...APPROVAL_DOCUMENTS, 'schedule_event_migrations'] },
  sweep: { update: ['plans', 'schedule_events'] },
  cleanup: { update: ['plans', 'schedule_events'] },
};

function permitted(write) {
  // Transport handshakes (no mutation) and profile writes (auth may normalize a profile) are fine in every phase.
  if (write.classification === 'protocol' || write.classification === 'allowed') return true;
  if (write.phase === NO_WRITE_PHASE) return false;
  const list = PHASE_ALLOWLISTS[write.phase];
  if (!list || write.classification !== 'forbidden' || !write.operations?.length) return false; // unclassified, unknown phase, no per-write detail
  if (write.operations.some(({ kind }) => kind === 'delete')) {
    return ['sweep', 'cleanup'].includes(write.phase) && write.operations.length === 1
      && write.operations[0].kind === 'delete' && write.operations[0].collection === 'schedule_events'
      && write.operations[0].targetMatched === true;
  }
  return write.operations.every(({ kind, collection }) => list[kind]?.includes(collection));
}

export function createWriteLedger() {
  let phase = NO_WRITE_PHASE;
  let deletionTarget = null; // scoped equality input, never retained in the ledger
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
    /** Only the explicit cleanup of one checked one-off block may authorize its source deletion. */
    async withPlanDeletion(planId, body) {
      if (!['sweep', 'cleanup'].includes(phase) || typeof planId !== 'string' || !planId || planId.includes('/')) {
        throw new Error('Plan deletion needs a cleanup/sweep phase and one source id.');
      }
      const previous = deletionTarget;
      deletionTarget = `schedule_events/plan:${planId}`;
      try { return await body(); } finally { deletionTarget = previous; }
    },
    record({ url, method, postData }) {
      let parsed;
      try { parsed = new URL(url); } catch { return null; }
      if (!HOSTS.has(parsed.hostname)) return null;
      if (parsed.hostname !== PRODUCTION_HOST && parsed.port !== EMULATOR_PORT) return null; // not the Firestore emulator
      parsed.hostname = PRODUCTION_HOST; // same path shapes on the emulator; the classifier only knows the production host
      parsed.port = '';
      parsed.protocol = 'https:';
      const write = classifyFirestoreWrite({ url: parsed.toString(), method, postData }, { withOperations: true,
        ...(deletionTarget ? { matchesDocument: name => name.slice(name.indexOf('/documents/') + '/documents/'.length) === deletionTarget } : {}),
      });
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
    /** Mutating commits of a phase (handshakes and profile writes excluded): one per removed block in sweep/cleanup, each with exactly one operation. */
    commitsIn: name => writes.filter(write => write.phase === name && write.classification === 'forbidden'),
  };
}

/** The approved save must be visible to the observer: a forbidden-classified write to a protected collection. */
export const protectedWritesIn = writes => writes.filter(write => write.classification === 'forbidden');

export function attachWriteLedger(page, ledger = createWriteLedger()) {
  page.on('request', request => { ledger.record({ url: request.url(), method: request.method(), postData: request.postData() }); });
  return ledger;
}

/** Each removed block is exactly one commit with exactly one operation. */
export function cancellationCommitProblems(commits, removed) {
  const problems = [];
  if (commits.length !== removed) problems.push(`expected ${removed} cancellation commit(s), saw ${commits.length}`);
  commits.forEach((commit, index) => {
    if (commit.operations?.length !== 1) problems.push(`commit ${index} has ${commit.operations?.length ?? 'unknown'} operations, expected 1`);
  });
  return problems;
}

/** One exact, authorized canonical source delete per observed removed one-off block. */
export function planDeletionCommitProblems(commits, removed) {
  const problems = [];
  if (commits.length !== removed) problems.push(`expected ${removed} deletion commit(s), saw ${commits.length}`);
  commits.forEach((commit, index) => {
    const operations = commit.operations ?? [];
    if (operations.length !== 1 || operations[0].kind !== 'delete' || operations[0].collection !== 'schedule_events'
      || operations[0].targetMatched !== true) problems.push(`commit ${index} is not one authorized source delete`);
  });
  return problems;
}

/** The confirmed record save is exactly one commit whose operations are `expected` updates of `actuals`. */
export function actualsCommitProblems(commits, expected) {
  const problems = [];
  if (commits.length !== 1) problems.push(`expected 1 actuals commit, saw ${commits.length}`);
  commits.forEach((commit, index) => {
    const updates = (commit.operations ?? []).filter(({ kind }) => kind === 'update');
    if (updates.length !== expected) problems.push(`commit ${index} has ${updates.length} update operation(s), expected ${expected}`);
    if (updates.some(({ collection }) => collection !== 'actuals')) problems.push(`commit ${index} updates a collection other than actuals`);
  });
  return problems;
}
