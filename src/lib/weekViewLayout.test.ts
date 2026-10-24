import { describe, expect, it } from 'vitest';
import {
  buildLanes,
} from './weekViewLayout';

function block(id: string, startTime: string, endTime: string) {
  return { id, title: id, subject: '数学', type: 'study' as const, startTime, endTime };
}

describe('week view lane allocation', () => {
  it('keeps empty input empty', () => {
    expect(buildLanes([])).toEqual([]);
  });

  it('sorts touching intervals without splitting their width', () => {
    const early = block('early', '08:00', '09:00');
    const late = block('late', '09:00', '10:00');
    expect(buildLanes([late, early])).toEqual([
      { ...early, lane: 0, laneCount: 1 },
      { ...late, lane: 0, laneCount: 1 },
    ]);
  });

  it('finalizes lane counts per connected overlap cluster and reuses the lowest free lane', () => {
    const a = block('a', '08:00', '10:00');
    const b = block('b', '09:00', '11:00');
    const c = block('c', '10:00', '12:00');
    const d = block('d', '12:00', '13:00');
    const e = block('e', '14:00', '15:00');
    const f = block('f', '14:30', '15:30');
    expect(buildLanes([f, d, c, b, e, a])).toEqual([
      { ...a, lane: 0, laneCount: 2 },
      { ...b, lane: 1, laneCount: 2 },
      { ...c, lane: 0, laneCount: 2 },
      { ...d, lane: 0, laneCount: 1 },
      { ...e, lane: 0, laneCount: 2 },
      { ...f, lane: 1, laneCount: 2 },
    ]);
  });

  it('keeps the peak cluster width for nested intervals after inner intervals end', () => {
    const outer = block('outer', '08:00', '14:00');
    const inner = block('inner', '09:00', '12:00');
    const nested = block('nested', '10:00', '11:00');
    const tail = block('tail', '12:00', '13:00');
    expect(buildLanes([tail, nested, inner, outer])).toEqual([
      { ...outer, lane: 0, laneCount: 3 },
      { ...inner, lane: 1, laneCount: 3 },
      { ...nested, lane: 2, laneCount: 3 },
      { ...tail, lane: 1, laneCount: 3 },
    ]);
  });

  it('sorts equal starts by end time and preserves input order for identical intervals', () => {
    const long = block('long', '08:00', '11:00');
    const first = block('first', '08:00', '09:00');
    const second = block('second', '08:00', '09:00');
    expect(buildLanes([long, first, second])).toEqual([
      { ...first, lane: 0, laneCount: 3 },
      { ...second, lane: 1, laneCount: 3 },
      { ...long, lane: 2, laneCount: 3 },
    ]);
  });

  it.each(['00:00', '24:00'])('treats end %s as the end of the day', (endTime) => {
    const late = block('late', '23:00', endTime);
    const overlap = block('overlap', '23:30', '24:00');
    expect(buildLanes([overlap, late])).toEqual([
      { ...late, lane: 0, laneCount: 2 },
      { ...overlap, lane: 1, laneCount: 2 },
    ]);
  });

  it.each(['09:00', '08:00'])('preserves the one-minute minimum for a 09:00–%s block', (endTime) => {
    const minimum = block('minimum', '09:00', endTime);
    const sameStart = block('same-start', '09:00', '09:01');
    const next = block('next', '09:01', '10:00');
    expect(buildLanes([next, sameStart, minimum])).toEqual([
      { ...minimum, lane: 0, laneCount: 2 },
      { ...sameStart, lane: 1, laneCount: 2 },
      { ...next, lane: 0, laneCount: 1 },
    ]);
  });

  it('preserves payload references and property order without mutating the input', () => {
    const payload = { id: 'plan-1' };
    const late = Object.freeze({ ...block('late', '10:00', '11:00'), payload });
    const early = Object.freeze(block('early', '08:00', '09:00'));
    const items: Array<ReturnType<typeof block> & { payload?: typeof payload }> = [late, early];
    Object.freeze(items);
    const result = buildLanes(items);
    expect(JSON.stringify(result)).toBe(JSON.stringify([
      { ...early, lane: 0, laneCount: 1 },
      { ...late, lane: 0, laneCount: 1 },
    ]));
    expect(result[1].payload).toBe(payload);
    expect(result[1]).not.toBe(late);
    expect(items).toEqual([late, early]);
  });
});
