import { useLayoutEffect, useMemo, useState } from 'react';
import type { Actual, MonthEvent, Plan } from '../types/domain';
import type { usePlannerMutationScope } from './usePlannerMutationScope';

export type ActualActionTarget = Pick<Actual, 'userId' | 'planId' | 'occurrenceDate'> & { id?: string };
type Projection = 'actual-material' | 'plans-todos';
type Scope = ReturnType<typeof usePlannerMutationScope>['scope'];
const pendingMessage = 'この記録または予定は保存・更新中です。完了してから開き直してください。';
const refreshMessage = '記録の最新状態を確認できていません。データの再読み込みを試してから、現在の記録を開き直してください。';
export const actualUnavailableMessage = '最新の記録または予定を確認できません。再読み込みして、現在の記録や予定を開き直してください。';

export class ActualMutationAdmissionError extends Error {}

function planKey(ownerId: string, planId: string) { return JSON.stringify(['plan', ownerId, planId]); }
function keysFor(target: ActualActionTarget): string[] {
  return [
    ...(target.id ? [JSON.stringify(['actual', target.userId, target.id])] : []),
    ...(target.planId ? [JSON.stringify(['occurrence', target.userId, target.planId, target.occurrenceDate])] : []),
  ];
}

/** Same-owner UI admission, not a queue, identity registry or read authority. */
export function useActualMutationAdmission(scope: Scope, ownerId: string | null, actuals: Actual[], plans: Plan[], monthEvents: MonthEvent[]) {
  const [publication, setPublication] = useState({ scope, revision: 0 });
  const admission = useMemo(() => {
    type Ticket = { settledAt?: number; waitingFor?: Set<Projection>; planKeys: Set<string> };
    const claims = new Map<string, Ticket>();
    let nextRevision = 0;
    let currentActuals: Actual[] = [];
    let currentPlans: Plan[] = [];
    let currentMonthEvents: MonthEvent[] = [];
    const pendingReason = (targets: ActualActionTarget[], exclusivePlanIds: string[] = []) => {
      const tickets = new Set(targets.flatMap(target => [
        ...keysFor(target), ...(target.planId ? [planKey(target.userId, target.planId)] : []),
      ]).flatMap(key => { const ticket = claims.get(key); return ticket ? [ticket] : []; }));
      // A plan-wide mutation conflicts with every occurrence dependency. Two
      // ordinary Actual mutations on distinct occurrences still run separately.
      const exclusiveKeys = exclusivePlanIds.map(id => planKey(ownerId ?? '', id));
      for (const ticket of claims.values()) {
        if (exclusiveKeys.some(key => ticket.planKeys.has(key))) tickets.add(ticket);
      }
      return [...tickets].some(ticket => ticket.waitingFor?.size) ? refreshMessage : tickets.size ? pendingMessage : null;
    };
    const notify = () => { const revision = ++nextRevision; setPublication({ scope, revision }); };
    return {
      current: () => currentActuals,
      plans: () => currentPlans,
      hasLinkedTarget: (id: string) => [...currentPlans, ...currentMonthEvents].some(target => target.userId === ownerId && target.id === id),
      reason: (target: ActualActionTarget) => {
        if (!scope.isCurrent() || target.userId !== ownerId) return actualUnavailableMessage;
        const pending = pendingReason([target]);
        if (pending) return pending;
        if (target.id && !currentActuals.some(actual => actual.id === target.id && actual.userId === ownerId)) return actualUnavailableMessage;
        return null;
      },
      acquire: (targets: ActualActionTarget[], exclusivePlanIds: string[] = []) => {
        if (targets.some(target => target.userId !== ownerId) || !scope.isCurrent()) throw new ActualMutationAdmissionError(actualUnavailableMessage);
        const pending = pendingReason(targets, exclusivePlanIds);
        if (pending) throw new ActualMutationAdmissionError(pending);
        const exclusiveKeys = exclusivePlanIds.map(id => planKey(ownerId ?? '', id));
        const ticket: Ticket = { planKeys: new Set([
          ...exclusiveKeys,
          ...targets.flatMap(target => target.planId ? [planKey(target.userId, target.planId)] : []),
        ]) };
        const keys = [...new Set([...targets.flatMap(keysFor), ...exclusiveKeys])];
        keys.forEach(key => claims.set(key, ticket));
        notify();
        return (waitFor: boolean | readonly Projection[] = false) => {
          if (ticket.settledAt !== undefined || ticket.waitingFor) return;
          ticket.waitingFor = new Set(waitFor === true ? ['actual-material'] : waitFor || []);
          if (!ticket.waitingFor.size) ticket.settledAt = nextRevision + 1;
          // A revoked scope owns a separate map; its late finally cannot clear
          // a new owner's reservation or publish into the replacement session.
          if (scope.isCurrent()) notify();
        };
      },
      requiredProjections: (): readonly Projection[] => scope.isCurrent()
        ? (['actual-material', 'plans-todos'] as const).filter(projection =>
            [...claims.values()].some(ticket => ticket.waitingFor?.has(projection)))
        : [],
      refreshed: (projections: readonly Projection[]) => {
        let released = false;
        for (const ticket of new Set(claims.values())) {
          if (!ticket.waitingFor?.size) continue;
          projections.forEach(projection => ticket.waitingFor!.delete(projection));
          if (!ticket.waitingFor.size) {
            ticket.settledAt = nextRevision + 1;
            released = true;
          }
        }
        if (released && scope.isCurrent()) notify();
      },
      publish: (records: Actual[], nextPlans: Plan[], events: MonthEvent[], committedRevision: number) => {
        currentActuals = records;
        currentPlans = nextPlans;
        currentMonthEvents = events;
        let released = false;
        for (const [key, ticket] of claims) {
          if (ticket.settledAt !== undefined && ticket.settledAt <= committedRevision) {
            claims.delete(key);
            released = true;
          }
        }
        // Release only after acknowledgement/rollback or authoritative repair
        // has committed. Rerender so open controls see the cleared claim too.
        if (released) notify();
      },
    };
  }, [scope, ownerId]);
  useLayoutEffect(() => {
    admission.publish(actuals, plans, monthEvents, publication.scope === scope ? publication.revision : 0);
  }, [admission, actuals, plans, monthEvents, publication, scope]);
  return admission;
}
