import { isLocalDevelopmentHost } from '../../../../lib/devAuthShortcut';

/** V5 is an explicit local comparison build, never a production-host fallback. */
export function resolveWeeklyPlanningConversationCore(params: {
  configuredCore: string | undefined;
  hostname: string;
}): 'vnext' | 'stable_v5' {
  return params.configuredCore === 'stable_v5' && isLocalDevelopmentHost(params.hostname)
    ? 'stable_v5' : 'vnext';
}
