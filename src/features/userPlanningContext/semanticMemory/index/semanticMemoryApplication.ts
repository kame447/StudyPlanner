import { SemanticMemoryUnavailableError, type SemanticMemoryCanonicalView, type SemanticMemoryEmbedder, type SemanticMemoryRecallResult,
  type SemanticMemoryUnavailableReason } from '../semanticMemoryContract';
import { eraseAllSemanticMemoryIndexes, prepareSemanticMemoryOwner, semanticMemoryAccess } from '../semanticMemoryOptIn';
import { SEMANTIC_MEMORY_MODEL } from '../runtime/model';
import { SemanticMemoryIndexedDbStore } from './semanticMemoryIndexedDb';
import { reconcileSemanticMemoryView, SemanticMemoryIndex } from './semanticMemoryIndex';

interface SemanticMemoryApplicationPorts {
  access?: (ownerId: string) => Promise<SemanticMemoryUnavailableReason | null>;
  createEmbedder?: () => Promise<SemanticMemoryEmbedder>;
  erase?: typeof eraseAllSemanticMemoryIndexes;
  prepare?: typeof prepareSemanticMemoryOwner;
}
interface OwnerSession {
  ownerId: string;
  active: boolean;
  canonical: SemanticMemoryCanonicalView | null;
  revisionFence: number;
  controller: AbortController | undefined;
  index: SemanticMemoryIndex | undefined;
  embedder: SemanticMemoryEmbedder | undefined;
  opening: Promise<SemanticMemoryIndex | null> | undefined;
  syncing: Promise<void> | undefined;
  syncedRevision: number;
  resourcesGeneration: number;
  store: SemanticMemoryIndexedDbStore | undefined;
}

