import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_NOTHING_READ_TEXT,
  weeklyPlanningNothingReadNotice,
  weeklyPlanningReleaseAndNothingReadText,
} from './weeklyPlanningNothingReadDisclosure';

const once = (text: string) => text.split(WEEKLY_PLANNING_NOTHING_READ_TEXT).length - 1;

describe('nothing-read disclosure (one fact, one sentence)', () => {
  it('states nothing when neither the turn fact nor a no-delta release says so', () => {
    expect(weeklyPlanningNothingReadNotice(undefined)).toBeNull();
    expect(weeklyPlanningNothingReadNotice({})).toBeNull();
    expect(weeklyPlanningNothingReadNotice({ uncertaintyReleased: { nothingRead: false } })).toBeNull();
    expect(weeklyPlanningReleaseAndNothingReadText({ uncertaintyReleased: { quote: '平気？', nothingRead: false } })).not.toContain(WEEKLY_PLANNING_NOTHING_READ_TEXT);
  });
  it('the turn fact alone renders the sentence once', () => {
    expect(once(weeklyPlanningReleaseAndNothingReadText({ nothingRead: true }))).toBe(1);
  });
  it('a no-delta release alone renders the sentence once, after the release', () => {
    const text = weeklyPlanningReleaseAndNothingReadText({ uncertaintyReleased: { quote: '平気？', nothingRead: true } });
    expect(once(text)).toBe(1);
    expect(text.startsWith('「平気？」については未確定のまま進めます。')).toBe(true);
  });
  it('the turn fact and a no-delta release together still render it once', () => {
    expect(once(weeklyPlanningReleaseAndNothingReadText({ nothingRead: true, uncertaintyReleased: { quote: '平気？', nothingRead: true } }))).toBe(1);
  });
});
