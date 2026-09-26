export const USER_CONTEXT_ROUTING_EXTERNAL_DOMAINS = [
  'bookshelf',
  'timetable',
  'schedule',
  'actual',
] as const;

export type UserContextRoutingExternalDomain =
  (typeof USER_CONTEXT_ROUTING_EXTERNAL_DOMAINS)[number];

// This projection can only select an interpreter route. It carries no record,
// canonical ID, persistence, approval, or lifecycle authority.
export interface UserContextRoutingDecisionContext {
  purpose: 'user_context_routing';
  requestId: string;
  inputRevision: number;
  state: {
    currentUserText: string;
  };
}

export interface UserContextRoutingDecisionResponse {
  decision: 'external_owner';
  targetDomain: UserContextRoutingExternalDomain;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isUserContextRoutingExternalDomain(
  value: unknown,
): value is UserContextRoutingExternalDomain {
  return typeof value === 'string'
    && (USER_CONTEXT_ROUTING_EXTERNAL_DOMAINS as readonly string[]).includes(value);
}

export function isUserContextRoutingDecisionContext(
  value: unknown,
): value is UserContextRoutingDecisionContext {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'purpose',
    'requestId',
    'inputRevision',
    'state',
  ])) return false;
  if (!isRecord(value.state) || !hasOnlyKeys(value.state, ['currentUserText'])) return false;

  return value.purpose === 'user_context_routing'
    && typeof value.requestId === 'string'
    && value.requestId.trim().length > 0
    && value.requestId.length <= 160
    && Number.isSafeInteger(value.inputRevision)
    && Number(value.inputRevision) >= 0
    && typeof value.state.currentUserText === 'string'
    && value.state.currentUserText.trim().length > 0
    && new TextEncoder().encode(value.state.currentUserText).length <= 8_000;
}

export function isUserContextRoutingDecisionResponse(
  value: unknown,
): value is UserContextRoutingDecisionResponse {
  return isRecord(value)
    && hasOnlyKeys(value, ['decision', 'targetDomain'])
    && value.decision === 'external_owner'
    && isUserContextRoutingExternalDomain(value.targetDomain);
}
