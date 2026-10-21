// All exported diagnostics are bounded enums. Never copy request/error text into evidence.
const STEPS = {
  target_preflight: 'production target verification', login: 'test-account login',
  server_snapshot_before: 'initial server readback', fresh_conversation: 'fresh conversation setup',
  setup_question: 'pending effort question', d5_capture: 'D5 capture', answer_turn: 'answer completion',
  answer_state: 'answer state readback', jev_evaluation: 'Jev evaluation', d5_consumption: 'D5 consumption',
  active_estimate: 'active estimate verification', visible_ack: 'visible ACK verification',
  off_capture: 'OFF capture verification', off_candidate: 'bound OFF candidate verification',
  off_consumption: 'OFF consumption verification', luna_fallback: 'Luna fallback verification',
  network_evidence: 'network evidence verification', server_snapshot_after: 'final server readback',
  approval_readback: 'approval readback', write_scope: 'Firestore write verification',
};
export const redactedSmokeStep = step => Object.hasOwn(STEPS, step) ? step : 'unknown_step';
export function redactedSmokeError(error, step) {
  const category = error?.name === 'TimeoutError' ? 'timeout'
    : error?.name === 'AssertionError' || error?.matcherResult ? 'assertion' : 'execution';
  return boundedSmokeError({ category }, step);
}
export function boundedSmokeError(value, step) {
  if (!value) return null;
  const category = ['timeout', 'assertion', 'execution'].includes(value.category) ? value.category : 'execution';
  const label = STEPS[redactedSmokeStep(step)] ?? 'unclassified smoke step';
  return { category, message: `${category} failure during ${label}.` };
}

