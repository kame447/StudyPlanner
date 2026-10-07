import { readStartupSearch, resolveStartupDiagnosticChoice } from './startupDiagnosticChoice';
import type { FirestoreSettings } from 'firebase/firestore';

export type StartupFirestoreTransport = 'forced' | 'auto' | 'streaming';

export function resolveStartupFirestoreTransport(search: string): StartupFirestoreTransport {
  return resolveStartupDiagnosticChoice(search, 'startupTransport', ['forced', 'auto', 'streaming'], 'forced');
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

// One choice per JS document. Changing an SPA URL cannot reconfigure Firestore
// or relabel an existing instance. Nothing is stored or transmitted by this selector.
export const startupFirestoreTransport = resolveStartupFirestoreTransport(readStartupSearch());
