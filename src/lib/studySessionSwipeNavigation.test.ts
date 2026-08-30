import { describe, expect, it } from 'vitest';
import {
  getStudySessionSwipeIntent,
  getStudySessionSwipeStartLimit,
  getStudySessionSwipeTriggerDistance,
  isStudySessionBackSwipe,
} from './studySessionSwipeNavigation';

describe('studySessionSwipeNavigation', () => {
  it('uses a wide but bounded activation area on phone widths', () => {
    expect(getStudySessionSwipeStartLimit(280)).toBe(112);
    expect(getStudySessionSwipeStartLimit(320)).toBe(128);
    expect(getStudySessionSwipeStartLimit(390)).toBe(156);
    expect(getStudySessionSwipeStartLimit(768)).toBe(160);
  });

  it('locks a rightward gesture once horizontal intent is clear', () => {
    expect(getStudySessionSwipeIntent(4, 2)).toBe('pending');
    expect(getStudySessionSwipeIntent(10, 8)).toBe('horizontal');
    expect(getStudySessionSwipeIntent(18, 20)).toBe('horizontal');
    expect(getStudySessionSwipeIntent(6, 26)).toBe('cancel');
    expect(getStudySessionSwipeIntent(-8, 0)).toBe('cancel');
  });

  it('keeps completion forgiving after horizontal intent has been locked', () => {
    expect(getStudySessionSwipeTriggerDistance(390)).toBeCloseTo(62.4);
    expect(isStudySessionBackSwipe(64, 0, 390)).toBe(true);
    expect(isStudySessionBackSwipe(30, 0.25, 390)).toBe(true);
    expect(isStudySessionBackSwipe(30, 0.1, 390)).toBe(false);
    expect(isStudySessionBackSwipe(64, 0.3, 390, false)).toBe(false);
  });
});
