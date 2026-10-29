import { describe, expect, it } from 'vitest';
import {
  allVNextComparisonFixtures,
  prototypeFixtures,
  regressionFixtures,
} from './vnextComparisonFixtures';

describe('VNext offline comparison fixture contract', () => {
  it('keeps all 21 revised prototype cases as independent typed scenarios', () => {
    expect(prototypeFixtures).toHaveLength(21);
    expect(new Set(prototypeFixtures.map(({ id }) => id)).size).toBe(21);
    expect(prototypeFixtures.every(({ turns, oracle }) => turns.length > 0 && oracle.outcome)).toBe(true);
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
      'issue-916-consent-no-new-number',
      'compound-progress-and-effort',
      'old-checkpoint-explicit-date',
      'category-and-identity-not-guessed',
      'contract-882-explicit-r7',
      'contract-882-r8-e60-order-a',
      'contract-882-r8-e60-order-b',
      'contract-yesterday-progress',
      'contract-custom-page-unit-change',
      'contract-repair-no-data-loss',
      'contract-one-to-thirty-minute-correction',
      'contract-explicit-date',
      'contract-note-plus-new-task',
      'contract-wait-deferral',
      'contract-denial-does-not-authorize-save',
      'contract-checkpoint-reload-approve',
    ]) expect(ids.has(id), `missing fixture ${id}`).toBe(true);

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
    expect(regressionFixtures.find(({ id }) => id === 'contract-checkpoint-reload-approve')?.checkpoint)
      .toMatchObject({ version: 'weekly-planning-resumable-conversation-v1', graphRevision: 3 });
  });
});
