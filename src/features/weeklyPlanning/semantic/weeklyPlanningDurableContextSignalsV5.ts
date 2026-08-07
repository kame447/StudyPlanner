import type {
  SemanticDurableContextSignalV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type {
  UserPlanningContextSemanticFactV1,
} from '../../userPlanningContext/userPlanningContextTypes';

export const WEEKLY_PLANNING_DURABLE_CONTEXT_SIGNAL_VERSION_V5 =
  'weekly-planning-durable-context-signal-v5' as const;

function normalizedIdentityPart(value: string | null): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function factIdentity(fact: UserPlanningContextSemanticFactV1): string {
  return [
    fact.kind,
    normalizedIdentityPart(fact.label),
    fact.kind === 'goal_event' ? normalizedIdentityPart(fact.dateExpression) : '',
  ].join('|');
}

function concernFact(params: {
  signal: SemanticDurableContextSignalV5;
  label: string;
}): UserPlanningContextSemanticFactV1 {
  return {
    localId: params.signal.localId,
    kind: 'concern',
    label: params.label,
    value: params.signal.value,
    dateExpression: null,
    sourceText: params.signal.sourceText,
  };
}

/**
 * Converts AI-structured entity annotations into owner context facts.
 *
 * This function deliberately does not inspect raw user text or infer concern
 * from words in sourceText. The semantic model has already made the concern
 * decision by emitting a durableContextSignal; core only binds that explicit
 * signal to the AI-selected task/component label.
 */
export function collectUserPlanningContextFactsV5(
  document: WeeklyPlanningSemanticDocumentV5,
): UserPlanningContextSemanticFactV1[] {
  const byIdentity = new Map<string, UserPlanningContextSemanticFactV1>();

  for (const fact of document.userContextFacts ?? []) {
    byIdentity.set(factIdentity(fact), fact);
  }

  for (const task of document.tasks) {
    for (const signal of task.durableContextSignals ?? []) {
      const fact = concernFact({ signal, label: task.title });
      byIdentity.set(factIdentity(fact), fact);
    }
    for (const component of task.study?.components ?? []) {
      for (const signal of component.durableContextSignals ?? []) {
        const fact = concernFact({ signal, label: component.label });
        // Entity-local AI annotation is more specific than an unbound
        // top-level duplicate for the same owner-context identity.
        byIdentity.set(factIdentity(fact), fact);
      }
    }
  }

  return [...byIdentity.values()];
}
