import { describe, expect, it } from 'vitest';
import {
  normalizeContainingTaskComponentParentV5,
} from './weeklyPlanningComponentParentNormalizationV5';

function parse(result: { rawResponse: string }) {
  return JSON.parse(result.rawResponse) as any;
}

describe('Stable V5 containing-task component parent normalization', () => {
  it('normalizes a containing task localId parent to null', () => {
    const result = normalizeContainingTaskComponentParentV5(JSON.stringify({
      tasks: [{
        localId: 'task-1',
        study: {
          components: [{
            localId: 'component-1',
            parentLocalId: 'task-1',
          }],
        },
      }],
    }));

    expect(parse(result).tasks[0].study.components[0].parentLocalId).toBeNull();
    expect(result.repairs).toEqual([
      'component-parent-task-reference-normalized:task-1:component-1',
    ]);
  });

  it('does not alter valid component-to-component hierarchy', () => {
    const rawResponse = JSON.stringify({
      tasks: [{
        localId: 'task-1',
        study: {
          components: [{ localId: 'parent', parentLocalId: null }, {
            localId: 'child',
            parentLocalId: 'parent',
          }],
        },
      }],
    });
    expect(normalizeContainingTaskComponentParentV5(rawResponse)).toEqual({
      rawResponse,
      repairs: [],
    });
  });

  it('does not repair an arbitrary missing parent reference', () => {
    const rawResponse = JSON.stringify({
      tasks: [{
        localId: 'task-1',
        study: {
          components: [{
            localId: 'component-1',
            parentLocalId: 'missing-component',
          }],
        },
      }],
    });
    expect(normalizeContainingTaskComponentParentV5(rawResponse)).toEqual({
      rawResponse,
      repairs: [],
    });
  });

  it('does not alter invalid JSON', () => {
    expect(normalizeContainingTaskComponentParentV5('{bad-json')).toEqual({
      rawResponse: '{bad-json',
      repairs: [],
    });
  });
});
