import type { VNextTurnError } from '../weeklyPlanningVNextTypes';
import type { VNextProviderReading } from './weeklyPlanningVNextProviderSchema';

type Namespace = 'F' | 'W' | 'Q' | 'O' | 'R';
const fields: Record<string, Namespace> = {
  id: 'F', factId: 'F', taskId: 'F', componentId: 'F', parentComponentId: 'F', targetFactId: 'F',
  fromTaskId: 'F', toTaskId: 'F', replacementFactId: 'F', lineageId: 'F', definingFactId: 'F',
  proposalId: 'F', workloadFactId: 'F',
  workLineageId: 'W', key: 'Q', questionKey: 'Q', optionId: 'O', ownerKey: 'R',
};
const lists = new Set(['subjectLineageIds', 'lineageIds', 'estimateFactIds']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** One invocation's model vocabulary. It is never persisted or reused as domain identity. */
export function createVNextProviderReferences() {
  const byReal = new Map<string, string>();
  const byAlias = new Map<string, { namespace: Namespace; real: string }>();
  const counts: Record<Namespace, number> = { F: 0, W: 0, Q: 0, O: 0, R: 0 };
  const alias = (namespace: Namespace, real: string): string => {
    const key = JSON.stringify([namespace, real]);
    let value = byReal.get(key);
    if (!value) {
      value = `${namespace}${++counts[namespace]}`;
      byReal.set(key, value); byAlias.set(value, { namespace, real });
    }
    return value;
  };
  const encodeContext = (value: unknown, field = ''): unknown => {
    if (typeof value === 'string' && fields[field]) return alias(fields[field], value);
    if (Array.isArray(value)) return value.map(item => lists.has(field) && typeof item === 'string'
      ? alias('F', item) : encodeContext(item));
    if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeContext(item, key)]));
    return value;
  };
  const decodeReading = (reading: VNextProviderReading):
    | { status: 'decoded'; reading: VNextProviderReading }
    | { status: 'rejected'; errors: VNextTurnError[] } => {
    const next = structuredClone(reading);
    const errors: VNextTurnError[] = [];
    const real = (namespace: Namespace, value: string, path: string, localId: string | null): string => {
      const found = byAlias.get(value);
      if (!found || found.namespace !== namespace) {
        errors.push({ code: 'unknown_ref', path, localId, factId: null });
        return value;
      }
      return found.real;
    };
    const ref = (value: { factId: string } | { localId: string } | { workLineageId: string }, path: string, localId: string | null) => {
      if ('factId' in value) value.factId = real('F', value.factId, `${path}.factId`, localId);
      if ('workLineageId' in value) value.workLineageId = real('W', value.workLineageId, `${path}.workLineageId`, localId);
    };
    next.delta.add.forEach((fact, index) => {
      const path = `delta.add[${index}]`;
      if ('taskRef' in fact) ref(fact.taskRef, `${path}.taskRef`, fact.localId);
      if ('componentRef' in fact && fact.componentRef) ref(fact.componentRef, `${path}.componentRef`, fact.localId);
      if ('parentComponentRef' in fact && fact.parentComponentRef) ref(fact.parentComponentRef, `${path}.parentComponentRef`, fact.localId);
      if ('targetRef' in fact) ref(fact.targetRef, `${path}.targetRef`, fact.localId);
      if ('fromTaskRef' in fact) ref(fact.fromTaskRef, `${path}.fromTaskRef`, fact.localId);
      if ('toTaskRef' in fact) ref(fact.toTaskRef, `${path}.toTaskRef`, fact.localId);
    });
    next.delta.patch.forEach((patch, index) => { patch.targetFactId = real('F', patch.targetFactId, `delta.patch[${index}].targetFactId`, patch.localId); });
    next.delta.remove.forEach((item, index) => { item.targetFactId = real('F', item.targetFactId, `delta.remove[${index}].targetFactId`, null); });
    next.delta.relate.forEach((item, index) => {
      ref(item.a, `delta.relate[${index}].a`, null); ref(item.b, `delta.relate[${index}].b`, null);
    });
    next.delta.defer.forEach((item, index) => { item.questionKey = real('Q', item.questionKey, `delta.defer[${index}].questionKey`, null); });
    if (next.answer?.kind === 'option') next.answer.optionId = real('O', next.answer.optionId, 'answer.optionId', null);
    if (next.answer?.kind === 'proposal_decision') next.answer.proposalId = real('F', next.answer.proposalId, 'answer.proposalId', null);
    return errors.length ? { status: 'rejected', errors } : { status: 'decoded', reading: next };
  };
  return { encodeContext, decodeReading };
}

export type VNextProviderReferences = ReturnType<typeof createVNextProviderReferences>;
