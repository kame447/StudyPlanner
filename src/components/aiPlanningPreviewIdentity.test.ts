import { describe, expect, it } from 'vitest';
import { INITIAL_PREVIEW_PROPOSAL, nextPreviewProposal } from './aiPlanningPreviewIdentity';

const after = (...steps: string[][]) =>
  steps.reduce((identity, ids) => nextPreviewProposal(identity, ids), INITIAL_PREVIEW_PROPOSAL).generation;

describe('preview proposal identity', () => {
  it('keeps the same proposal through edits, exclusions and promotion', () => {
    expect(after(['a', 'b'])).toBe(0);
    expect(after(['a', 'b'], ['a'])).toBe(0);
    expect(after(['a', 'b'], ['a', 'b', 'c'])).toBe(0);
  });

  it('treats a revision that shares no block with the previous one as a new proposal', () => {
    expect(after(['rev1:a', 'rev1:b'], ['rev2:a', 'rev2:b'])).toBe(1);
    expect(after(['rev1:a'], ['rev2:a'], ['rev3:a'])).toBe(2);
  });

  it('compares a later proposal with the last non-empty one', () => {
    expect(after(['a'], [], ['a'])).toBe(0);
    expect(after(['a'], [], ['b'])).toBe(1);
  });
});
