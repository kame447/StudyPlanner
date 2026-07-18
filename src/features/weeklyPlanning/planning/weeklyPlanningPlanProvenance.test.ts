import { describe, expect, it } from 'vitest';
import {
  buildWeeklyPlanningPlanSourceId,
  parseWeeklyPlanningPlanSourceId,
} from './weeklyPlanningPlanProvenance';

describe('weekly planning Plan provenance', () => {
  it('round-trips the approval operation and source draft block identity', () => {
    const identity = {
      approvalOperationId: 'weekly-approval:operation/1',
      sourceDraftBlockId: 'draft:block 1',
    };

    const sourceId = buildWeeklyPlanningPlanSourceId(identity);

    expect(sourceId).toBe(
      'v1:weekly-approval%3Aoperation%2F1:draft%3Ablock%201',
    );
    expect(parseWeeklyPlanningPlanSourceId(sourceId)).toEqual(identity);
  });

  it.each([undefined, null, '', 'v2:a:b', 'v1:only-one-part', 'v1:%E0%A4%A:b'])(
    'rejects malformed source IDs: %s',
    (value) => {
      expect(parseWeeklyPlanningPlanSourceId(value)).toBeNull();
    },
  );

  it('rejects empty identity parts before persistence', () => {
    expect(() => buildWeeklyPlanningPlanSourceId({
      approvalOperationId: ' ',
      sourceDraftBlockId: 'block-1',
    })).toThrow('approvalOperationId is required');
  });
});
