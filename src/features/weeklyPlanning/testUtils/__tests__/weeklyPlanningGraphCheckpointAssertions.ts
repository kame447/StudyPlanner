import { expect } from 'vitest';
import type { WeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5, validateWeeklyPlanningFactGraphValueV5 } from '../../semantic/weeklyPlanningFactGraphValidatorV5';
import { prepareWeeklyPlanningStableV5Checkpoint } from '../../application/weeklyPlanningStableV5SessionCodec';
import { getWeeklyPlanningStableV5SessionStorageKeyForTest, loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from '../../application/weeklyPlanningStableV5SessionStorage';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../weeklyPlanningApplicationTestHarness';

/** Real graph/session boundaries shared by value-contract tests; no provider or factory policy. */
export function createGraphCheckpointAssertions(scope: { ownerId: string; weekStartDate: string; conversationId: string }) {
  const { storage } = createMemoryStorageHarness();
  const restore = installWeeklyPlanningTestStorage(storage);
  const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(scope.ownerId, scope.weekStartDate);
  const parameters = (graph: WeeklyPlanningFactGraphV5) => ({ ...scope, graph, planningState: createInitialPlanningState(scope.weekStartDate) });
  const load = () => loadWeeklyPlanningStableV5PersistedSession(scope);
  const save = (graph: WeeklyPlanningFactGraphV5) => saveWeeklyPlanningStableV5PersistedSession(parameters(graph));
  let original: string | null = null;
  return {
    restore, load, save,
    roundTrip(graph: WeeklyPlanningFactGraphV5) {
      expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).graph).toEqual(graph);
      expect(save(graph)).toBe(true);
      expect(load()?.graph).toEqual(graph);
      original = storage.getItem(key);
    },
    reject(graph: WeeklyPlanningFactGraphV5) {
      if (original === null) throw new Error('A valid checkpoint must be saved before testing rejection');
      expect(validateWeeklyPlanningFactGraphValueV5(graph).graph).toBeNull();
      expect(parseWeeklyPlanningFactGraphV5(JSON.stringify(graph)).graph).toBeNull();
      expect(() => serializeWeeklyPlanningFactGraphV5(graph)).toThrow('Invalid WeeklyPlanningFactGraphV5');
      expect(prepareWeeklyPlanningStableV5Checkpoint(parameters(graph)).status).not.toBe('ready');
      expect(save(graph)).toBe(false);
      expect(storage.getItem(key)).toBe(original); // Direct save only; owner fallback is a separate contract.
      const corrupted = JSON.parse(original); corrupted.graph = graph;
      storage.setItem(key, JSON.stringify(corrupted));
      expect(load()).toBeNull();
    },
  };
}
