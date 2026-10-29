import { describe, expect, it } from 'vitest';
import { parseVNextCorrections, VNEXT_CORRECTION_RESPONSE_FORMAT } from './weeklyPlanningVNextCorrectionSchema';
import { VNEXT_PATCH_FIELDS } from './weeklyPlanningVNextTransaction';

const workload = () => ({ kind: 'workload', localId: 'r8', targetFactId: 'r', amountDelta: null,
  changes: { amount: 8, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null,
    rangeEnd: null, perOccurrence: null, periodExpression: null } });

describe('VNext experimental provider correction fragment', () => {
  it('accepts value-only patches with all unchanged fields null', () => {
    const value = { patch: [workload()], remove: [] };
    const result = parseVNextCorrections(value);
    expect(result).toEqual({ status: 'accepted', ...value });
    if (result.status === 'accepted' && result.patch[0].kind === 'workload') {
      result.patch[0].changes.unitLabel = 'changed clone';
      expect(value.patch[0].changes.unitLabel).toBeNull();
    }
  });

  it('uses strict per-kind schemas with every legal change required and nullable', () => {
    type Schema = { type?: string; required?: string[]; properties?: Record<string, Schema>;
      additionalProperties?: boolean; items?: Schema; anyOf?: Schema[]; enum?: string[] };
    const root = VNEXT_CORRECTION_RESPONSE_FORMAT.json_schema.schema as Schema;
    expect(root.additionalProperties).toBe(false);
    const variants = root.properties!.patch.items!.anyOf!;
    expect(variants).toHaveLength(5);
    for (const variant of variants) {
      const kind = variant.properties!.kind.enum![0] as keyof typeof VNEXT_PATCH_FIELDS;
      const changes = variant.properties!.changes;
      expect(changes.required!.sort()).toEqual([...VNEXT_PATCH_FIELDS[kind]].sort());
      expect(changes.additionalProperties).toBe(false);
      for (const field of Object.values(changes.properties!)) expect(field.anyOf).toContainEqual({ type: 'null' });
    }
  });

  it.each(['id', 'taskId', 'componentId', 'workBinding', 'source'])('rejects unpatchable field %s with exact localId/path', key => {
    const item = workload();
    const result = parseVNextCorrections({ patch: [{ ...item, changes: { ...item.changes, [key]: null } }], remove: [] });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({ path: `patch[0].changes.${key}`, localId: 'r8' }));
  });

  it('rejects missing fields instead of treating schema drift as an unchanged value', () => {
    const item = workload();
    const result = parseVNextCorrections({ patch: [{ ...item, changes: { amount: 8 } }], remove: [] });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({ path: 'patch[0].changes.unitCode' }));
  });

  it.each([NaN, Infinity, '8', undefined])('rejects invalid amount %s', value => {
    const item = workload();
    expect(parseVNextCorrections({ patch: [{ ...item, changes: { ...item.changes, amount: value } }], remove: [] }).status).toBe('rejected');
  });

  it('rejects lifecycle operations or arbitrary derived binding fields from the model', () => {
    expect(parseVNextCorrections({ patch: [], remove: [], supersede: ['x'] }).status).toBe('rejected');
    expect(parseVNextCorrections({ patch: [{ ...workload(), workBinding: { workLineageId: 'r', boundAmount: 8 } }], remove: [] }).status).toBe('rejected');
  });

  it('accepts explicit unit corrections and typed removes; no clear-field protocol is invented', () => {
    const item = workload();
    const result = parseVNextCorrections({ patch: [{ ...item, changes: { ...item.changes, unitCode: 'custom', unitLabel: 'セット' } }], remove: [{ targetFactId: 'e' }] });
    expect(result.status).toBe('accepted');
    expect(parseVNextCorrections({ patch: [{ ...item, clearFields: ['periodExpression'] }], remove: [] }).status).toBe('rejected');
  });
});
