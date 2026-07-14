import { describe, expect, it } from 'vitest';
import {
  resolveRelativeConstraint,
  resolveRelativeConstraints,
  validateRelativeConstraint,
  type RelativeConstraint,
  type RelativeConstraintAnchor,
} from './weeklyPlanningRelativeConstraints';

const anchor: RelativeConstraintAnchor = {
  factRef: 'fact:work',
  eventId: 'event:work',
  date: '2026-07-14',
  startTime: '18:00',
  endTime: '22:00',
  visibility: 'public',
  stateRevision: 4,
  sourceFactRefs: ['fact:work'],
};

const relation: RelativeConstraint = {
  relationId: 'relation:commute-after-work',
  anchorFactRef: 'fact:work',
  relation: 'after',
  offsetMinutes: 0,
  durationMinutes: 10,
  sourceFactRefs: ['fact:commute'],
  stateRevision: 4,
  confidence: 'high',
};

describe('weeklyPlanningRelativeConstraints', () => {
  it('resolves an authorized current public anchor deterministically', () => {
    const validation = validateRelativeConstraint({
      value: relation,
      anchors: [anchor],
      currentStateRevision: 4,
    });
    expect(validation.accepted).toBe(true);
    expect(resolveRelativeConstraint(validation)).toEqual({
      relationId: 'relation:commute-after-work',
      anchorEventId: 'event:work',
      date: '2026-07-14',
      startTime: '22:00',
      endTime: '22:10',
      sourceFactRefs: ['fact:commute', 'fact:work'],
      stateRevision: 4,
    });
  });

  it('rejects private, stale, ambiguous and cyclic anchors', () => {
    expect(validateRelativeConstraint({
      value: relation,
      anchors: [{ ...anchor, visibility: 'private' }],
      currentStateRevision: 4,
    })).toMatchObject({ accepted: false, reason: 'private-anchor' });

    expect(validateRelativeConstraint({
      value: relation,
      anchors: [{ ...anchor, stateRevision: 3 }],
      currentStateRevision: 4,
    })).toMatchObject({ accepted: false, reason: 'stale-anchor' });

    expect(validateRelativeConstraint({
      value: relation,
      anchors: [anchor, { ...anchor, eventId: 'event:work-2' }],
      currentStateRevision: 4,
    })).toMatchObject({ accepted: false, reason: 'ambiguous-anchor' });

    expect(validateRelativeConstraint({
      value: { ...relation, relationId: 'relation:a', anchorFactRef: 'relation:b' },
      anchors: [{ ...anchor, factRef: 'relation:b' }],
      existingRelations: [{ ...relation, relationId: 'relation:b', anchorFactRef: 'relation:a' }],
      currentStateRevision: 4,
    })).toMatchObject({ accepted: false, reason: 'relative-constraint-cycle' });
  });

  it('reports deterministic overlap diagnostics without applying a partial mutation', () => {
    const result = resolveRelativeConstraints({
      constraints: [relation],
      anchors: [anchor],
      currentStateRevision: 4,
      busyIntervals: [{
        ref: 'existing-plan:meal',
        date: '2026-07-14',
        startTime: '22:05',
        endTime: '22:30',
      }],
    });

    expect(result.resolved).toHaveLength(1);
    expect(result.conflicts).toEqual([{
      relationId: 'relation:commute-after-work',
      conflictRef: 'existing-plan:meal',
      reason: 'overlap',
    }]);
  });
});
