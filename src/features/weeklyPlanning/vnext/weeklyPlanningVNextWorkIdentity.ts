// Shared identity rules for the VNext core: lineage, unit identity, quantity
// basis, and which amount of work a workload stands for. Pure and deterministic.
import { filterActiveWeeklyPlanningFactsV5 } from '../semantic/weeklyPlanningFactLifecycleV5';
import type { WorkloadFactV5 } from './weeklyPlanningVNextV5Boundary';
import type {
  VNextEffortWorkBinding,
  WeeklyPlanningVNextGraph,
} from './weeklyPlanningVNextTypes';

/**
 * Lineage of every fact that has a lifecycle entry: the first version of its
 * supersede chain. A removed fact ends its lineage; a fact added afterwards
 * starts a new one even when its values are equal.
 * Each version's root is resolved once per call and reused by the versions after it,
 * so a long correction history costs linear, not quadratic, work (it is resolved in
 * the transaction, projection, provider and renderer alike). Nothing is cached across
 * calls. A malformed cycle still stops at the first repeated version and is not reused.
 * Tests: __tests__/weeklyPlanningVNextWorkIdentity.test.ts (lineage).
 */
export function vnextLineageIdByFactId(
  graph: Pick<WeeklyPlanningVNextGraph, 'factLifecycles'>,
): Map<string, string> {
  const predecessor = new Map<string, string>();
  for (const entry of graph.factLifecycles) {
    if (entry.status === 'superseded' && entry.supersededByFactId) {
      predecessor.set(entry.supersededByFactId, entry.factId);
    }
  }
  const lineage = new Map<string, string>();
  // Roots of versions whose walk ended at a first version; only these are reused.
  const settled = new Map<string, string>();
  for (const entry of graph.factLifecycles) {
    const path = [entry.factId];
    const seen = new Set(path);
    let root = entry.factId;
    let resolved = settled.get(root);
    let cyclic = false;
    while (resolved === undefined && predecessor.has(root)) {
      root = predecessor.get(root)!;
      if (seen.has(root)) { cyclic = true; break; } // malformed cycle: stop rather than loop
      seen.add(root);
      resolved = settled.get(root);
      path.push(root);
    }
    if (cyclic) {
      lineage.set(entry.factId, root);
    } else {
      for (const factId of path) settled.set(factId, resolved ?? root);
      lineage.set(entry.factId, resolved ?? root);
    }
  }
  return lineage;
}

export interface VNextLineageResolver {
  lineageOf(factId: string): string;
  /** Active version of the fact's lineage, or null when the lineage ended. */
  leafOf(factId: string): string | null;
  /** Owner identity that survives a task/component patch. */
  ownerKeyOf(fact: { taskId: string; componentId: string | null }): string;
}

export function createVNextLineageResolver(
  graph: Pick<WeeklyPlanningVNextGraph, 'factLifecycles'>,
): VNextLineageResolver {
  const lineage = vnextLineageIdByFactId(graph);
  const lineageOf = (factId: string) => lineage.get(factId) ?? factId;
  const leafByLineage = new Map<string, string>();
  for (const entry of graph.factLifecycles) {
    if (entry.status === 'active') leafByLineage.set(lineageOf(entry.factId), entry.factId);
  }
  return {
    lineageOf,
    leafOf: (factId) => leafByLineage.get(lineageOf(factId)) ?? null,
    ownerKeyOf: (fact) => `${lineageOf(fact.taskId)}/${fact.componentId === null ? '' : lineageOf(fact.componentId)}`,
  };
}

