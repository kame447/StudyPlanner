import type { ObservabilityAdminUserListItem } from '../../shared/productObservabilityAdminReadModel';

export type UserFilter = 'all' | 'product' | 'ai' | 'planning';
export type UserSort = 'recent' | 'events' | 'actor';

/** Filters already-loaded users; identity lookup and pagination remain with the page. */
export function selectVisibleAdminUsers(
  users: readonly ObservabilityAdminUserListItem[],
  searchQuery: string,
  filter: UserFilter,
  sort: UserSort,
): ObservabilityAdminUserListItem[] {
  const query = searchQuery.trim().toLowerCase();
  const filtered = users.filter((user) => {
    const actor = user.actorSubjectId?.toLowerCase() ?? '';
    if (query && !actor.includes(query) && !user.profileSubjectId.toLowerCase().includes(query)) return false;
    if (filter === 'product') return user.productActivityCount > 0;
    if (filter === 'ai') return user.aiRequestCount > 0;
    if (filter === 'planning') return user.planningOutcomeCount > 0;
    return true;
  });
  return [...filtered].sort((left, right) => {
    const leftId = left.actorSubjectId ?? left.profileSubjectId;
    const rightId = right.actorSubjectId ?? right.profileSubjectId;
    if (sort === 'events') {
      return right.eventCount - left.eventCount || leftId.localeCompare(rightId);
    }
    if (sort === 'actor') return leftId.localeCompare(rightId);
    const recency = (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '');
    return recency || leftId.localeCompare(rightId);
  });
}
