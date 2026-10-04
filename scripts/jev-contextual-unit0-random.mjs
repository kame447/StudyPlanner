import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Preregistration r4 §14. Every rule here is fixed before any holdout output:
// SHA-256(UTF-8 seed) → first 16 bytes as four big-endian uint32 words →
// xoshiro128** 1.1 state. All arithmetic is unsigned 32 bit.
export const EXECUTION_ORDER_SEED = 'unit0-r2-2026-10-05';
export const BOOTSTRAP_SEED = 'unit0-r2-boot-2026-10-05';
export const CENSUS_BOOTSTRAP_SEED = 'unit0-census-2026-10-05';
const TWO_32 = 2 ** 32;

export function seedWords(seed) {
  assert.equal(typeof seed, 'string');
  const digest = createHash('sha256').update(Buffer.from(seed, 'utf8')).digest();
  const words = [0, 4, 8, 12].map((offset) => digest.readUInt32BE(offset));
  assert.ok(words.some((word) => word !== 0), 'All-zero xoshiro state is refused.');
  return words;
}

const rotl = (value, shift) => ((value << shift) | (value >>> (32 - shift))) >>> 0;

export function createXoshiro128StarStar(seed) {
  const s = seedWords(seed);
  const next = () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  };
  // [0, n): floor(next * n / 2^32). n <= 2,080, so the modulo-free bias is
  // below n / 2^32 and recorded rather than corrected.
  const index = (n) => {
    assert.ok(Number.isSafeInteger(n) && n > 0 && n <= TWO_32);
    return Math.floor(next() * n / TWO_32);
  };
  return { next, index };
}

export const codePointCompare = (left, right) => {
  const a = Array.from(left, (char) => char.codePointAt(0));
  const b = Array.from(right, (char) => char.codePointAt(0));
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

// Cases sorted by ID code point, Fisher–Yates i = n−1 … 1 with j = index(i+1).
// Even shuffled position → AB (Jev-first first), odd → BA.
export function executionOrder(caseIds, seed = EXECUTION_ORDER_SEED) {
  assert.ok(Array.isArray(caseIds) && new Set(caseIds).size === caseIds.length, 'Case IDs must be unique.');
  const order = [...caseIds].sort(codePointCompare);
  const random = createXoshiro128StarStar(seed);
  for (let i = order.length - 1; i >= 1; i -= 1) {
    const j = random.index(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((caseId, position) => ({ position, caseId,
    arms: position % 2 === 0 ? ['jevFirst', 'lunaOnly'] : ['lunaOnly', 'jevFirst'] }));
}

// Stratified group bootstrap: per replicate, stratum B's draws first (in the
// canonical group order count), then stratum C's. Returns 0-based indices.
export function* bootstrapReplicates({ strata, replicates, seed = BOOTSTRAP_SEED }) {
  assert.ok(Array.isArray(strata) && strata.length > 0);
  assert.ok(Number.isSafeInteger(replicates) && replicates > 0);
  const random = createXoshiro128StarStar(seed);
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    yield strata.map(({ groupCount }) => {
      assert.ok(Number.isSafeInteger(groupCount) && groupCount > 0);
      return Array.from({ length: groupCount }, () => random.index(groupCount));
    });
  }
}