/** Owns optional cache work; React and prompt callers never manage model/storage lifetimes. */
export function createSemanticMemoryApplication(ports: SemanticMemoryApplicationPorts = {}) {
  let current: OwnerSession | undefined;
  let erasing = Promise.resolve();
  let cleanupFailed = false;
  const access = ports.access ?? semanticMemoryAccess;
  const resetResources = (session: OwnerSession) => {
    session.resourcesGeneration += 1;
    session.controller?.abort();
    session.index?.dispose();
    session.store?.dispose();
    void session.embedder?.dispose().catch(() => undefined);
    session.index = undefined;
    session.store = undefined;
    session.embedder = undefined;
    session.opening = undefined;
    session.syncedRevision = -1;
  };
  const dispose = (session: OwnerSession) => {
    session.active = false;
    resetResources(session);
    session.canonical = null;
  };
  const isCurrent = (session: OwnerSession) => current === session && session.active;
  const allowed = async (session: OwnerSession) => {
    if (!isCurrent(session)) return false;
    const reason = await access(session.ownerId);
    if (reason) resetResources(session);
    return !reason && isCurrent(session);
  };
  const getStore = (session: OwnerSession) => session.store ??=
    new SemanticMemoryIndexedDbStore(session.ownerId, SEMANTIC_MEMORY_MODEL);
  const getIndex = async (session: OwnerSession): Promise<SemanticMemoryIndex | null> => {
    if (import.meta.env.VITE_SEMANTIC_MEMORY_ENABLED !== 'true') return null;
    await erasing;
    if (session.store?.revoked) resetResources(session);
    if (cleanupFailed || !await allowed(session)) return null;
    const generation = session.resourcesGeneration;
    const opening = session.opening ??= (async () => {
      const embedder = ports.createEmbedder ? await ports.createEmbedder()
        : (await import('../runtime')).createSemanticMemoryEmbedder({ enabled: true, optedIn: true });
      if (!await allowed(session) || generation !== session.resourcesGeneration) {
        await embedder.dispose();
        return null;
      }
      session.embedder = embedder;
      session.index = new SemanticMemoryIndex({ ownerId: session.ownerId, embedder,
        store: getStore(session),
        access: async () => {
          const reason = await access(session.ownerId);
          if (reason) resetResources(session);
          return reason;
        }, getCanonicalView: () => {
          if (!isCurrent(session) || !session.canonical) throw new Error('canonical owner scope expired');
          return session.canonical;
        } });
      return session.index;
    })();
    try { return await opening; }
    finally {
      // Creation failure/withdrawn consent is retryable in this session.
      if (session.opening === opening && !session.index) session.opening = undefined;
    }
  };

  return {
    /** Synchronous invalidation precedes asynchronous erasure; never blocks authentication. */
    ownerChanged() {
      if (current) dispose(current);
      current = undefined;
      // Start immediately: erase records its durable marker before any async yield.
      const started = (ports.erase ?? eraseAllSemanticMemoryIndexes)();
      erasing = Promise.all([erasing, started]).then(([, result]) => {
        cleanupFailed = result.status !== 'ok';
      }).catch(() => { cleanupFailed = true; });
    },
    connect(ownerId: string) {
      if (current) dispose(current);
      const session: OwnerSession = { ownerId, active: true, canonical: null, revisionFence: -1,
        controller: undefined, index: undefined, embedder: undefined, opening: undefined,
        syncing: undefined, syncedRevision: -1, resourcesGeneration: 0, store: undefined };
      current = session;
      erasing = erasing.then(async () => {
        if (isCurrent(session)) {
          const result = await (ports.prepare ?? prepareSemanticMemoryOwner)(ownerId);
          cleanupFailed ||= result.status !== 'ok';
        }
      }).catch(() => { cleanupFailed = true; });
      return {
        publish(view: SemanticMemoryCanonicalView) {
          // Flag-OFF still permits startup/owner cleanup, but never copies canonical records.
          if (import.meta.env.VITE_SEMANTIC_MEMORY_ENABLED !== 'true') return;
          if (!isCurrent(session) || view.ownerId !== ownerId || !Number.isSafeInteger(view.revision)
            || view.revision < 0 || view.revision < session.revisionFence
            || (!session.canonical && view.revision === session.revisionFence)) return;
          if (session.canonical?.revision === view.revision
            && JSON.stringify(view.records) !== JSON.stringify(session.canonical.records)) {
            // A conflicting same-revision delivery is missing canonical evidence, never old truth.
            session.controller?.abort();
            session.canonical = null;
            return;
          }
          session.revisionFence = view.revision;
          session.canonical = { ...view, records: view.records.map((record) => ({ ...record })) };
          session.controller?.abort();
          const controller = new AbortController();
          session.controller = controller;
          session.syncing = (async () => {
            await erasing;
            if (cleanupFailed || !await allowed(session) || controller.signal.aborted) return;
            await reconcileSemanticMemoryView(getStore(session), session.canonical!, async () => {
              if (controller.signal.aborted || !await allowed(session) || controller.signal.aborted) {
                throw new SemanticMemoryUnavailableError('aborted');
              }
            });
            const index = await getIndex(session);
            if (index && isCurrent(session) && !controller.signal.aborted) {
              const result = await index.sync(controller.signal);
              if (result.status === 'ok' && result.remaining === 0 && !controller.signal.aborted
                && session.canonical?.revision === view.revision) session.syncedRevision = view.revision;
            }
          })().catch(() => undefined);
        },
        dispose() {
          dispose(session);
          if (current === session) current = undefined;
        },
      };
    },
    canonical(ownerId: string): SemanticMemoryCanonicalView | null {
      return current?.active && current.ownerId === ownerId ? current.canonical : null;
    },
    async recall(ownerId: string, query: string, signal?: AbortSignal): Promise<SemanticMemoryRecallResult> {
      const session = current;
      if (!session || session.ownerId !== ownerId || !session.canonical) {
        return { status: 'unavailable', reason: 'owner_mismatch' };
      }
      try {
        await session.syncing;
        const index = await getIndex(session);
        if (!index || !isCurrent(session)) return { status: 'unavailable', reason: 'not_opted_in' };
        // Consent may have been granted after canonical hydration. Build lazily on first recall.
        const revision = session.canonical?.revision;
        if (revision !== undefined && session.syncedRevision !== revision) {
          const result = await index.sync(signal);
          if (result.status === 'unavailable') return result;
          if (result.remaining === 0 && session.canonical?.revision === revision) session.syncedRevision = revision;
        }
        return await index.recall(query, signal);
      } catch { return { status: 'unavailable', reason: 'internal_error' }; }
    },
  };
}

export const semanticMemoryApplication = createSemanticMemoryApplication();
