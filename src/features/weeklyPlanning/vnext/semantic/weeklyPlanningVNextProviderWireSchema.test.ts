import { describe, expect, it } from 'vitest';
import { dedupeRepeatedSchemaDescriptions, describeVNextProviderField, VNEXT_PLANNING_WINDOW_REQUIREMENT,
  VNEXT_PROVIDER_RESPONSE_FORMAT, VNEXT_PROVIDER_WIRE_RESPONSE_FORMAT } from './weeklyPlanningVNextProviderSchema';

const full = VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.schema;
const wire = VNEXT_PROVIDER_WIRE_RESPONSE_FORMAT.json_schema.schema;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function descriptions(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach(item => descriptions(item, found));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'description' && typeof value === 'string') found.push(value);
      else descriptions(value, found);
    }
  }
  return found;
}
function withoutDescriptions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutDescriptions);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).filter(([key, value]) => !(key === 'description' && typeof value === 'string'))
    .map(([key, value]) => [key, withoutDescriptions(value)]));
}

describe('native wire schema (#977 repeated descriptions)', () => {
  it('keeps every distinct description at least once', () => {
    const sent = descriptions(wire);
    expect(new Set(sent)).toEqual(new Set(descriptions(full)));
    expect(sent.length).toBe(new Set(sent).size);
  });

  it('has the identical structure: properties, required, enum, types', () => {
    expect(withoutDescriptions(wire)).toEqual(withoutDescriptions(full));
    expect(JSON.stringify(Object.keys(wire as object))).toBe(JSON.stringify(Object.keys(full as object)));
    expect(VNEXT_PROVIDER_WIRE_RESPONSE_FORMAT.json_schema.name).toBe(VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name);
    expect(VNEXT_PROVIDER_WIRE_RESPONSE_FORMAT.json_schema.strict).toBe(true);
  });

  it('sends fewer bytes (recorded: 68,736 -> see the assertion floor)', () => {
    const saved = bytes(full) - bytes(wire);
    // Measured while implementing: the repeated sentences were about 28.5KB of the 68.7KB schema.
    expect(saved).toBeGreaterThan(25_000);
    expect(bytes(wire)).toBeLessThan(45_000);
  });

  it('leaves the repair source untouched: every field still describes itself with the full sentence', () => {
    const before = JSON.stringify(full);
    dedupeRepeatedSchemaDescriptions(full);
    expect(JSON.stringify(full)).toBe(before);
    const planningWindow = { kind: 'planning_window', localId: 'w', windowKind: 'x', value: 'x', start: null, end: null, yearBasis: null };
    const output = { delta: { add: [planningWindow] } };
    for (const field of ['windowKind', 'value', 'yearBasis']) {
      expect(describeVNextProviderField(`add[0].${field}`, output)).toBe(VNEXT_PLANNING_WINDOW_REQUIREMENT);
    }
    expect(descriptions(full).length).toBeGreaterThan(descriptions(wire).length);
  });

  it('does not change the sentence when nothing repeats', () => {
    expect(dedupeRepeatedSchemaDescriptions({ a: { description: 'one' }, b: { description: 'two' } }))
      .toEqual({ a: { description: 'one' }, b: { description: 'two' } });
    expect(dedupeRepeatedSchemaDescriptions({ a: { description: 'one' }, b: { description: 'one' } }))
      .toEqual({ a: { description: 'one' }, b: {} });
  });
});
