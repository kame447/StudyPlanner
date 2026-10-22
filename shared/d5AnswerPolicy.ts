/** Versioned semantic contract. Registration remains separately disabled in production. */
export const D5_TOP1_ANSWER_POLICY_VERSION = 'd5-answer-proposal-2026-10-21-v2';
export const D5_TOP1_SCOPE = {
  domainPolicyVersion: D5_TOP1_ANSWER_POLICY_VERSION,
  answerKind: 'one_exact_duration_or_contextual_bare_minutes',
  convertedUnitsAllowed: true,
  approximateAllowed: false,
} as const;
