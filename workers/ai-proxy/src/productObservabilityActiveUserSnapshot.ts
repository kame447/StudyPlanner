import type { ObservabilityEnvironment } from '../../../shared/productObservabilityContract';
import {
  PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
  PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
  type ObservabilityActiveUserDirtySource,
  type ObservabilityActiveUserWindows,
  type ObservabilityActorDay,
} from '../../../shared/productObservabilityReadModel';
import {
  FirestoreServiceAccountClient,
  type FirestoreOrderedCursor,
  type FirestoreOrderedDocument,
  type FirestoreServiceAccountEnv,
} from './firestoreServiceAccountClient';
import { observabilityReportingDate } from './productObservabilityReadModelProjection';

const ACTOR_DAY_COLLECTION = 'observability_actor_day';
const ACTIVE_USER_WINDOW_COLLECTION = 'observability_active_user_windows';
const ACTOR_DAY_PAGE_SIZE = 500;
const READ_MODEL_RETENTION_DAYS = 400;

interface ActiveUserSnapshotFirestore {
  getDocument(collection: string, id: string): Promise<Record<string, unknown> | null>;
  setDocument(collection: string, id: string, value: Record<string, unknown>): Promise<void>;
  queryDocumentsAfter(params: {
    collection: string;
    orderByField: string;
    filters?: Array<{ field: string; value: string }>;
    cursor?: FirestoreOrderedCursor | null;
    limit?: number;
  }): Promise<FirestoreOrderedDocument[]>;
}

export interface ProductObservabilityActiveUserSnapshotEnv extends FirestoreServiceAccountEnv {
  ENVIRONMENT?: string;
}

function normalizedEnvironment(value: string | undefined): ObservabilityEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'preview' || normalized === 'development' || normalized === 'test') {
    return normalized;
  }
  return 'production';
}

function addDays(localDate: string, offset: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('observability_date_invalid');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function datesEndingAt(asOfDate: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => addDays(asOfDate, index - days + 1));
}

function snapshotId(environment: ObservabilityEnvironment, asOfDate: string): string {
  return `${environment}:${asOfDate}`;
}

function expiryFrom(nowIso: string): string {
  return new Date(
    new Date(nowIso).getTime() + READ_MODEL_RETENTION_DAYS * 86_400_000,
  ).toISOString();
}

function asActorDay(row: FirestoreOrderedDocument): ObservabilityActorDay {
  const { id: _id, documentName: _documentName, ...value } = row;
  return value as unknown as ObservabilityActorDay;
}

function targetKey(environment: ObservabilityEnvironment, localDate: string): string {
  return `${environment}:${localDate}`;
}

export class ProductObservabilityActiveUserSnapshotService {
  private readonly defaultEnvironment: ObservabilityEnvironment;

  constructor(
    env: ProductObservabilityActiveUserSnapshotEnv,
    private readonly firestore: ActiveUserSnapshotFirestore = new FirestoreServiceAccountClient(env),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.defaultEnvironment = normalizedEnvironment(env.ENVIRONMENT);
  }

  private async actorIdsForDate(
    environment: ObservabilityEnvironment,
    localDate: string,
  ): Promise<Set<string>> {
    const actors = new Set<string>();
    let cursor: FirestoreOrderedCursor | null = null;
    while (true) {
      const page = await this.firestore.queryDocumentsAfter({
        collection: ACTOR_DAY_COLLECTION,
        orderByField: 'localDate',
        filters: [{ field: 'localDate', value: localDate }],
        cursor,
        limit: ACTOR_DAY_PAGE_SIZE,
      });
      for (const row of page) {
        const actorDay = asActorDay(row);
        if (actorDay.environment === environment && actorDay.actorSubjectId) {
          actors.add(actorDay.actorSubjectId);
        }
      }
      if (page.length < ACTOR_DAY_PAGE_SIZE) break;
      const last = page[page.length - 1];
      cursor = {
        orderedValue: localDate,
        documentName: last.documentName,
      };
    }
    return actors;
  }

  async refresh(
    environment: ObservabilityEnvironment,
    asOfDate: string,
  ): Promise<ObservabilityActiveUserWindows> {
    const dates = datesEndingAt(asOfDate, 30);
    const byDate = new Map<string, Set<string>>();
    for (const localDate of dates) {
      byDate.set(localDate, await this.actorIdsForDate(environment, localDate));
    }

    const todayActors = byDate.get(asOfDate) ?? new Set<string>();
    const last7Actors = new Set<string>();
    const last30Actors = new Set<string>();
    const last7Dates = new Set(datesEndingAt(asOfDate, 7));
    for (const [localDate, actors] of byDate.entries()) {
      for (const actor of actors) {
        last30Actors.add(actor);
        if (last7Dates.has(localDate)) last7Actors.add(actor);
      }
    }

    const updatedAt = this.now().toISOString();
    const snapshot: ObservabilityActiveUserWindows = {
      schemaVersion: PRODUCT_OBSERVABILITY_READ_MODEL_VERSION,
      environment,
      asOfDate,
      reportingTimeZone: PRODUCT_OBSERVABILITY_REPORTING_TIME_ZONE,
      today: todayActors.size,
      last7Days: last7Actors.size,
      last30Days: last30Actors.size,
      updatedAt,
      expireAt: expiryFrom(updatedAt),
    };
    await this.firestore.setDocument(
      ACTIVE_USER_WINDOW_COLLECTION,
      snapshotId(environment, asOfDate),
      snapshot as unknown as Record<string, unknown>,
    );
    return snapshot;
  }

  async refreshAffected(
    sources: readonly ObservabilityActiveUserDirtySource[],
  ): Promise<ObservabilityActiveUserWindows[]> {
    const today = observabilityReportingDate(this.now().toISOString());
    const targets = new Map<string, {
      environment: ObservabilityEnvironment;
      localDate: string;
    }>();
    const current = await this.firestore.getDocument(
      ACTIVE_USER_WINDOW_COLLECTION,
      snapshotId(this.defaultEnvironment, today),
    );
    if (!current) {
      targets.set(targetKey(this.defaultEnvironment, today), {
        environment: this.defaultEnvironment,
        localDate: today,
      });
    }

    for (const source of sources) {
      for (let offset = 0; offset < 30; offset += 1) {
        const targetDate = addDays(source.localDate, offset);
        if (targetDate > today) break;
        targets.set(targetKey(source.environment, targetDate), {
          environment: source.environment,
          localDate: targetDate,
        });
      }
    }

    const snapshots: ObservabilityActiveUserWindows[] = [];
    const orderedTargets = [...targets.values()].sort((left, right) =>
      targetKey(left.environment, left.localDate)
        .localeCompare(targetKey(right.environment, right.localDate)));
    for (const target of orderedTargets) {
      snapshots.push(await this.refresh(target.environment, target.localDate));
    }
    return snapshots;
  }
}
