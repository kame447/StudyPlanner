import type { FirestoreSettings } from 'firebase/firestore';

export type StartupFirestoreTransport = 'forced' | 'auto' | 'streaming';

export function resolveStartupFirestoreTransport(search: string): StartupFirestoreTransport {
  try {
    const query = new URLSearchParams(search);
    if (query.getAll('startupTiming').length !== 1 || query.get('startupTiming') !== '1'
      || query.getAll('startupTransport').length !== 1) return 'forced';
    const transport = query.get('startupTransport');
    return transport === 'auto' || transport === 'streaming' ? transport : 'forced';
  } catch {
    return 'forced';
  }
}

export function firestoreTransportSettings(transport: StartupFirestoreTransport): FirestoreSettings {
  if (transport === 'auto') return {
    experimentalForceLongPolling: false,
    experimentalAutoDetectLongPolling: true,
  };
  if (transport === 'streaming') return {
    experimentalForceLongPolling: false,
    experimentalAutoDetectLongPolling: false,
  };
  // Preserve the historical reliability setting exactly for ordinary launches.
  return { experimentalForceLongPolling: true };
}

function initialSearch(): string {
  try { return typeof window === 'undefined' ? '' : window.location.search; }
  catch { return ''; }
}

// One choice per JS document. Changing an SPA URL cannot reconfigure Firestore
// or relabel an existing instance. Nothing is stored or transmitted by this selector.
export const startupFirestoreTransport = resolveStartupFirestoreTransport(initialSearch());
