import { describe, expect, it } from 'vitest';
import {
  getStudySessionSwipeStartLimit,
  isStudySessionBackSwipe,
} from './studySessionSwipeNavigation';

describe('studySessionSwipeNavigation', () => {
  it('uses a forgiving left-edge activation area on phone widths', () => {
    expect(getStudySessionSwipeStartLimit(280)).toBe(72);
    expect(getStudySessionSwipeStartLimit(320)).toBe(80);
    expect(getStudySessionSwipeStartLimit(390)).toBe(96);
    expect(getStudySessionSwipeStartLimit(768)).toBe(96);
  });

  it('accepts a short, naturally diagonal back swipe', () => {
    expect(isStudySessionBackSwipe(56, 0)).toBe(true);
    expect(isStudySessionBackSwipe(64, 48)).toBe(true);
    expect(isStudySessionBackSwipe(70, 80)).toBe(true);
  });

  it('does not treat short drags or mostly vertical scrolling as back navigation', () => {
    expect(isStudySessionBackSwipe(55, 0)).toBe(false);
    expect(isStudySessionBackSwipe(60, 100)).toBe(false);
    expect(isStudySessionBackSwipe(20, 120)).toBe(false);
  });
});
