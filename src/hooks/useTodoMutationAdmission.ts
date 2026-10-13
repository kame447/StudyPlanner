import { useLayoutEffect, useMemo, useState } from 'react';
import type { PlannerDataProjectionLease, PlannerDataReadAuthority } from '../domain/plannerDataReadAuthority';
import type { TodoTask } from '../types/domain';
import { PlannerMutationScopeExpiredError, type usePlannerMutationScope } from './usePlannerMutationScope';

type Scope = ReturnType<typeof usePlannerMutationScope>['scope'];

/** Local command admission, not durable ordering or a cross-client lock. */
export function useTodoMutationAdmission(
  scope: Scope, ownerId: string | null, todos: TodoTask[],
  authority: PlannerDataReadAuthority, projection: PlannerDataProjectionLease | null,
) {
  const [publication, setPublication] = useState({ scope, revision: 0 });
  const admission = useMemo(() => {
    let current: TodoTask[] = [];
    let currentProjection: PlannerDataProjectionLease | null = null;
    let revision = 0;
    const claims = new Map<string, { settledAt?: number }>();
    return {
      begin(id: string, targetOwner: string) {
        if (!scope.isCurrent() || targetOwner !== ownerId) throw new PlannerMutationScopeExpiredError();
        if (claims.has(id)) throw new Error('このTodoは保存・更新中です。完了してから開き直してください。');
        if (!currentProjection || !authority.canAdmitMutationFromProjection(currentProjection, ['plans-todos'])) {
          throw new Error('Todoの最新状態を確認できていません。再読み込みしてから開き直してください。');
        }
        const todo = current.find(item => item.id === id && item.userId === ownerId);
        if (!todo) throw new Error('このTodoは削除または更新されています。現在の一覧を確認して開き直してください。');
        const ticket: { settledAt?: number } = {};
        claims.set(id, ticket);
        return { todo, settle() {
          if (!scope.isCurrent() || ticket.settledAt !== undefined) return;
          ticket.settledAt = ++revision;
          setPublication({ scope, revision });
        } };
      },
      publish(rows: TodoTask[], committedProjection: PlannerDataProjectionLease | null, committedRevision: number) {
        current = rows;
        currentProjection = committedProjection;
        // A promise may settle before React commits the deletion/rollback.
        // Retained callbacks stay fenced until that publication is visible.
        for (const [id, ticket] of claims) {
          if (ticket.settledAt !== undefined && ticket.settledAt <= committedRevision) claims.delete(id);
        }
      },
    };
  }, [scope, ownerId, authority]);
  useLayoutEffect(() => {
    admission.publish(todos, projection, publication.scope === scope ? publication.revision : 0);
  }, [admission, todos, projection, publication, scope]);
  return admission;
}
