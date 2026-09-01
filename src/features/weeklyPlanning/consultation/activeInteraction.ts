import type {
  ActiveInteractionClaim,
  ActiveInteractionProjection,
} from './contracts';

function sameClaim(left: ActiveInteractionClaim, right: ActiveInteractionClaim): boolean {
  return left.kind === right.kind
    && left.targetId === right.targetId
    && left.expectedRevision === right.expectedRevision;
}

export function projectActiveInteraction(
  claims: readonly (ActiveInteractionClaim | null | undefined)[],
): ActiveInteractionProjection {
  const uniqueClaims: ActiveInteractionClaim[] = [];

  for (const claim of claims) {
    if (!claim) continue;
    if (!uniqueClaims.some((candidate) => sameClaim(candidate, claim))) {
      uniqueClaims.push(claim);
    }
  }

  if (uniqueClaims.length === 0) return { kind: 'none' };
  if (uniqueClaims.length > 1) return { kind: 'conflict', claims: uniqueClaims };

  const [claim] = uniqueClaims;
  return {
    kind: claim.kind,
    targetId: claim.targetId,
    expectedRevision: claim.expectedRevision,
  };
}

export function canUseImplicitInteraction(projection: ActiveInteractionProjection): boolean {
  return projection.kind !== 'none' && projection.kind !== 'conflict';
}
