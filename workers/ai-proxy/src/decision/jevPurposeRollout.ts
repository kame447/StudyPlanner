/** Deployment selection only; semantic gates and catalogs remain purpose-owned. */
const PURPOSE_PREFIXES = {
  focused_authorization: 'FOCUSED_AUTHORIZATION',
  focused_contextual_answer: 'FOCUSED_CONTEXTUAL_ANSWER',
  temporal_scope_repair: 'TEMPORAL_SCOPE_REPAIR',
  user_context_routing: 'USER_CONTEXT_ROUTING',
  candidate_choice: 'CANDIDATE_CHOICE',
} as const;

export type JevRolloutPurpose = keyof typeof PURPOSE_PREFIXES;
type PurposePrefix = typeof PURPOSE_PREFIXES[JevRolloutPurpose];
export type JevRolloutEnv = Partial<Record<
  'JEV_MODE' | 'JEV_CANARY_PERCENT'
  | `JEV_${PurposePrefix}_MODE` | `JEV_${PurposePrefix}_CANARY_PERCENT`, string
>>;
export type JevPurposeRollout = {
  mode: 'off' | 'shadow' | 'canary';
  canaryPercent: 0 | 5 | 25 | 100;
};

function knownPurpose(purpose: string): purpose is JevRolloutPurpose {
  return Object.hasOwn(PURPOSE_PREFIXES, purpose);
}

function configuredPercentage(value: string | undefined): JevPurposeRollout['canaryPercent'] | null {
  // No coercion: whitespace, decimals, exponents, missing bindings and typos close.
  return value === '0' || value === '5' || value === '25' || value === '100'
    ? Number(value) as JevPurposeRollout['canaryPercent'] : null;
}

export function resolveJevPurposeRollout(env: JevRolloutEnv, purpose: string): JevPurposeRollout {
  const off = { mode: 'off', canaryPercent: 0 } as const;
  if ((env.JEV_MODE !== 'shadow' && env.JEV_MODE !== 'canary') || !knownPurpose(purpose)) return off;
  const masterPercentage = configuredPercentage(env.JEV_CANARY_PERCENT);
  if (masterPercentage === null || (env.JEV_MODE === 'canary' && masterPercentage === 0)) return off;
  const prefix = PURPOSE_PREFIXES[purpose];
  const mode = env[`JEV_${prefix}_MODE`];
  const percentage = configuredPercentage(env[`JEV_${prefix}_CANARY_PERCENT`]);
  if (mode !== 'shadow' && mode !== 'canary') return off;
  if (percentage === null || (mode === 'canary' && percentage === 0)) return off;
  const canaryPercent = Math.min(masterPercentage, percentage) as JevPurposeRollout['canaryPercent'];
  return { mode: env.JEV_MODE === 'shadow' ? 'shadow' : mode, canaryPercent };
}

/** Stable, purpose-salted user cohort. Never persist/log UID or this hash. */
export function jevPurposeCanarySample(purpose: string, firebaseUid: string): number {
  if (!knownPurpose(purpose) || typeof firebaseUid !== 'string' || firebaseUid.length === 0) return NaN;
  const key = `${purpose}\0${firebaseUid}`;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
  }
  return (hash % 10_000) / 10_000;
}

/** Explicit sample permits exact boundary tests; absent/invalid identity closes. */
export function jevPurposeCanarySelected(env: JevRolloutEnv, purpose: string, sample?: number): boolean {
  const rollout = resolveJevPurposeRollout(env, purpose);
  return rollout.mode === 'canary' && typeof sample === 'number' && Number.isFinite(sample)
    && sample >= 0 && sample < 1 && sample * 100 < rollout.canaryPercent;
}
