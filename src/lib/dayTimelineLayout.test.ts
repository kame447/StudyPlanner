import { describe, expect, it } from 'vitest';
import { layoutTimelineEntries } from './dayTimelineLayout';

const options = { hourHeight: 54, minBlockHeight: 34 };

describe('layoutTimelineEntries', () => {
  it('keeps non-overlapping entries in a single lane', () => {
    const result = layoutTimelineEntries(
      [
        { id: 'a', startTime: '09:00', endTime: '10:00' },
        { id: 'b', startTime: '10:00', endTime: '11:00' },
      ],
      options,
    );

    expect(result.map(({ id, lane, laneCount }) => ({ id, lane, laneCount }))).toEqual([
      { id: 'a', lane: 0, laneCount: 1 },
      { id: 'b', lane: 0, laneCount: 1 },
    ]);
  });

  it('assigns separate lanes to visually overlapping entries', () => {
    const result = layoutTimelineEntries(
      [
        { id: 'a', startTime: '09:00', endTime: '10:00' },
        { id: 'b', startTime: '09:30', endTime: '10:30' },
      ],
      options,
    );

    expect(result.map(({ id, lane, laneCount }) => ({ id, lane, laneCount }))).toEqual([
      { id: 'a', lane: 0, laneCount: 2 },
      { id: 'b', lane: 1, laneCount: 2 },
    ]);
  });

  it('uses minimum visual block height when grouping short entries', () => {
    const result = layoutTimelineEntries(
      [
        { id: 'a', startTime: '09:00', endTime: '09:05' },
        { id: 'b', startTime: '09:10', endTime: '09:15' },
      ],
      options,
    );

    expect(result.every((entry) => entry.laneCount === 2)).toBe(true);
  });
});
