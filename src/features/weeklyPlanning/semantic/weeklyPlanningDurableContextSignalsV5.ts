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

interface ConcernEvidence {
  sourceText: string;
  value: string;
}

function concernEvidence(fact: Pick<UserPlanningContextSemanticFactV1, 'value' | 'sourceText'>): ConcernEvidence {
  return {
    sourceText: normalizedIdentityPart(fact.sourceText),
    value: normalizedIdentityPart(fact.value),
  };
}

function sameConcernEvidence(
  left: ConcernEvidence,
  right: ConcernEvidence,
): boolean {
  if (left.sourceText !== right.sourceText) return false;
  if (left.value === right.value) return true;
  if (!left.value || !right.value) return false;
  return left.value.includes(right.value) || right.value.includes(left.value);
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
  const explicitConcernEvidence: ConcernEvidence[] = [];

  for (const fact of document.userContextFacts ?? []) {
    byIdentity.set(factIdentity(fact), fact);
    if (fact.kind === 'concern') {
      explicitConcernEvidence.push(concernEvidence(fact));
    }
  }

  const addEntityConcern = (fact: UserPlanningContextSemanticFactV1): void => {
    const evidence = concernEvidence(fact);
    if (explicitConcernEvidence.some((explicit) => sameConcernEvidence(explicit, evidence))) return;
    byIdentity.set(factIdentity(fact), fact);
  };

  for (const task of document.tasks) {
    for (const signal of task.durableContextSignals ?? []) {
      addEntityConcern(concernFact({ signal, label: task.title }));
    }
    for (const component of task.study?.components ?? []) {
      for (const signal of component.durableContextSignals ?? []) {
        addEntityConcern(concernFact({ signal, label: component.label }));
      }
    }
  }

  return [...byIdentity.values()];
}
