import { onSnapshot, type DocumentReference } from 'firebase/firestore';
import { startupTiming, type StartupPhase } from '../lib/startupTiming';
import type { StartupSessionCapability } from '../lib/startupSessionScope';

// Observe metadata only. The caller's ordinary authoritative read remains intact.
export function observeStartupDocument({ reference, scope, phase, stopPhase }: {
  reference: DocumentReference;
  scope: StartupSessionCapability;
  phase: StartupPhase;
  stopPhase: StartupPhase;
}): () => void {
  if (!scope.isCurrent()) return () => {};
  const finish = startupTiming.begin(phase);
  let closed = false;
  let failed = false;
  let unsubscribe: (() => void) | null = null;
  let unregister: () => void = () => {};
  const stop = () => {
    if (closed) return;
    closed = true;
    unregister();
    try { unsubscribe?.(); }
    catch { failed = true; }
    finally {
      finish(failed ? 'error' : 'cancelled');
      startupTiming.begin(stopPhase)(failed ? 'error' : 'success');
    }
  };
  try {
    unsubscribe = onSnapshot(reference, { includeMetadataChanges: true }, snapshot => {
      if (closed) return;
      if (!scope.isCurrent()) { stop(); return; }
      if (snapshot.metadata?.fromCache === false && snapshot.metadata.hasPendingWrites === false) finish('success');
    }, () => { failed = true; finish('error'); stop(); });
    if (closed) unsubscribe();
    else unregister = scope.onInvalidate(stop);
  } catch { failed = true; finish('error'); stop(); }
  return stop;
}
