import { describe, expect, it } from 'vitest';

import { normalizeCopiedUserContextDeltaV5 } from './weeklyPlanningCopiedUserContextNormalizationV5';

describe('normalizeCopiedUserContextDeltaV5 planning-window boundary', () => {
  it('leaves planning-window meaning untouched even when typed state has the same window', () => {
    const planningWindow = {
      localId: 'window-1',
      kind: 'relative_week',
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '来週',
    };
    const rawResponse = JSON.stringify({
      planningWindow,
      tasks: [],
      userContextFacts: [],
    });

    const result = normalizeCopiedUserContextDeltaV5({
      rawResponse,
      publicStateSummary: {
        planningWindows: [
          {
            publicId: 'accepted-window',
            kind: 'relative_week',
            value: 'next_week',
            start: null,
            end: null,
          },
        ],
        userPlanningContext: [],
      },
    });

    expect(result.rawResponse).toBe(rawResponse);
    expect(result.repairs).toEqual([]);
  });
});
