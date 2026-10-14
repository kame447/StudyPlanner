import { describe, expect, it } from 'vitest';
import {
  jevExecutionMode, lunaBaselineFailure, markJevExecution,
  markLunaBaselineFailure, stripJevExecutionMarker,
} from './decisionExecutionMarker';

describe('internal decision execution provenance', () => {
  it.each(['shadow', 'canary'] as const)('preserves the response while stripping both %s markers', async mode => {
    const original = new Response('baseline-body', {
      status: 207, statusText: 'Multi-Status',
      headers: { 'Content-Type': 'text/plain', 'X-Baseline': 'preserved' },
    });
    const marked = markLunaBaselineFailure(original, mode, 'cancelled');
    expect(jevExecutionMode(marked)).toBe(mode);
    expect(lunaBaselineFailure(marked)).toBe('cancelled');
    const publicResponse = stripJevExecutionMarker(marked);
    expect(jevExecutionMode(publicResponse)).toBeNull();
    expect(lunaBaselineFailure(publicResponse)).toBeNull();
    expect(publicResponse.status).toBe(207);
    expect(publicResponse.statusText).toBe('Multi-Status');
    expect(publicResponse.headers.get('X-Baseline')).toBe('preserved');
    expect(publicResponse.headers.get('Content-Type')).toBe('text/plain');
    expect(await publicResponse.text()).toBe('baseline-body');
  });

  it('returns an unmarked response unchanged and recognizes only closed marker values', () => {
    const original = new Response(null, { status: 204 });
    expect(stripJevExecutionMarker(original)).toBe(original);
    expect(markJevExecution(original, 'canary').status).toBe(204);
    for (const value of ['CANARY', 'canary ', 'unknown', 'save']) {
      const headers = new Headers({
        'X-StudyPlanner-Internal-Jev-Mode': value,
        'X-StudyPlanner-Internal-Luna-Baseline-Failure': value,
      });
      // Headers trims surrounding whitespace by specification.
      if (value.trim() !== 'canary') expect(jevExecutionMode({ headers })).toBeNull();
      expect(lunaBaselineFailure({ headers })).toBeNull();
    }
  });
});
