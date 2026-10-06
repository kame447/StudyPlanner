import { readStartupSearch, resolveStartupDiagnosticChoice } from './startupDiagnosticChoice';
export type StartupMarkerObservation = 'off' | 'observe';
export function resolveStartupMarkerObservation(search: string): StartupMarkerObservation {
  return resolveStartupDiagnosticChoice(search, 'startupMarker', ['off', 'observe'], 'off');
}
// Fixed for this JS document; no persistent preference is changed.
export const startupMarkerObservation = resolveStartupMarkerObservation(readStartupSearch());