/** Run every finalizer, retain the original error as the primary cause, never turn failures into PASS. */
export async function runProductionSmoke({ evidence, body, readback, persist }) {
  const errors = [];
  try { await body(); } catch (error) {
    errors.push(error);
    evidence.failingStep = redactedSmokeStep(evidence.step);
    evidence.bodyError = redactedSmokeError(error, evidence.failingStep);
  }
  try { await readback(); } catch (error) {
    errors.push(error);
    evidence.readbackStep = redactedSmokeStep(evidence.step);
    evidence.readbackError = redactedSmokeError(error, evidence.readbackStep);
  }
  if (errors.length && evidence.outcome !== 'non_production') evidence.outcome = 'incomplete';
  try { await persist(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'D5 smoke failed; additional finalizer failures retained.', { cause: errors[0] });
}

const PROTECTED_COLLECTIONS = new Set([
  'schedule_events', 'plans', 'month_events', 'weekly_planning_approval_operations', 'weekly_planning_approval_items',
  'schedule_event_migrations', 'actuals', 'todos', 'study_subjects', 'study_materials', 'day_notes',
  'schedule_templates', 'timetable_terms', 'timetable_periods', 'study_rest_days', 'class_attendance',
]);
// Root collections only. Auth may initialize/normalize a profile (firebaseAuthRepository.ts:ensureProfile).
const ALLOWED_COLLECTIONS = new Set(['profiles']);
// Production uses remote/noop traces; direct trace writes are denied by Rules and fail classification.
// Retain only their public collection names for the redacted failure evidence.
const KNOWN_COLLECTIONS = new Set([...PROTECTED_COLLECTIONS, ...ALLOWED_COLLECTIONS,
  'weekly_planning_trace_sessions', 'weekly_planning_trace_entries']);
export function redactedWriteObservation(value) {
  return {
    transport: ['write_channel', 'commit', 'batch_write', 'rest'].includes(value?.transport) ? value.transport : 'unknown',
    classification: ['protocol', 'allowed', 'forbidden', 'unclassified'].includes(value?.classification) ? value.classification : 'unclassified',
    collections: [...new Set((Array.isArray(value?.collections) ? value.collections : [])
      .map(name => KNOWN_COLLECTIONS.has(name) ? name : 'unknown_collection'))].sort(),
  };
}

/** Decode the Firebase SDK's sendRawJson WebChannel form or a REST JSON WriteRequest. */
export function classifyFirestoreWrite({ url: rawUrl, method, postData }) {
  const url = new URL(rawUrl);
  if (url.hostname !== 'firestore.googleapis.com') return null;
  const channel = url.pathname.endsWith('/google.firestore.v1.Firestore/Write/channel');
  const commit = /:commit$/u.test(url.pathname);
  const batch = /:batchWrite$/u.test(url.pathname);
  const rest = /\/documents(?:\/|$)/u.test(url.pathname) && ['PATCH', 'PUT', 'DELETE', 'POST'].includes(method)
    && !/:runQuery$|:batchGet$|:runAggregationQuery$/u.test(url.pathname);
  if (!channel && !commit && !batch && !rest) return null;
  const transport = channel ? 'write_channel' : commit ? 'commit' : batch ? 'batch_write' : 'rest';
  const result = (classification, collections = []) => redactedWriteObservation({ transport, classification, collections });
  const unknown = (collections = []) => result('unclassified', collections);
  const targets = [];
  let malformed = false;
  const target = name => {
    if (typeof name !== 'string') { malformed = true; return; }
    const match = name.match(/^projects\/[^/]+\/databases\/[^/]+\/documents\/(.+)$/u);
    const parts = match?.[1].split('/');
    if (!parts || parts.length < 2 || parts.length % 2 || parts.some(part => !part)) { malformed = true; return; }
    targets.push(parts.filter((_, index) => index % 2 === 0));
  };
  const envelope = message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || Object.keys(message).some(key => !['database', 'streamToken', 'streamId', 'writes', 'labels', 'transaction'].includes(key))) {
      malformed = true; return;
    }
    if (Array.isArray(message.writes) && message.writes.length) {
      for (const write of message.writes) {
        if (!write || typeof write !== 'object') { malformed = true; continue; }
        const actions = ['update', 'delete', 'transform'].filter(key => Object.hasOwn(write, key));
        if (actions.length !== 1 || Object.keys(write).some(key => ![
          'update', 'delete', 'transform', 'updateMask', 'updateTransforms', 'currentDocument',
        ].includes(key))) { malformed = true; continue; }
        target(actions[0] === 'update' ? write.update?.name : actions[0] === 'delete' ? write.delete : write.transform?.document);
      }
      return;
    }
    // Handshake/token-only/empty-drain messages contain no mutation. SDK PersistentWriteStream.ra/ea.
    const handshake = typeof message.database === 'string' && /^projects\/[^/]+\/databases\/[^/]+$/u.test(message.database);
    const token = typeof message.streamToken === 'string';
    if (!channel || (!handshake && !token) || message.writes !== undefined && (!Array.isArray(message.writes) || message.writes.length)) malformed = true;
  };
  try {
    if (channel && method === 'GET' && !postData && (url.searchParams.get('RID') === 'rpc' || url.searchParams.get('TYPE') === 'terminate')) return result('protocol');
    if (channel || commit || batch) {
      if (method !== 'POST' || typeof postData !== 'string' || !postData) return unknown();
      if (postData.trim().startsWith('{')) envelope(JSON.parse(postData));
      else if (channel) {
        const form = new URLSearchParams(postData);
        const count = form.get('count');
        const messages = [...form.entries()].filter(([key]) => /^req\d+___data__$/u.test(key));
        // encodeInitMessageHeaders puts credentials in this opaque form field. Never read/export its value.
        if (!/^\d+$/u.test(count ?? '') || Number(count) !== messages.length
          || new Set(form.keys()).size !== [...form.keys()].length
          || [...form.keys()].some(key => !['count', 'ofs', 'headers'].includes(key) && !/^req\d+___data__$/u.test(key))) return unknown();
        for (let i = 0; i < messages.length; i++) {
          const data = form.get(`req${i}___data__`);
          if (data === null) { malformed = true; continue; }
          envelope(JSON.parse(data));
        }
      } else return unknown();
    } else {
      const resource = decodeURIComponent(url.pathname.replace(/^\/v1\//u, ''));
      if (method === 'POST') {
        const body = JSON.parse(postData);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return unknown();
        target(`${resource}/__created_document__`);
        if (body.name !== undefined) target(body.name);
      } else target(resource);
    }
  } catch { return unknown(targets.flat()); }
  const collections = targets.flat();
  if (collections.some(name => PROTECTED_COLLECTIONS.has(name))) return result('forbidden', collections);
  if (malformed || targets.some(path => path.length !== 1 || !ALLOWED_COLLECTIONS.has(path[0]))) return unknown(collections);
  return result(targets.length ? 'allowed' : 'protocol', collections);
}
