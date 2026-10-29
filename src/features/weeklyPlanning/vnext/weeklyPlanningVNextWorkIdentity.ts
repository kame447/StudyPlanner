// Shared identity rules for the VNext core: lineage, unit identity, quantity
// basis, and which amount of work a workload stands for. Pure and deterministic.
import { filterActiveWeeklyPlanningFactsV5 } from '../semantic/weeklyPlanningFactLifecycleV5';
import type { WorkloadFactV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningVNextGraph } from './weeklyPlanningVNextTypes';

/**
 * Lineage of every fact that has a lifecycle entry: the first version of its
 * supersede chain. A removed fact ends its lineage; a fact added afterwards
 * starts a new one even when its values are equal.
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
  for (const entry of graph.factLifecycles) {
    let root = entry.factId;
    const seen = new Set<string>([root]);
    while (predecessor.has(root)) {
      root = predecessor.get(root)!;
      if (seen.has(root)) break; // malformed cycle: stop rather than loop
      seen.add(root);
    }
    lineage.set(entry.factId, root);
  }
  return lineage;
}

export function vnextOwnerKey(fact: { taskId: string; componentId: string | null }): string {
  return `${fact.taskId}/${fact.componentId ?? ''}`;
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
  | { code: 'duplicate_quantity'; ownerKey: string; basisKey: string; lineageIds: string[] }
  | { code: 'completed_exceeds_total'; ownerKey: string; basisKey: string; lineageIds: string[] }
  | {
      code: 'remaining_inconsistent';
      ownerKey: string;
      basisKey: string;
      lineageIds: string[];
      totalFactId: string;
      completedFactId: string;
      remainingFactId: string;
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
 * (percent without a total uses 100). A zero amount is not work.
 */
export function computeVNextWorkUnits(graph: WeeklyPlanningVNextGraph): VNextWorkUnitsByOwner[] {
  const lineage = vnextLineageIdByFactId(graph);
  const lineageOf = (fact: { id: string }) => lineage.get(fact.id) ?? fact.id;
  const workloads = filterActiveWeeklyPlanningFactsV5(graph, graph.workloads);
  const owners = new Map<string, WorkloadFactV5[]>();
  for (const workload of workloads) {
    const key = vnextOwnerKey(workload);
    owners.set(key, [...(owners.get(key) ?? []), workload]);
  }
  const result: VNextWorkUnitsByOwner[] = [];
  for (const [ownerKey, ownerWorkloads] of owners) {
    const { taskId, componentId } = ownerWorkloads[0];
    const done = (issue: VNextWorkUnitIssue | null, units: VNextWorkUnit[]) =>
      result.push({ ownerKey, taskId, componentId, units: issue ? [] : units, issue });
    const unresolved = ownerWorkloads.filter((workload) =>
      workload.quantityRole === 'declared' || workload.quantityRole === 'unknown');
    if (unresolved.length > 0) {
      done({ code: 'quantity_role_unresolved', ownerKey, lineageIds: unresolved.map(lineageOf) }, []);
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
      const derived = done_ && totalAmount !== null ? totalAmount - done_.amount : null;
      if (stated && derived !== null && total && done_ && stated.amount !== derived) {
        issue = {
          code: 'remaining_inconsistent',
          ownerKey,
          basisKey,
          lineageIds: [lineageOf(total), lineageOf(done_), lineageOf(stated)],
          totalFactId: total.id,
          completedFactId: done_.id,
          remainingFactId: stated.id,
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
 * Lineage and current amount of the work a workload fact stands for, used to
 * bind a total-duration estimate. A completed workload stands for itself (its
 * total is an observed pace); a total stands for its derived remaining.
 */
export function resolveVNextBindableWork(
  graph: WeeklyPlanningVNextGraph,
  workloadFactId: string,
): { workLineageId: string; amount: number } | null {
  const workload = filterActiveWeeklyPlanningFactsV5(graph, graph.workloads)
    .find((fact) => fact.id === workloadFactId);
  if (!workload) return null;
  const lineageId = vnextLineageIdByFactId(graph).get(workload.id) ?? workload.id;
  if (workload.quantityRole === 'completed') {
    const owner = computeVNextWorkUnits(graph).find((entry) => entry.ownerKey === vnextOwnerKey(workload));
    const derived = owner?.units.find((unit) => unit.workLineageId === lineageId);
    return derived ? { workLineageId: lineageId, amount: derived.amount } : { workLineageId: lineageId, amount: workload.amount };
  }
  const owner = computeVNextWorkUnits(graph).find((entry) => entry.ownerKey === vnextOwnerKey(workload));
  const unit = owner?.units.find((candidate) => candidate.workLineageId === lineageId);
  return unit ? { workLineageId: unit.workLineageId, amount: unit.amount } : null;
}
