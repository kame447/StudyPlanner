import { describe, expect, it } from 'vitest';
import {
  allVNextComparisonFixtures,
  prototypeFixtures,
  regressionFixtures,
} from './vnextComparisonFixtures';

describe('VNext offline comparison fixture contract', () => {
  it('keeps all 20 distinct revised prototype cases as independent typed scenarios', () => {
    expect(prototypeFixtures).toHaveLength(20);
    expect(new Set(prototypeFixtures.map(({ id }) => id)).size).toBe(20);
    expect(prototypeFixtures.every(({ turns, oracle }) => turns.length > 0 && oracle.outcome)).toBe(true);
    expect(prototypeFixtures.some(({ id }) => id === 'proto-a02-p2')).toBe(true);
  });

  it('includes the named historical and contract regressions without treating V5 output as truth', () => {
    const ids = new Set(regressionFixtures.map(({ id }) => id));
    for (const id of [
      'replay-882-iter1',
      'replay-882-iter4',
      'contract-919-explicit-remaining',
      'issue-905-45-minute-work',
      'issue-906-derived-question-answer',
      'issue-907-same-or-distinct-closes',
      'issue-911-rate-total-conflict',
      'issue-912-target-other-scope',
      'issue-913-range-per-occurrence',
      'category-and-identity-not-guessed',
      'contract-882-r8-e60-order-a',
      'contract-882-r8-e60-order-b',
      'contract-yesterday-progress',
      'contract-past-activity-misread-as-session',
      'contract-repair-no-data-loss',
      'contract-one-to-thirty-minute-correction',
      'contract-explicit-date',
      'contract-note-plus-new-task',
      'contract-wait-deferral',
    ]) expect(ids.has(id), `missing fixture ${id}`).toBe(true);

    for (const id of [
      'issue-916-consent-no-new-number',
      'compound-progress-and-effort',
      'old-checkpoint-explicit-date',
      'contract-882-explicit-r7',
      'contract-custom-page-unit-change',
      'contract-denial-does-not-authorize-save',
      'contract-checkpoint-reload-approve',
    ]) expect(ids.has(id), `unexpected duplicate or out-of-scope fixture ${id}`).toBe(false);
    expect(regressionFixtures).toHaveLength(27);

    const defects = regressionFixtures.filter(({ knownV5Defects }) => knownV5Defects?.length);
    expect(defects.map(({ id }) => id)).toEqual(expect.arrayContaining([
      'replay-882-iter1',
      'replay-882-iter4',
      'contract-919-explicit-remaining',
    ]));
    expect(allVNextComparisonFixtures.length).toBe(prototypeFixtures.length + regressionFixtures.length);
    expect(new Set(allVNextComparisonFixtures.map(({ id }) => id)).size).toBe(allVNextComparisonFixtures.length);
    expect(allVNextComparisonFixtures.every(({ provenance, turns, oracle }) =>
      provenance.length > 0 && turns.length > 0 && oracle.outcome.length > 0)).toBe(true);
    expect(allVNextComparisonFixtures.every(({ v5 }) => v5 === 'unreachable')).toBe(true);
    expect(prototypeFixtures.find(({ id }) => id === 'proto-c8')?.turns).toHaveLength(1);
    expect(prototypeFixtures.find(({ id }) => id === 'proto-a01-p1')?.turns).toHaveLength(1);
    expect(regressionFixtures.find(({ id }) => id === 'issue-905-45-minute-work')?.turns).toHaveLength(1);
    expect(regressionFixtures.filter(({ v5KnownDefect }) => v5KnownDefect)
      .every(({ v5KnownDefect }) => Boolean(v5KnownDefect?.expectedV5Behaviour.length))).toBe(true);
  });

  it('keeps the 882 replay and explicit-remaining oracle separate from the known V5 defects', () => {
    const replay1 = regressionFixtures.find(({ id }) => id === 'replay-882-iter1')!;
    const replay4 = regressionFixtures.find(({ id }) => id === 'replay-882-iter4')!;
    const explicitRemaining = regressionFixtures.find(({ id }) => id === 'contract-919-explicit-remaining')!;

    expect(replay1.oracle.preserved).toContain('scope_total=20');
    expect(replay4.oracle.preserved).toContain('remaining=8');
    expect(explicitRemaining.oracle.preserved).toContain('remaining=7');
    expect(explicitRemaining.knownV5Defects?.join(' ')).toContain('#919');
    expect(explicitRemaining.provenance).toContain('#882 R7 replay');
  });

  it('separates the typed completed-work reading from the preserved misread input', () => {
    const completed = regressionFixtures.find(({ id }) => id === 'contract-yesterday-progress')!;
    const misread = regressionFixtures.find(({ id }) => id === 'contract-past-activity-misread-as-session')!;
    expect(completed.turns[0].facts).toEqual([
      { kind: 'workload', task: 'math', role: 'completed', amount: 30, unit: 'minute' },
    ]);
    expect(completed.oracle).toMatchObject({
      outcome: 'nothing_to_schedule',
      preserved: ['completed=30 minutes'],
    });
    expect(completed.oracle.notes?.join(' ')).toContain('date it occurred');
    expect(completed.oracle.notes?.join(' ')).toContain('unsupported in #926');
    expect(misread.turns[0].facts).toEqual([
      { kind: 'temporal', task: 'math', constraint: 'deadline', dateExpression: '2026-10-28' },
      { kind: 'effort', task: 'math', measure: 'session_duration', minutes: 30 },
    ]);
    expect(misread.oracle).toMatchObject({ outcome: 'question', question: 'missing_schedulable_work' });
    expect(misread.oracle.notes?.join(' ')).toContain('Do not reclassify this misread by comparing its date');
    expect(misread.name).toContain('negative corruption test');
    expect(misread.oracle.notes?.join(' ')).toContain('not a semantic acceptance');
  });
});
