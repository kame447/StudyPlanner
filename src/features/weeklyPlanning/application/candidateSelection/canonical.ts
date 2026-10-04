import type { CandidateValue } from './contracts';

/** Strict JSON data only: no getters, prototypes, hidden fields, cycles, holes or lossy numbers. */
export function freezeCandidateValue(value: unknown, ancestors = new Set<object>()): CandidateValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (typeof value !== 'object' || value === null || ancestors.has(value)) {
    throw new Error('Candidate basis must be lossless JSON data.');
  }
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((array && prototype !== Array.prototype) || (!array && prototype !== Object.prototype && prototype !== null)) {
    throw new Error('Candidate basis must contain plain objects.');
  }
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => typeof key !== 'string'
    || (!descriptors[key].enumerable && !(array && key === 'length'))
    || !('value' in descriptors[key]))) {
    throw new Error('Candidate basis must contain enumerable data properties only.');
  }
  ancestors.add(value);
  try {
    if (array) {
      if (keys.length !== value.length + 1
        || !Array.from({ length: value.length }, (_, index) => String(index)).every((key) => keys.includes(key))) {
        throw new Error('Candidate arrays must be dense and have no extra properties.');
      }
      return Object.freeze(value.map((entry) => freezeCandidateValue(entry, ancestors)));
    }
    const entries = (keys as string[]).sort().map((key) => [key, freezeCandidateValue(descriptors[key].value, ancestors)]);
    return Object.freeze(Object.fromEntries(entries));
  } finally {
    ancestors.delete(value);
  }
}

/** Explicit key sorting (including numeric-looking keys); array order and exact strings are preserved. */
export function canonicalCandidateSerialization(value: unknown): string {
  const frozen = freezeCandidateValue(value);
  const encode = (entry: CandidateValue): string => {
    if (entry === null || typeof entry !== 'object') return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(encode).join(',')}]`;
    const record = entry as { readonly [key: string]: CandidateValue };
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${encode(record[key])}`).join(',')}}`;
  };
  return encode(frozen);
}