/** The fact references a graph carries, by collection: the one list both scheduling and dialogue follow. */
interface VNextReferencingFacts {
  readonly studyContexts: ReadonlyArray<{ taskId: string }>;
  readonly components: ReadonlyArray<{ taskId: string; parentComponentId: string | null }>;
  readonly workloads: ReadonlyArray<{ taskId: string; componentId: string | null }>;
  readonly effortEstimates: ReadonlyArray<{ taskId: string; targetFactId: string }>;
  readonly temporalConstraints: ReadonlyArray<{ taskId: string; targetFactId: string }>;
  readonly taskDateRules: ReadonlyArray<{ taskId: string; targetFactId: string }>;
  readonly recurrences: ReadonlyArray<{ taskId: string; targetFactId: string }>;
  readonly relations: ReadonlyArray<{ fromTaskId: string; toTaskId: string }>;
}

/**
 * The same facts with every reference naming the current version of the fact it points to (a
 * renamed task keeps its work). Pure and read-only: stored facts keep their history.
 * Every consumer that follows references (scheduling, the renderer's view) uses this; a new
 * reference-bearing collection is added here once. Breaks if a consumer maps its own list: it
 * misses a field and loses renamed owners (Astra VP03, user audit S03). Tests: SchedulerGraph
 * "uses the renamed task in the scheduling view…", ExperimentalSession integration "explains
 * each result through the Stable V5 renderer…" (rename case).
 */
export function withCurrentVNextReferences<G extends VNextReferencingFacts>(graph: G, current: (id: string) => string): G {
  const orNull = (id: string | null) => (id === null ? null : current(id));
  const owned = <T extends { taskId: string; targetFactId: string }>(fact: T): T =>
    ({ ...fact, taskId: current(fact.taskId), targetFactId: current(fact.targetFactId) });
  return {
    ...graph,
    studyContexts: graph.studyContexts.map((fact) => ({ ...fact, taskId: current(fact.taskId) })),
    components: graph.components.map((fact) => ({ ...fact, taskId: current(fact.taskId), parentComponentId: orNull(fact.parentComponentId) })),
    workloads: graph.workloads.map((fact) => ({ ...fact, taskId: current(fact.taskId), componentId: orNull(fact.componentId) })),
    effortEstimates: graph.effortEstimates.map(owned),
    temporalConstraints: graph.temporalConstraints.map(owned),
    taskDateRules: graph.taskDateRules.map(owned),
    recurrences: graph.recurrences.map(owned),
    relations: graph.relations.map((fact) => ({ ...fact, fromTaskId: current(fact.fromTaskId), toTaskId: current(fact.toTaskId) })),
  };
}

/** Unit identity: the unit code, plus the NFKC-normalized label for custom units. */
export function vnextUnitIdentity(unit: { unitCode: string | null; unitLabel: string | null }): string {
  const label = unit.unitCode === 'custom' ? (unit.unitLabel ?? '').normalize('NFKC').trim() : '';
  return `${unit.unitCode ?? ''}|${label}`;
}

const PERCENT_UNIT_IDENTITY = vnextUnitIdentity({ unitCode: 'custom', unitLabel: '%' });

export function isVNextPercentUnit(unit: { unitCode: string | null; unitLabel: string | null }): boolean {
  return vnextUnitIdentity(unit) === PERCENT_UNIT_IDENTITY;
}

/** Quantity basis: unit identity, range, per-occurrence and period. */
export function vnextQuantityBasisKey(workload: Pick<WorkloadFactV5,
  'unitCode' | 'unitLabel' | 'rangeStart' | 'rangeEnd' | 'perOccurrence' | 'periodExpression'>): string {
  return [
    vnextUnitIdentity(workload),
    workload.rangeStart ?? '',
    workload.rangeEnd ?? '',
    workload.perOccurrence ? '1' : '0',
    workload.periodExpression ?? '',
  ].join('|');
}

/**
 * The one validity rule for a stated quantity's basis: a range has both ends.
 * The transaction rejects violations; the projector asks about them in data
 * that was saved before VNext (V5 accepted a one-ended range into its graph).
 */
export function isValidVNextQuantityBasis(workload: Pick<WorkloadFactV5, 'rangeStart' | 'rangeEnd'>): boolean {
  return (workload.rangeStart === null) === (workload.rangeEnd === null);
}

