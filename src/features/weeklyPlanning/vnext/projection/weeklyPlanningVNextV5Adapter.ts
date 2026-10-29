// Read-only conversion of a saved Stable V5 Fact Graph into VNext state.
// Mechanical only: stored derived values are dropped, estimate targets become
// lineage bindings with the amount they were stated for, and anything that
// cannot be identified is left unbound so the projection asks again.
import { filterActiveWeeklyPlanningFactsV5 } from '../../semantic/weeklyPlanningFactLifecycleV5';
import type {
  EffortEstimateFactV5,
  WeeklyPlanningFactGraphV5,
  WorkloadFactV5,
} from '../../semantic/weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_VNEXT_STATE_VERSION,
  type VNextEffortEstimateFact,
  type VNextEffortWorkBinding,
  type WeeklyPlanningVNextGraph,
  type WeeklyPlanningVNextState,
} from '../weeklyPlanningVNextTypes';
import {
  computeVNextWorkUnits,
  createVNextLineageResolver,
  vnextQuantityBasisKey,
} from '../weeklyPlanningVNextWorkIdentity';

/** Markers V5 writers put on workloads they computed rather than the user stated. */
const V5_DERIVED_WORKLOAD_MARKERS = [':derived-remaining-percent:', ':derived-bounded-remaining:'] as const;
/** V5 progress reconciliation rewrote a stated remaining (#919); kept, but reported. */
const V5_REBASED_REMAINING_MARKER = ':progress-rebase:';

export type WeeklyPlanningVNextAdapterNote =
  | { code: 'derived_workload_dropped'; factId: string }
  | { code: 'rebased_remaining_kept'; factId: string }
  | { code: 'effort_bound'; factId: string; workLineageId: string; boundAmount: number }
  | { code: 'effort_unbound_target_unidentified'; factId: string }
  | { code: 'custom_rate_label_unresolved'; factId: string };

export interface WeeklyPlanningVNextAdapterResult {
  state: WeeklyPlanningVNextState;
  notes: WeeklyPlanningVNextAdapterNote[];
}

function isDerivedWorkload(workload: WorkloadFactV5): boolean {
  return V5_DERIVED_WORKLOAD_MARKERS.some((marker) => workload.source.semanticLocalId.includes(marker));
}

export function adaptWeeklyPlanningV5GraphToVNext(
  v5Graph: WeeklyPlanningFactGraphV5,
): WeeklyPlanningVNextAdapterResult {
  const notes: WeeklyPlanningVNextAdapterNote[] = [];
  const derived = v5Graph.workloads.filter(isDerivedWorkload);
  const derivedIds = new Set(derived.map((workload) => workload.id));
  for (const workload of derived) notes.push({ code: 'derived_workload_dropped', factId: workload.id });
  for (const workload of filterActiveWeeklyPlanningFactsV5(v5Graph, v5Graph.workloads)) {
    if (workload.source.semanticLocalId.includes(V5_REBASED_REMAINING_MARKER)) {
      notes.push({ code: 'rebased_remaining_kept', factId: workload.id });
    }
  }

  // Derived workloads stay as removed history, so every stored reference still resolves;
  // only stated facts remain active. Estimates on them are converted below.
  const statedGraph: WeeklyPlanningFactGraphV5 = {
    ...v5Graph,
    factLifecycles: v5Graph.factLifecycles.map((entry) =>
      derivedIds.has(entry.factId) && entry.status === 'active'
        ? { ...entry, status: 'removed' as const, terminalRevision: v5Graph.revision, supersededByFactId: null }
        : entry),
  };
  const shellGraph: WeeklyPlanningVNextGraph = {
    ...statedGraph,
    effortEstimates: [],
  };
  const resolver = createVNextLineageResolver(shellGraph);
  const units = computeVNextWorkUnits(shellGraph).flatMap((owner) => owner.units);
  const workloadsById = new Map(v5Graph.workloads.map((workload) => [workload.id, workload]));
  const activeStated = filterActiveWeeklyPlanningFactsV5(shellGraph, shellGraph.workloads);

  type Conversion =
    | { kind: 'unchanged' }
    | { kind: 'bound'; binding: VNextEffortWorkBinding; targetFactId: string }
    | { kind: 'unidentified' };
  const convert = (effort: EffortEstimateFactV5): Conversion => {
    const target = workloadsById.get(effort.targetFactId);
    if (!target) return { kind: 'unchanged' }; // task or component scope
    if (derivedIds.has(target.id)) {
      // An estimate on a stored derived remaining belongs to the stated work of the same
      // owner and basis; a total keeps the amount it was stated for.
      const matches = units.filter((unit) => unit.role === 'remaining'
        && unit.ownerKey === resolver.ownerKeyOf(target)
        && unit.basisKey === vnextQuantityBasisKey(target));
      if (matches.length !== 1) return { kind: 'unidentified' };
      return {
        kind: 'bound',
        targetFactId: matches[0].definingFactId,
        binding: { workLineageId: matches[0].workLineageId, boundAmount: target.amount },
      };
    }
    // Stated workload (any version): its lineage, at the amount of the version it targeted.
    return {
      kind: 'bound',
      targetFactId: effort.targetFactId,
      binding: { workLineageId: resolver.lineageOf(target.id), boundAmount: target.amount },
    };
  };

  const customLabelFor = (effort: EffortEstimateFactV5): string | null => {
    if (effort.unitCode !== 'custom') return null;
    const target = workloadsById.get(effort.targetFactId);
    if (target && target.unitCode === 'custom') return target.unitLabel;
    // Task/component-scoped custom rate: only a single custom label in that scope is unambiguous.
    const targetLineage = resolver.lineageOf(effort.targetFactId);
    const labels = new Set(activeStated
      .filter((workload) => workload.unitCode === 'custom'
        && (resolver.lineageOf(workload.taskId) === targetLineage
          || (workload.componentId !== null && resolver.lineageOf(workload.componentId) === targetLineage)))
      .map((workload) => workload.unitLabel.normalize('NFKC').trim()));
    return labels.size === 1 ? [...labels][0] : null;
  };

  const effortEstimates: VNextEffortEstimateFact[] = statedGraph.effortEstimates.map((effort) => {
    const conversion = convert(effort);
    const unitLabel = customLabelFor(effort);
    if (effort.unitCode === 'custom' && effort.kind === 'duration_per_unit' && unitLabel === null) {
      notes.push({ code: 'custom_rate_label_unresolved', factId: effort.id });
    }
    if (conversion.kind === 'unidentified') {
      // Left on the removed derived workload: it measures nothing and the work is asked again.
      notes.push({ code: 'effort_unbound_target_unidentified', factId: effort.id });
      return { ...effort, unitLabel, workBinding: null };
    }
    if (conversion.kind === 'unchanged') return { ...effort, unitLabel, workBinding: null };
    const workBinding = effort.kind === 'total_duration' ? conversion.binding : null;
    if (workBinding) notes.push({ code: 'effort_bound', factId: effort.id, ...workBinding });
    return { ...effort, targetFactId: conversion.targetFactId, unitLabel, workBinding };
  });

  return {
    state: {
      version: WEEKLY_PLANNING_VNEXT_STATE_VERSION,
      graph: { ...statedGraph, effortEstimates },
      workRelations: [],
      deferrals: [],
    },
    notes,
  };
}
