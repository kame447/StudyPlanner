import { describe, expect, it } from 'vitest';
import { decodeFirestoreFields, decodeFirestoreValue, encodeFirestoreFields } from './firestoreValueCodec';

describe('Firestore wire codec compatibility', () => {
  it('omits undefined fields but preserves null and undefined array entries', () => {
    expect(encodeFirestoreFields({ absent: undefined, empty: null, list: [undefined, null] }))
      .toEqual({ empty: { nullValue: null }, list: { arrayValue: { values: [{ nullValue: null }, { nullValue: null }] } } });
  });
  it('retains integer strings, doubles, booleans and nonfinite null representations', () => {
    expect(encodeFirestoreFields({ integer: 12, fraction: 1.5, zero: -0, yes: true, nan: NaN, inf: Infinity }))
      .toEqual({ integer: { integerValue: '12' }, fraction: { doubleValue: 1.5 }, zero: { integerValue: '0' },
        yes: { booleanValue: true }, nan: { nullValue: null }, inf: { nullValue: null } });
  });
  it('uses timestamps only for existing named fields, including nested maps but not array items', () => {
    const timestamp = '2026-10-20T00:00:00.000Z';
    expect(encodeFirestoreFields({ expireAt: timestamp, registeredAt: 'invalid', other: timestamp,
      nested: { registeredAt: timestamp }, list: [timestamp] })).toEqual({
      expireAt: { timestampValue: timestamp }, registeredAt: { stringValue: 'invalid' }, other: { stringValue: timestamp },
      nested: { mapValue: { fields: { registeredAt: { timestampValue: timestamp } } } },
      list: { arrayValue: { values: [{ stringValue: timestamp }] } },
    });
  });
  it('retains fallback string encoding rather than adding validation', () => {
    expect(encodeFirestoreFields({ bigint: 3n })).toEqual({ bigint: { stringValue: '3' } });
  });
  it('decodes references, nested arrays/maps, timestamps and absent containers', () => {
    expect(decodeFirestoreFields({ ref: { referenceValue: 'documents/items/1' }, date: { timestampValue: 'original' },
      list: { arrayValue: { values: [{ integerValue: '2' }, { mapValue: { fields: { flag: { booleanValue: false } } } }] } },
      emptyList: { arrayValue: {} }, emptyMap: { mapValue: {} } })).toEqual({
      ref: 'documents/items/1', date: 'original', list: [2, { flag: false }], emptyList: [], emptyMap: {},
    });
  });
  it('preserves existing unknown, malformed and multi-tag decoding semantics', () => {
    expect(decodeFirestoreValue(undefined)).toBeNull();
    expect(decodeFirestoreValue({})).toBeNull();
    expect(decodeFirestoreValue({ integerValue: 'not a number' })).toBeNaN();
    expect(decodeFirestoreValue({ integerValue: undefined })).toBeNaN();
    expect(decodeFirestoreValue({ stringValue: undefined })).toBeUndefined();
    expect(decodeFirestoreValue({ booleanValue: false, stringValue: 'ignored' })).toBe(false);
    expect(decodeFirestoreValue({ nullValue: null, integerValue: '9' })).toBeNull();
  });
});
