import type { LifeConstraint } from './weeklyPlanningIntakeTypes';

export function isReplaceableLifeConstraint(constraint: LifeConstraint): boolean {
  return constraint.kind !== 'fixed_event' && constraint.kind !== 'unavailable';
}

export function getLifeConstraintIdentity(constraint: LifeConstraint): string {
  return [
    constraint.kind,
    constraint.date ?? '',
    constraint.start ?? '',
    constraint.end ?? '',
    constraint.durationMinutes ?? '',
    constraint.hardness,
  ].join('|');
}

export function dedupeLifeConstraints(constraints: LifeConstraint[]): LifeConstraint[] {
  const seen = new Set<string>();
  const dedupedConstraints: LifeConstraint[] = [];

  constraints.forEach((constraint) => {
    const identity = getLifeConstraintIdentity(constraint);

    if (seen.has(identity)) {
      return;
    }

    seen.add(identity);
    dedupedConstraints.push(constraint);
  });

  return dedupedConstraints;
}

export function mergeLifeConstraints(
  previousConstraints: LifeConstraint[],
  newConstraints: LifeConstraint[],
): LifeConstraint[] {
  return newConstraints.reduce<LifeConstraint[]>((mergedConstraints, newConstraint) => {
    if (!isReplaceableLifeConstraint(newConstraint)) {
      return dedupeLifeConstraints([...mergedConstraints, newConstraint]);
    }

    return [
      ...mergedConstraints.filter((constraint) => constraint.kind !== newConstraint.kind),
      newConstraint,
    ];
  }, previousConstraints);
}