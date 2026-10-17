import type { SemanticMemoryCanonicalView, SemanticMemoryEmbedder, SemanticMemoryRecallResult,
  SemanticMemoryUnavailableReason } from '../semanticMemoryContract';
import { eraseAllSemanticMemoryIndexes, semanticMemoryAccess } from '../semanticMemoryOptIn';
import { SemanticMemoryIndex } from './semanticMemoryIndex';

interface SemanticMemoryApplicationPorts {
  access?: (ownerId: string) => Promise<SemanticMemoryUnavailableReason | null>;
  createEmbedder?: () => Promise<SemanticMemoryEmbedder>;
  erase?: typeof eraseAllSemanticMemoryIndexes;
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
}

/** Owns optional cache work; React and prompt callers never manage model/storage lifetimes. */
export function createSemanticMemoryApplication(ports: SemanticMemoryApplicationPorts = {}) {
  let current: OwnerSession | undefined;
  let erasing = Promise.resolve();
  let cleanupFailed = false;
  const access = ports.access ?? semanticMemoryAccess;
  const dispose = (session: OwnerSession) => {
    session.active = false;
    session.controller?.abort();
    session.index?.dispose();
    void session.embedder?.dispose().catch(() => undefined);
    session.canonical = null;
  };
  const isCurrent = (session: OwnerSession) => current === session && session.active;
  const getIndex = async (session: OwnerSession): Promise<SemanticMemoryIndex | null> => {
    if (import.meta.env.VITE_SEMANTIC_MEMORY_ENABLED !== 'true') return null;
    if (!isCurrent(session) || await access(session.ownerId)) return null;
    await erasing;
    if (!isCurrent(session) || cleanupFailed || await access(session.ownerId)) return null;
    session.opening ??= (async () => {
      const embedder = ports.createEmbedder ? await ports.createEmbedder()
        : (await import('../runtime')).createSemanticMemoryEmbedder({ enabled: true, optedIn: true });
      if (!isCurrent(session) || await access(session.ownerId)) {
        await embedder.dispose();
        return null;
      }
      session.embedder = embedder;
      session.index = new SemanticMemoryIndex({ ownerId: session.ownerId, embedder,
        access: () => access(session.ownerId), getCanonicalView: () => {
          if (!isCurrent(session) || !session.canonical) throw new Error('canonical owner scope expired');
          return session.canonical;
        } });
      return session.index;
    })();
    return session.opening;
  };

  return {
    /** Synchronous invalidation precedes asynchronous erasure; never blocks authentication. */
    ownerChanged() {
      if (current) dispose(current);
      current = undefined;
      erasing = erasing.catch(() => undefined).then(async () => {
        cleanupFailed = (await (ports.erase ?? eraseAllSemanticMemoryIndexes)()).status !== 'ok';
      }).catch(() => { cleanupFailed = true; });
    },
    connect(ownerId: string) {
      if (current) dispose(current);
      const session: OwnerSession = { ownerId, active: true, canonical: null, revisionFence: -1,
        controller: undefined, index: undefined, embedder: undefined, opening: undefined,
        syncing: undefined, syncedRevision: -1 };
      current = session;
      return {
        publish(view: SemanticMemoryCanonicalView) {
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
          if (import.meta.env.VITE_SEMANTIC_MEMORY_ENABLED !== 'true') return;
          session.controller?.abort();
          const controller = new AbortController();
          session.controller = controller;
          session.syncing = (async () => {
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
