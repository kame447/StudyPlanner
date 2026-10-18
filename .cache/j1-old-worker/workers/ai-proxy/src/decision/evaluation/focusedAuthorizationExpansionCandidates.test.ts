import { describe, expect, it } from 'vitest';
import {
  FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES,
  FOCUSED_AUTHORIZATION_EXPANSION_LAYERS,
  expansionSplitForGroup,
  findExpansionUserTextOverlaps,
  fnv1a32,
  validateFocusedAuthorizationExpansionCandidates,
  type FocusedAuthorizationExpansionCandidate,
} from './focusedAuthorizationExpansionCandidates';
import { FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES } from './focusedAuthorizationSyntheticCandidates';

const candidates: readonly FocusedAuthorizationExpansionCandidate[] = FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES;

describe('focused authorization expansion candidates', () => {
  it('implements FNV-1a 32-bit over UTF-8 bytes', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
    expect(fnv1a32('あ')).toBe(fnv1a32('あ'));
  });

  it('passes validation against the existing synthetic candidates', () => {
    expect(() => validateFocusedAuthorizationExpansionCandidates(candidates)).not.toThrow();
  });

  it('writes every split exactly as the pre-registered group-hash rule computes it', () => {
    for (const value of candidates) {
      expect(value.split, value.id).toBe(expansionSplitForGroup(value.conversationGroupId));
    }
  });

  it('stays an unlabeled, provenance-tagged set of natural size covering every layer', () => {
    expect(candidates.length).toBeGreaterThanOrEqual(60);
    expect(candidates.length).toBeLessThanOrEqual(80);
    const groups = new Set(candidates.map((value) => value.conversationGroupId));
    expect(groups.size).toBeGreaterThanOrEqual(30);
    expect(groups.size).toBeLessThanOrEqual(40);
    expect(new Set(candidates.map((value) => value.layer))).toEqual(new Set(FOCUSED_AUTHORIZATION_EXPANSION_LAYERS));
    for (const value of candidates) {
      expect(value).not.toHaveProperty('expected');
      expect(value.reviewStatus).toBe('synthetic_unreviewed');
      expect(value.source).toBe('issue333_expansion_v1');
      expect(value.author).toBe('claude-opus-5-5 (Claude Code child)');
    }
  });

  it('rejects duplicated ids, crossed groups, rule-violating splits, empty text, and existing pairs', () => {
    const [first] = candidates;
    const flipped = first.split === 'tuning' ? 'holdout' : 'tuning';
    expect(() => validateFocusedAuthorizationExpansionCandidates([first, first])).toThrow(/Duplicate/);
    expect(() => validateFocusedAuthorizationExpansionCandidates([first, { ...first, id: 'other', split: flipped }]))
      .toThrow(/crosses evaluation splits/);
    expect(() => validateFocusedAuthorizationExpansionCandidates([{ ...first, split: flipped }]))
      .toThrow(/pre-registered rule/);
    expect(() => validateFocusedAuthorizationExpansionCandidates([{ ...first, currentUserText: ' ' }]))
      .toThrow(/Empty currentUserText/);
    const existing = FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES[0];
    expect(() => validateFocusedAuthorizationExpansionCandidates([{
      ...first, lastAssistantMessage: existing.lastAssistantMessage, currentUserText: existing.currentUserText,
    }])).toThrow(/duplicates an existing candidate pair/);
  });

  it('reports exact currentUserText overlaps with the existing candidates without failing', () => {
    const overlaps = findExpansionUserTextOverlaps(candidates);
    console.info('[issue333 expansion] currentUserText overlaps with existing candidates:', JSON.stringify(overlaps));
    expect(Array.isArray(overlaps)).toBe(true);
  });
});