export interface VNextWorkUnit {
  workLineageId: string;
  definingFactId: string;
  ownerKey: string;
  basisKey: string;
  role: 'target' | 'remaining';
  derivedFromTotal: boolean;
  amount: number;
  workload: WorkloadFactV5;
}

export type VNextWorkUnitIssue =
  | { code: 'quantity_role_unresolved'; ownerKey: string; lineageIds: string[] }
  | { code: 'quantity_basis_invalid'; ownerKey: string; lineageIds: string[] }
  | { code: 'duplicate_quantity'; ownerKey: string; basisKey: string; lineageIds: string[] }
  | { code: 'completed_exceeds_total'; ownerKey: string; basisKey: string; lineageIds: string[] }
  | {
      code: 'remaining_inconsistent';
      ownerKey: string;
      basisKey: string;
      lineageIds: string[];
      /** Null when a percent total of 100 is implied. */
      totalFactId: string | null;
      completedFactId: string;
      remainingFactId: string;
      totalAmount: number;
      derivedAmount: number;
      statedAmount: number;
    };

export interface VNextWorkUnitsByOwner {
  ownerKey: string;
  taskId: string;
  componentId: string | null;
  units: VNextWorkUnit[];
  /** First blocking issue of the owner; units are empty when set. */
  issue: VNextWorkUnitIssue | null;
}

function byRole(group: WorkloadFactV5[], role: WorkloadFactV5['quantityRole']): WorkloadFactV5[] {
  return group.filter((workload) => workload.quantityRole === role);
}

/**
 * Amount of work per owner and basis, from active stated workloads only.
 * A target governs its basis; otherwise a stated remaining, or total − completed
 * (no completed counts as 0; percent without a total uses 100). Completed work
 * alone is a record of progress, not work. A zero amount is not work.
 */
