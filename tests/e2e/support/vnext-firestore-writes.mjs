import { classifyFirestoreWrite } from './d5-production-smoke-observation.mjs';

// Phase-scoped record of the page's Firestore writes (classification and collection names only; never bodies).
// A flow declares which phases may write: every phase starts as 'none' (no write is allowed); the sweep, the approved save
// and the cleanup are authorized phases whose writes are recorded but are not violations. The emulator's Firestore host
// is classified exactly like production's, so the same contract runs in CI.
const HOSTS = new Set(['firestore.googleapis.com', '127.0.0.1', 'localhost']);
const PRODUCTION_HOST = 'firestore.googleapis.com';
const EMULATOR_PORT = '8180';

export const NO_WRITE_PHASE = 'none';

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
      const write = classifyFirestoreWrite({ url: parsed.toString(), method, postData });
      if (!write) return null;
      const entry = { phase, ...write };
      writes.push(entry);
      return entry;
    },
    writes: () => [...writes],
    /** Writes made where none is authorized: forbidden ones, and any that could not be classified. */
    violations: () => writes.filter(write => write.phase === NO_WRITE_PHASE && write.classification !== 'protocol' && write.classification !== 'allowed'),
    inPhase: name => writes.filter(write => write.phase === name),
  };
}

/** The approved save must be visible to the observer: a forbidden-classified write to a protected collection. */
export const protectedWritesIn = writes => writes.filter(write => write.classification === 'forbidden');

export function attachWriteLedger(page, ledger = createWriteLedger()) {
  page.on('request', request => { ledger.record({ url: request.url(), method: request.method(), postData: request.postData() }); });
  return ledger;
}
