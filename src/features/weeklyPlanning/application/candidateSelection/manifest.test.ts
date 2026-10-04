import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { basis, observation } from './fixtures.testUtils';
import { canonicalCandidateSerialization, candidateFreshnessFailure, createCandidateManifest, buildCandidateHierarchy, CANDIDATE_CHOICE_OPTION_LIMIT } from './index';

describe('application candidate manifest integrity', () => {
  it('snapshots before hashing and freezes every nested reference', async () => {
    const input = basis();
    const promise = createCandidateManifest(input);
    input.candidates[0].tuple.minutes = 800;
    input.binding.scope.taskId = 'replacement';
    const manifest = await promise;
    expect(manifest.candidates[0].tuple.minutes).toBe(1);
    expect(manifest.binding.scope.taskId).toBe('task-a');
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.candidates[0].tuple)).toBe(true);
    expect(Object.isFrozen(manifest.binding.question)).toBe(true);
    expect(() => { (manifest.candidates[0].tuple as { minutes: number }).minutes = 900; }).toThrow();
    expect(manifest.candidateSetHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('canonicalizes keys, not candidate order, exact strings or array order', () => {
    expect(canonicalCandidateSerialization({ '2': 'two', '10': 'ten', b: 1, a: [2, 1] })).toBe('{"10":"ten","2":"two","a":[2,1],"b":1}');
    fc.assert(fc.property(fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue(), { maxKeys: 10 }), (value) => {
      const reversed = Object.fromEntries(Object.entries(value).reverse());
      expect(canonicalCandidateSerialization(value)).toBe(canonicalCandidateSerialization(reversed));
    }), { numRuns: 100, seed: 30502 });
    expect(canonicalCandidateSerialization('é')).not.toBe(canonicalCandidateSerialization('e\u0301'));
  });

  const changes: [string, (value: ReturnType<typeof basis>) => void][] = [
    ['complete tuple minutes', (v) => { v.candidates[0].tuple.minutes += 1; }],
    ['measurement', (v) => { v.candidates[0].tuple.measurement = 'total'; }],
    ['precision', (v) => { v.candidates[0].tuple.precision = 'approximate'; }],
    ['candidate target', (v) => { v.candidates[0].tuple.target = 'workload-b'; }],
    ['candidate scope', (v) => { v.candidates[0].tuple.scope = 'task-b'; }],
    ['candidate addition', (v) => { v.candidates.push({ ...v.candidates[0], id: 'added' }); }],
    ['candidate deletion', (v) => { v.candidates.pop(); }],
    ['rename', (v) => { v.candidates[0].label = 'renamed'; }],
    ['reorder', (v) => { v.candidates.reverse(); }],
    ['same name, different ID', (v) => { v.candidates[0].id = 'replacement'; }],
    ['owner', (v) => { v.binding.ownerId = 'owner-b'; }],
    ['conversation', (v) => { v.binding.conversationId = 'conversation-b'; }],
    ['request', (v) => { v.binding.requestId = 'request-b'; }],
    ['source revision', (v) => { v.binding.sources[0].revision = 'source-revision-2'; }],
    ['source identity', (v) => { v.binding.sources[0].id = 'material-b'; }],
    ['source addition', (v) => { v.binding.sources.push({ id: 'extra', revision: '1' }); }],
    ['input revision', (v) => { v.binding.inputRevision += 1; }],
    ['graph revision', (v) => { v.binding.graphRevision += 1; }],
    ['target replacement', (v) => { v.binding.target.id = 'workload-b'; }],
    ['target kind', (v) => { v.binding.target.kind = 'component'; }],
    ['binding scope', (v) => { v.binding.scope.taskId = 'task-b'; }],
    ['question superseded', (v) => { v.binding.question.id = 'question-b'; }],
    ['question code', (v) => { v.binding.question.code = 'missing_effort_estimate'; }],
    ['question re-presentation turn', (v) => { v.binding.question.presentingTurnId = 'turn-b'; }],
    ['question re-presentation message', (v) => { v.binding.question.presentingMessageId = 'message-b'; }],
    ['presentation revision', (v) => { v.binding.question.presentationRevision += 1; }],
    ['selection epoch', (v) => { v.binding.selectionEpoch += 1; }],
  ];
  it.each(changes)('invalidates the whole old selection after %s', async (_name, change) => {
    const input = basis();
    const manifest = await createCandidateManifest(input);
    change(input);
    const updated = await createCandidateManifest(input);
    expect(updated.candidateSetHash).not.toBe(manifest.candidateSetHash);
    expect(candidateFreshnessFailure(manifest, { ...observation(manifest), ...input })).toBe('stale');
  });

  it('preserves stable application IDs and detects arbitrary tuple changes with property tests', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 300 }), fc.integer({ min: 1, max: 500 }), async (count, increase) => {
      const input = basis(count);
      const manifest = await createCandidateManifest(input);
      input.candidates[count - 1].tuple.minutes += increase;
      const changed = await createCandidateManifest(input);
      expect(changed.candidateSetHash).not.toBe(manifest.candidateSetHash);
      expect(changed.candidates.map((v) => v.id)).toEqual(manifest.candidates.map((v) => v.id));
    }), { numRuns: 50, seed: 30503 });
  });

  it.each([NaN, Infinity, -Infinity, -0, undefined, new Date(), { toJSON: () => 'loss' }, [, 1], Object.assign([1], { extra: 2 })])('rejects lossy/non-data input %s', (value) => {
    expect(() => canonicalCandidateSerialization(value)).toThrow();
  });
  it('rejects cycles, hidden fields, accessors, class instances and duplicate application IDs', async () => {
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    const getter = Object.defineProperty({}, 'x', { enumerable: true, get: () => { throw new Error('must not execute'); } });
    const hidden = Object.defineProperty({ x: 1 }, 'extra', { value: 2 });
    class ArraySubclass extends Array<number> {}
    for (const value of [cyclic, getter, hidden, new ArraySubclass(1, 2)]) expect(() => canonicalCandidateSerialization(value)).toThrow();
    const input = basis(); input.candidates[1].id = input.candidates[0].id;
    await expect(createCandidateManifest(input)).rejects.toThrow();
  });
  it('does not let hash/canonical-basis equality grant access or intent', async () => {
    const manifest = await createCandidateManifest(basis());
    const current = observation(manifest);
    expect(candidateFreshnessFailure(manifest, { ...current, sourceAccess: 'denied' })).toBe('source_access');
    expect(candidateFreshnessFailure(manifest, { ...current, intentProvenance: 'unproven' })).toBe('current_intent');
    const fake = { ...manifest, candidateSetHash: manifest.candidateSetHash };
    expect(candidateFreshnessFailure(fake, current)).toBe('invalid_selection');
  });
});