export function computeVNextWorkUnits(graph: WeeklyPlanningVNextGraph): VNextWorkUnitsByOwner[] {
  const resolver = createVNextLineageResolver(graph);
  const lineageOf = (fact: { id: string }) => resolver.lineageOf(fact.id);
  const workloads = filterActiveWeeklyPlanningFactsV5(graph, graph.workloads);
  const owners = new Map<string, WorkloadFactV5[]>();
  for (const workload of workloads) {
    const key = resolver.ownerKeyOf(workload);
    owners.set(key, [...(owners.get(key) ?? []), workload]);
  }
  const result: VNextWorkUnitsByOwner[] = [];
  for (const [ownerKey, ownerWorkloads] of owners) {
    const taskId = resolver.leafOf(ownerWorkloads[0].taskId) ?? ownerWorkloads[0].taskId;
    const componentId = ownerWorkloads[0].componentId === null
      ? null
      : resolver.leafOf(ownerWorkloads[0].componentId) ?? ownerWorkloads[0].componentId;
    const done = (issue: VNextWorkUnitIssue | null, units: VNextWorkUnit[]) =>
      result.push({ ownerKey, taskId, componentId, units: issue ? [] : units, issue });
    const unresolved = ownerWorkloads.filter((workload) =>
      workload.quantityRole === 'declared' || workload.quantityRole === 'unknown');
    if (unresolved.length > 0) {
      done({ code: 'quantity_role_unresolved', ownerKey, lineageIds: unresolved.map(lineageOf) }, []);
      continue;
    }
    const invalid = ownerWorkloads.filter((workload) => !isValidVNextQuantityBasis(workload));
    if (invalid.length > 0) {
      done({ code: 'quantity_basis_invalid', ownerKey, lineageIds: invalid.map(lineageOf) }, []);
      continue;
    }
    const groups = new Map<string, WorkloadFactV5[]>();
    for (const workload of ownerWorkloads) {
      const key = vnextQuantityBasisKey(workload);
      groups.set(key, [...(groups.get(key) ?? []), workload]);
    }
    const units: VNextWorkUnit[] = [];
    let issue: VNextWorkUnitIssue | null = null;
    for (const [basisKey, group] of groups) {
      const totals = byRole(group, 'scope_total');
      const completed = byRole(group, 'completed');
      const remaining = byRole(group, 'remaining');
      const targets = byRole(group, 'target');
      if ([totals, completed, remaining, targets].some((facts) => facts.length > 1)) {
        issue = { code: 'duplicate_quantity', ownerKey, basisKey, lineageIds: group.map(lineageOf) };
        break;
      }
      const [total, done_, stated, target] = [totals[0], completed[0], remaining[0], targets[0]];
      const unit = (workload: WorkloadFactV5, role: VNextWorkUnit['role'], amount: number, derivedFromTotal: boolean) => {
        if (amount > 0) {
          units.push({
            workLineageId: lineageOf(workload),
            definingFactId: workload.id,
            ownerKey,
            basisKey,
            role,
            derivedFromTotal,
            amount,
            workload,
          });
        }
      };
      if (target) {
        unit(target, 'target', target.amount, false);
        continue;
      }
      const totalAmount = total?.amount ?? (done_ && isVNextPercentUnit(done_) ? 100 : null);
      if (done_ && totalAmount !== null && done_.amount > totalAmount) {
        issue = {
          code: 'completed_exceeds_total',
          ownerKey,
          basisKey,
          lineageIds: [total, done_].filter(Boolean).map((fact) => lineageOf(fact!)),
        };
        break;
      }
      // No completed statement means nothing is done yet, as an implied percent total means 100.
      const derived = totalAmount !== null ? totalAmount - (done_?.amount ?? 0) : null;
      if (stated && derived !== null && done_ && totalAmount !== null && stated.amount !== derived) {
        issue = {
          code: 'remaining_inconsistent',
          ownerKey,
          basisKey,
          lineageIds: [...(total ? [lineageOf(total)] : []), lineageOf(done_), lineageOf(stated)],
          totalFactId: total?.id ?? null,
          completedFactId: done_.id,
          remainingFactId: stated.id,
          totalAmount,
          derivedAmount: derived,
          statedAmount: stated.amount,
        };
        break;
      }
      if (stated) {
        unit(stated, 'remaining', stated.amount, false);
      } else if (derived !== null) {
        // Percent progress without a stated total is named by the completed fact.
        unit(total ?? done_!, 'remaining', derived, true);
      }
    }
    done(issue, units);
  }
  return result;
}

/**
 * The one place a total's binding is computed. A total about a completed
 * workload is an observed pace of that completed amount; a total about any
 * other workload, or about a projected work by identity, is the future time of
 * that work at its current amount. Null when the work does not exist.
 */
export function resolveVNextEffortBinding(
  graph: WeeklyPlanningVNextGraph,
  about: { workloadFactId: string } | { workLineageId: string },
): VNextEffortWorkBinding | null {
  const resolver = createVNextLineageResolver(graph);
  if ('workloadFactId' in about) {
    const leaf = resolver.leafOf(about.workloadFactId);
    const workload = filterActiveWeeklyPlanningFactsV5(graph, graph.workloads).find((fact) => fact.id === leaf);
    if (!workload) return null;
    if (workload.quantityRole === 'completed') {
      return {
        kind: 'observed_pace',
        workLineageId: resolver.lineageOf(workload.id),
        boundAmount: workload.amount,
        boundBasisKey: vnextQuantityBasisKey(workload),
      };
    }
  }
  const lineageId = 'workLineageId' in about ? about.workLineageId : resolver.lineageOf(about.workloadFactId);
  const unit = computeVNextWorkUnits(graph).flatMap((owner) => owner.units)
    .find((candidate) => candidate.workLineageId === lineageId);
  return unit
    ? { kind: 'future_work', workLineageId: unit.workLineageId, boundAmount: unit.amount, boundBasisKey: unit.basisKey }
    : null;
}
