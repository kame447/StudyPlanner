import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

type Payload = Record<string, unknown>;
interface RetainedNode {
  kind: string;
  localId: string | null;
  payload: string;
  bindingContext: boolean;
  references: Map<string, string>;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Payload;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Only validated typed declarations enter this projection; sourceText is opaque evidence. */
function retainedNodes(document: WeeklyPlanningSemanticDocumentV5): RetainedNode[] {
  const nodes: RetainedNode[] = [];
  function add(kind: string, value: object, owner?: string, referencePaths: string[] = [], bindingContext = false): void {
    const payload = structuredClone(value) as Payload;
    const localId = typeof payload.localId === 'string' ? payload.localId : null;
    delete payload.localId;
    // A known-public shell may refine its opaque citation; its actual binding
    // and typed owner attributes still have to correspond exactly.
    if (bindingContext) delete payload.sourceText;
    const references = new Map<string, string>();
    if (owner !== undefined) references.set('$owner', owner);
    for (const path of referencePaths) {
      const parts = path.split('.'); let record = payload;
      for (const part of parts.slice(0, -1)) record = record[part] as Payload;
      const key = parts[parts.length - 1];
      if (typeof record[key] === 'string') {
        references.set(path, record[key] as string);
        record[key] = null;
      }
    }
    nodes.push({ kind, localId, bindingContext, payload: stableSerialize({ payload, referenceKeys: [...references.keys()].sort() }), references });
  }
  add('document', { schemaVersion: document.schemaVersion, planningIntent: document.planningIntent });
  if (document.planningWindow) add('planning_window', document.planningWindow);
  for (const task of document.tasks) {
    const { workloads, effortEstimates, temporalConstraints, recurrence, durableContextSignals, study, ...identity } = task;
    const { components, ...studyIdentity } = study ?? { components: [] };
    add('task', { ...identity, study: study === null ? null : studyIdentity }, undefined, [], Boolean(task.existingPublicId));
    workloads.forEach(value => add('workload', value, task.localId));
    (durableContextSignals ?? []).forEach(value => add('durable_context_signal', value, task.localId));
    for (const component of components) {
      const { workloads: nestedWorkloads, durableContextSignals: signals, ...componentIdentity } = component;
      add('component', componentIdentity, task.localId, ['parentLocalId'], Boolean(component.existingPublicId));
      nestedWorkloads.forEach(value => add('workload', value, component.localId));
      (signals ?? []).forEach(value => add('durable_context_signal', value, component.localId));
    }
    effortEstimates.forEach(value => add('effort_estimate', value, task.localId, ['targetLocalId']));
    temporalConstraints.forEach(value => add('temporal_constraint', value, task.localId, ['targetLocalId']));
    recurrence.forEach(value => add('recurrence', value, task.localId, ['targetLocalId']));
  }
  document.relations.forEach(value => add('relation', value, undefined, ['fromLocalId', 'toLocalId']));
  document.availabilityDeclarations.forEach(value => add('availability_declaration', value));
  document.constraintSourceRequests.forEach(value => add('constraint_source_request', value));
  (document.userContextFacts ?? []).forEach(value => add('user_context', value));
  (document.conversationActs ?? []).forEach(value => add('conversation_act', value));
  document.uncertainties.forEach(value => add('uncertainty', value, undefined, ['targetLocalId']));
  document.corrections.forEach(value => add('correction', value, undefined, ['target.localId', 'replacementLocalId']));
  document.decisions.forEach(value => add('decision', value, undefined, ['target.localId']));
  return nodes;
}

/** Retain new propositions and only the binding context their references need. */
function retainedFirstReadingNodes(document: WeeklyPlanningSemanticDocumentV5): RetainedNode[] {
  const nodes = retainedNodes(document);
  const byId = new Map(nodes.flatMap((node, index) => node.localId === null ? [] : [[node.localId, index] as const]));
  const pending = nodes.flatMap((node, index) => node.kind !== 'document' && !node.bindingContext ? [index] : []);
  if (pending.length === 0) return [];
  const retained = new Set([0, ...pending]);
  while (pending.length > 0) {
    const node = nodes[pending.pop()!];
    for (const target of node.references.values()) {
      const index = byId.get(target);
      if (index !== undefined && !retained.has(index)) { retained.add(index); pending.push(index); }
    }
  }
  return nodes.filter((_node, index) => retained.has(index));
}

/**
 * Prove a one-to-one retained typed/reference floor while allowing additions.
 * IDs may change only when payload, ownership and reference constraints establish
 * unique correspondence. Never choose by ID spelling or raw-language similarity.
 * Ambiguity fails closed instead of invoking a graph search or merging readings.
 */
export function validateWeeklyPlanningSemanticFirstReadingRetentionV5(params: {
  initialDocument: WeeklyPlanningSemanticDocumentV5;
  candidateDocument: WeeklyPlanningSemanticDocumentV5;
}): string[] {
  const initial = retainedFirstReadingNodes(params.initialDocument);
  const candidate = retainedNodes(params.candidateDocument);
  const initialIds = new Map(initial.flatMap((node, index) => node.localId === null ? [] : [[node.localId, index] as const]));
  const candidateIds = new Map(candidate.flatMap((node, index) => node.localId === null ? [] : [[node.localId, index] as const]));
  const byPayload = new Map<string, number[]>();
  candidate.forEach((node, index) => {
    const key = stableSerialize([node.kind, node.payload]);
    byPayload.set(key, [...(byPayload.get(key) ?? []), index]);
  });
  const domains = initial.map(node => new Set(byPayload.get(stableSerialize([node.kind, node.payload])) ?? []));
  const incoming = initial.map(() => [] as Array<{ source: number; path: string }>);
  initial.forEach((node, source) => node.references.forEach((target, path) => {
    const targetIndex = initialIds.get(target);
    if (targetIndex !== undefined) incoming[targetIndex].push({ source, path });
  }));
  function edgeMatches(source: number, replacement: number, path: string): boolean {
    const originalTarget = initial[source].references.get(path)!;
    const replacementTarget = candidate[replacement].references.get(path)!;
    const targetIndex = initialIds.get(originalTarget);
    const replacementIndex = candidateIds.get(replacementTarget);
    if (targetIndex === undefined) return replacementIndex === undefined && originalTarget === replacementTarget;
    return replacementIndex !== undefined && domains[targetIndex].has(replacementIndex)
      && (targetIndex !== source || replacementIndex === replacement);
  }
  // Domains only shrink. The fixed point is finite; there is no speculative
  // semantic binding, unbounded backtracking or extra provider dispatch.
  let changed = true;
  while (changed) {
    changed = false;
    const occupied = new Set(domains.flatMap(domain => domain.size === 1 ? [...domain] : []));
    initial.forEach((node, index) => {
      for (const replacement of domains[index]) {
        const compatible = (domains[index].size === 1 || !occupied.has(replacement))
          && [...node.references.keys()].every(path => edgeMatches(index, replacement, path))
          && incoming[index].every(({ source, path }) => [...domains[source]].some(sourceReplacement =>
            candidateIds.get(candidate[sourceReplacement].references.get(path)!) === replacement));
        if (!compatible) { domains[index].delete(replacement); changed = true; }
      }
    });
  }
  const used = new Set<number>(); const errors: string[] = [];
  initial.forEach((node, index) => {
    const replacement = domains[index].values().next().value as number | undefined;
    const reason = domains[index].size === 0 ? 'missing-or-changed'
      : domains[index].size !== 1 || (replacement !== undefined && used.has(replacement)) ? 'ambiguous-correspondence' : null;
    if (reason) errors.push(`first-reading-retention:${node.kind}:${node.localId ?? 'root'}:${reason}`);
    if (replacement !== undefined) used.add(replacement);
  });
  return errors;
}
