import { describe, expect, it } from 'vitest';
import { mergeEditedPlanMemo, splitPlanMemoInternalSegments, visiblePlanMemo } from './planInternalMemo';

const SAVED = 'Stable V5 preview / graphRevision: 2 / workItemKey: wpwi_1hmi2je / [weekly-source:stable-v5:2:wpwi_1hmi2je:0] / [weekly-approval:weekly-approval:ab12]';

describe('internal bookkeeping in a plan memo', () => {
  it.each(['', '図書館で', '数学 / 英語', 'year: 2020', 'source: dry-run preview', 'estimatedMinutes: 60 / year: 2020',
    '[weekly-planning] メモ', 'graphRevision: x'])('leaves the user\'s own memo exactly as it is: %j', memo => {
    expect(splitPlanMemoInternalSegments(memo)).toEqual({ visible: memo, internal: [] });
    expect(visiblePlanMemo(memo)).toBe(memo);
    expect(mergeEditedPlanMemo(memo, '書き換え')).toBe('書き換え');
  });

  it('hides every machine-written segment of a saved weekly plan, keeping them for the stored memo', () => {
    expect(visiblePlanMemo(SAVED)).toBe('');
    expect(splitPlanMemoInternalSegments(SAVED).internal).toHaveLength(5);
    expect(visiblePlanMemo('Stable V5 preview / graphRevision: 2 / workItemKey: w')).toBe('');
    expect(visiblePlanMemo('unsaved-preview: work-1')).toBe('');
  });

  it('shows only the user\'s part of a memo that also carries markers', () => {
    expect(visiblePlanMemo('図書館で / [weekly-source:b1] / [weekly-approval:op1]')).toBe('図書館で');
    expect(visiblePlanMemo('図書館で / 復習する / [weekly-source:b1]')).toBe('図書館で / 復習する');
  });

  it('hides the older dry-run form only next to its workItemKey', () => {
    expect(visiblePlanMemo('year: 2020 / estimatedMinutes: 60 / workItemKey: 数学:2020 / source: dry-run preview')).toBe('');
    expect(visiblePlanMemo('year: 2020 / 補足')).toBe('year: 2020 / 補足');
  });

  it('keeps the internal segments when the user edits the visible text, so the older approval lookup still finds the plan', () => {
    const stored = '図書館で / [weekly-source:b1] / [weekly-approval:op1]';
    const edited = mergeEditedPlanMemo(stored, '自習室で');
    expect(edited).toBe('自習室で / [weekly-source:b1] / [weekly-approval:op1]');
    expect(edited.includes('[weekly-source:b1]')).toBe(true);
    // Clearing the text leaves only the markers, which stay hidden.
    const cleared = mergeEditedPlanMemo(stored, '');
    expect(cleared).toBe('[weekly-source:b1] / [weekly-approval:op1]');
    expect(visiblePlanMemo(cleared)).toBe('');
    // Editing a memo that is only markers adds the user's text and keeps them all.
    expect(mergeEditedPlanMemo(SAVED, 'メモ')).toBe(`メモ / ${SAVED}`);
    expect(visiblePlanMemo(mergeEditedPlanMemo(SAVED, 'メモ'))).toBe('メモ');
  });

  it('keeps the markers out of the memo field while the user types a " / " into it', () => {
    let memo = '図書館で / [weekly-source:b1] / [weekly-approval:op1]';
    let shown = visiblePlanMemo(memo);
    for (const typed of ['', ...'数学 / 英語']) {
      memo = mergeEditedPlanMemo(memo, typed === '' ? '' : shown + typed);
      shown = visiblePlanMemo(memo);
      expect(shown).not.toContain('[weekly-');
    }
    expect(shown).toBe('数学 / 英語');
    expect(memo).toBe('数学 / 英語 / [weekly-source:b1] / [weekly-approval:op1]');
  });
});
