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

function concernEvidenceIdentity(fact: Pick<UserPlanningContextSemanticFactV1, 'value' | 'sourceText'>): string {
  return [
    normalizedIdentityPart(fact.sourceText),
    normalizedIdentityPart(fact.value),
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
  const explicitConcernEvidence = new Set<string>();

  for (const fact of document.userContextFacts ?? []) {
    byIdentity.set(factIdentity(fact), fact);
    if (fact.kind === 'concern') {
      explicitConcernEvidence.add(concernEvidenceIdentity(fact));
    }
  }

  const addEntityConcern = (fact: UserPlanningContextSemanticFactV1): void => {
    if (explicitConcernEvidence.has(concernEvidenceIdentity(fact))) return;
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
