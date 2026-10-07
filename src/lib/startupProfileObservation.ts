import { readStartupSearch, resolveStartupDiagnosticChoice } from './startupDiagnosticChoice';

export type StartupProfileObservation = 'off' | 'observe';
export function resolveStartupProfileObservation(search: string): StartupProfileObservation {
  return resolveStartupDiagnosticChoice(search, 'startupProfile', ['off', 'observe'], 'off');
}
// Diagnostic only, fixed once per document and never persisted.
export const startupProfileObservation = resolveStartupProfileObservation(readStartupSearch());
