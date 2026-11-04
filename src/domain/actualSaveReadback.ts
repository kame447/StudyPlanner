import type { DurationActual } from '../types/domain';

export type ConfirmedActual = Pick<DurationActual, 'id' | 'userId' | 'occurrenceDate' | 'subject' | 'actualDurationMinutes'>;

export interface ActualSaveServerReadback {
  fromCache: boolean;
  hasPendingWrites: boolean;
  records: readonly ConfirmedActual[];
}

export class ActualSaveReadbackUnknownError extends Error {
  constructor(readonly reason: 'auth_mismatch' | 'unavailable' | 'permission_denied' | 'read_failed' | 'unconfirmed_snapshot') {
    super(`Actual save result is still unconfirmed: ${reason}.`);
    this.name = 'ActualSaveReadbackUnknownError';
  }
}

/** A save refused before anything was sent: the only rejection that proves nothing was written. */
export class ActualRecordsNotWrittenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActualRecordsNotWrittenError';
  }
}
