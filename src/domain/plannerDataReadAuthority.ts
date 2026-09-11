export type PlannerDataReadStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'stale';

export type PlannerDataAvailability =
  | {
      status: 'idle';
      ownerId: null;
      observedAt: null;
      lastSuccessfulAt: null;
    }
  | {
      status: 'loading';
      ownerId: string;
      observedAt: string;
      lastSuccessfulAt: string | null;
    }
  | {
      status: 'ready';
      ownerId: string;
      observedAt: string;
      lastSuccessfulAt: string;
    }
  | {
      status: 'unavailable';
      ownerId: string;
      observedAt: string;
      lastSuccessfulAt: null;
    }
  | {
      status: 'stale';
      ownerId: string;
      observedAt: string;
      lastSuccessfulAt: string;
    };

export interface PlannerDataLoadToken {
  ownerId: string;
  generation: number;
}

export interface PlannerDataLoadStart {
  token: PlannerDataLoadToken;
  availability: PlannerDataAvailability;
  ownerChanged: boolean;
}

export function createInitialPlannerDataAvailability(): PlannerDataAvailability {
  return {
    status: 'idle',
    ownerId: null,
    observedAt: null,
    lastSuccessfulAt: null,
  };
}

export function isPlannerDataReadyForOwner(
  availability: PlannerDataAvailability,
  ownerId: string,
): boolean {
  return availability.status === 'ready' && availability.ownerId === ownerId;
}

export class PlannerDataReadAuthority {
  private generation = 0;
  private availability: PlannerDataAvailability = createInitialPlannerDataAvailability();

  read(): PlannerDataAvailability {
    return { ...this.availability } as PlannerDataAvailability;
  }

  begin(ownerId: string, observedAt: string): PlannerDataLoadStart {
    this.generation += 1;
    const ownerChanged = this.availability.ownerId !== ownerId;
    const lastSuccessfulAt = !ownerChanged
      ? this.availability.lastSuccessfulAt
      : null;
    this.availability = {
      status: 'loading',
      ownerId,
      observedAt,
      lastSuccessfulAt,
    };
    return {
      token: { ownerId, generation: this.generation },
      availability: this.read(),
      ownerChanged,
    };
  }

  isCurrent(token: PlannerDataLoadToken): boolean {
    return token.generation === this.generation
      && this.availability.ownerId === token.ownerId;
  }

  succeed(
    token: PlannerDataLoadToken,
    observedAt: string,
  ): PlannerDataAvailability | null {
    if (!this.isCurrent(token)) return null;
    this.availability = {
      status: 'ready',
      ownerId: token.ownerId,
      observedAt,
      lastSuccessfulAt: observedAt,
    };
    return this.read();
  }

  fail(
    token: PlannerDataLoadToken,
    observedAt: string,
  ): PlannerDataAvailability | null {
    if (!this.isCurrent(token)) return null;
    const lastSuccessfulAt = this.availability.lastSuccessfulAt;
    this.availability = lastSuccessfulAt
      ? {
          status: 'stale',
          ownerId: token.ownerId,
          observedAt,
          lastSuccessfulAt,
        }
      : {
          status: 'unavailable',
          ownerId: token.ownerId,
          observedAt,
          lastSuccessfulAt: null,
        };
    return this.read();
  }

  reset(): PlannerDataAvailability {
    this.generation += 1;
    this.availability = createInitialPlannerDataAvailability();
    return this.read();
  }
}
