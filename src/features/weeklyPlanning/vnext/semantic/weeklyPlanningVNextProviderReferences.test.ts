import { describe, expect, it } from 'vitest';
import { createVNextProviderReferences } from './weeklyPlanningVNextProviderReferences';
import type { VNextProviderReading } from './weeklyPlanningVNextProviderSchema';

const empty = () => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
describe('request-scoped provider reference vocabulary', () => {
  it('decodes a study context task reference without deriving activity from the context label', () => {
    const references = createVNextProviderReferences();
    references.encodeContext({ tasks: [{ id: 'stored:["task"]' }] });
    const result = references.decodeReading({ planningIntent: 'unknown', conversationActs: [], delta: { ...empty(), add: [
      { kind: 'study_context', localId: 'study', taskRef: { factId: 'F1' }, purpose: 'self_study', contextLabel: '暗記', activityKind: 'unknown' },
    ] }, answer: null });
    expect(result).toMatchObject({ status: 'decoded', reading: { delta: { add: [
      { taskRef: { factId: 'stored:["task"]' }, contextLabel: '暗記', activityKind: 'unknown' },
    ] } } });
  });

  it('decodes task-order and recurrence references through the same fact vocabulary', () => {
    const references = createVNextProviderReferences();
    references.encodeContext({ tasks: [{ id: 'first:["task"]' }, { id: 'second:["task"]' }] });
    const reading: VNextProviderReading = { planningIntent: 'unknown', conversationActs: [], delta: { ...empty(), add: [
      { kind: 'relation', localId: 'order', relationKind: 'before', fromTaskRef: { factId: 'F1' }, toTaskRef: { factId: 'F2' } },
      { kind: 'recurrence', localId: 'repeat', taskRef: { factId: 'F1' }, targetRef: { factId: 'F1' }, recurrenceKind: 'daily', count: null, days: [] },
    ] }, answer: null };
    const result = references.decodeReading(reading);
    expect(result).toMatchObject({ status: 'decoded', reading: { delta: { add: [
      { fromTaskRef: { factId: 'first:["task"]' }, toTaskRef: { factId: 'second:["task"]' } },
      { taskRef: { factId: 'first:["task"]' }, targetRef: { factId: 'first:["task"]' } },
    ] } } });
    const invalid = structuredClone(reading);
    if (invalid.delta.add[0].kind !== 'relation') throw new Error('setup');
    invalid.delta.add[0].toTaskRef = { factId: 'W1' };
    expect(references.decodeReading(invalid)).toMatchObject({ status: 'rejected', errors: [
      expect.objectContaining({ path: 'delta.add[0].toTaskRef.factId', localId: 'order' }),
    ] });
  });

  it('hides punctuation-bearing identities everywhere in context and returns exact stored IDs', () => {
    const references = createVNextProviderReferences();
    const raw = 'vnext:["synthetic:task","seed", "remaining"]';
    const context = references.encodeContext({ activeFacts: [{ id: raw, taskId: raw, title: 'Keep F1 literal title' }],
      owners: [{ ownerKey: `${raw}/${raw}`, workLineageId: raw, definingFactId: raw, estimateFactIds: [raw] }],
      question: { key: `question:${raw}`, subjectLineageIds: [raw], options: [{ optionId: 'remaining_follows_progress' }] } }) as {
        activeFacts: { id: string; taskId: string; title: string }[];
      };
    expect(JSON.stringify(context)).not.toContain('vnext:');
    expect(context.activeFacts[0]).toMatchObject({ id: 'F1', taskId: 'F1', title: 'Keep F1 literal title' });
    const reading: VNextProviderReading = { planningIntent: 'unknown', conversationActs: [], delta: { ...empty(), add: [{ kind: 'effort_estimate', localId: 'F1',
      taskRef: { factId: 'F1' }, targetRef: { workLineageId: 'W1' }, effortKind: 'total_duration',
      minutes: 60, unitCode: null, unitLabel: null, precision: 'exact' }], defer: [{ questionKey: 'Q1', allocation: 'none' }] },
    answer: { kind: 'option', optionId: 'O1' } };
    const result = references.decodeReading(reading);
    expect(result.status).toBe('decoded');
    if (result.status === 'decoded') {
      expect(result.reading.delta.add[0]).toMatchObject({ localId: 'F1', taskRef: { factId: raw }, targetRef: { workLineageId: raw } });
      expect(result.reading.answer).toEqual({ kind: 'option', optionId: 'remaining_follows_progress' });
      expect(result.reading.delta.defer[0].questionKey).toBe(`question:${raw}`);
    }
    expect(reading.delta.add[0]).toMatchObject({ taskRef: { factId: 'F1' } });
  });

  it.each(['F999', 'W1', 'real-id', 'F1]},'])('rejects unknown, wrong-namespace or corrupted alias %s', value => {
    const references = createVNextProviderReferences();
    references.encodeContext({ id: 'real-id', workLineageId: 'real-work' });
    const result = references.decodeReading({ planningIntent: 'unknown', conversationActs: [], delta: { ...empty(), remove: [{ targetFactId: value }] }, answer: null });
    expect(result).toMatchObject({ status: 'rejected', errors: [{ code: 'unknown_ref', path: 'delta.remove[0].targetFactId' }] });
  });

  it('does not let aliases from a prior invocation resolve without being exposed anew', () => {
    const first = createVNextProviderReferences(), second = createVNextProviderReferences();
    first.encodeContext({ id: 'first-id' });
    const result = second.decodeReading({ planningIntent: 'unknown', conversationActs: [], delta: { ...empty(), remove: [{ targetFactId: 'F1' }] }, answer: null });
    expect(result.status).toBe('rejected');
  });

  it('decodes patch/remove/relation identities from the same map without translating local references', () => {
    const references = createVNextProviderReferences();
    references.encodeContext({ tasks: [{ id: 'punctuated:["task"]' }], workloads: [{ id: 'first-work' }, { id: 'second-work' }] });
    const result = references.decodeReading({ planningIntent: 'unknown', conversationActs: [], delta: { ...empty(),
      patch: [{ kind: 'task', localId: 'F3', targetFactId: 'F1', changes: { title: 'F1 stays a title', category: null } }],
      remove: [{ targetFactId: 'F2' }],
      relate: [{ kind: 'distinct', a: { factId: 'F2' }, b: { localId: 'F3' } }],
    }, answer: null });
    expect(result.status).toBe('decoded');
    if (result.status === 'decoded') {
      expect(result.reading.delta.patch[0]).toMatchObject({ localId: 'F3', targetFactId: 'punctuated:["task"]', changes: { title: 'F1 stays a title' } });
      expect(result.reading.delta.remove[0].targetFactId).toBe('first-work');
      expect(result.reading.delta.relate[0]).toMatchObject({ a: { factId: 'first-work' }, b: { localId: 'F3' } });
    }
  });
});