describe('mechanical application hierarchy', () => {
  it('preserves all complete leaf tuples exactly once with a separate width policy', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 520 }), fc.integer({ min: 2, max: 254 }), async (count, width) => {
      const manifest = await createCandidateManifest(basis(count));
      const root = buildCandidateHierarchy(manifest, width);
      const leaves: typeof manifest.candidates[number][] = [];
      const visited = new Set<string>();
      const walk = (node: typeof root) => {
        expect(visited.has(node.menu.nodeId)).toBe(false); visited.add(node.menu.nodeId);
        expect(node.menu.options.length).toBeLessThanOrEqual(width + 1);
        expect(node.menu.options.length).toBeLessThanOrEqual(CANDIDATE_CHOICE_OPTION_LIMIT);
        expect(node.menu.options.filter((v) => v.kind === 'none')).toHaveLength(1);
        for (const option of node.menu.options) {
          if (option.kind === 'leaf') leaves.push(option.candidate);
          if (option.kind === 'group') expect(option.candidates.every((candidate) => manifest.candidates.includes(candidate))).toBe(true);
        }
        node.children.forEach(walk);
      };
      walk(root);
      expect(leaves).toEqual(manifest.candidates);
      expect(Object.isFrozen(root.menu.options)).toBe(true);
    }), { numRuns: 80, seed: 30504 });
  });
  it('supports a flat 101-option menu and never infers p=1 for a single candidate', async () => {
    const hundred = await createCandidateManifest(basis(100));
    expect(buildCandidateHierarchy(hundred, 100).menu.options).toHaveLength(101);
    const single = await createCandidateManifest(basis(1));
    expect(buildCandidateHierarchy(single, 2).menu.options).toHaveLength(2);
    expect(() => buildCandidateHierarchy(hundred, 255)).toThrow();
    expect(() => buildCandidateHierarchy(hundred, 1)).toThrow();
  });
});
