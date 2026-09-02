import { describe, expect, it } from 'vitest';
import type { Actual, MonthEvent, Plan } from '../types/domain';
import { createLocalPlannerStorageGateway } from './localStorageGateway';
import { createLocalScheduleEventAuthority } from './localScheduleEventAuthority';
import { createPlannerRepository } from './plannerRepository';
import { createScheduleEventBackedPlannerRepository } from './scheduleEventAuthorityRepository';

const CREATED_AT = '2026-09-01T00:00:00.000Z';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'shared-id',
    seriesId: 'shared-id',
    userId: 'user-1',
    title: '英単語',
    subject: '英語',
    date: '2026-09-01',
    startTime: '20:00',
    endTime: '21:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function monthEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'shared-id',
    userId: 'user-1',
    date: '2026-09-02',
    endDate: '2026-09-03',
    title: '旅行',
    startTime: '08:00',
    endTime: '20:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: '',
    checklist: [],
    locationTags: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1',
    userId: 'user-1',
    planId: 'shared-id',
    occurrenceDate: '2026-09-01',
    actualStartTime: '20:00',
    actualEndTime: '21:00',
    title: '英単語',
    subject: '英語',
    isAlignedToPlan: true,
    note: '',
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function createRepository(storage: Storage) {
  const gateway = createLocalPlannerStorageGateway(storage);
  const legacy = createPlannerRepository(gateway);
  return {
    gateway,
    repository: createScheduleEventBackedPlannerRepository(
      legacy,
      createLocalScheduleEventAuthority(gateway, storage),
    ),
  };
}

describe('local ScheduleEvent authority', () => {
  it('migrates Plan and MonthEvent with colliding legacy ids into one canonical store', async () => {
    const storage = new MemoryStorage();
    const { gateway, repository } = createRepository(storage);
    await gateway.writePlans([plan()]);
    await gateway.writeMonthEvents([monthEvent()]);

    expect(await repository.getPlans('user-1')).toEqual([plan()]);
    expect(await repository.getMonthEvents('user-1')).toEqual([monthEvent()]);

    const stored = JSON.parse(storage.getItem('studyplanner.scheduleEvents.v1') ?? '[]');
    expect(stored.map((event: { id: string }) => event.id).sort()).toEqual([
      'month-event:shared-id',
      'plan:shared-id',
    ]);
  });

  it('freezes legacy schedule storage after cutover and does not re-import it on reload', async () => {
    const storage = new MemoryStorage();
    const first = createRepository(storage);
    const legacyPlan = plan();
    await first.gateway.writePlans([legacyPlan]);
    await first.gateway.writeMonthEvents([]);

    await first.repository.getPlans('user-1');
    const updatedPlan = plan({ title: 'canonical edit', updatedAt: '2026-09-02T00:00:00.000Z' });
    await first.repository.upsertPlan(updatedPlan);

    expect(await first.gateway.readPlans()).toEqual([legacyPlan]);
    expect(await first.repository.getPlans('user-1')).toEqual([updatedPlan]);

    const second = createRepository(storage);
    expect(await second.repository.getPlans('user-1')).toEqual([updatedPlan]);
    expect(await second.gateway.readPlans()).toEqual([legacyPlan]);
  });

  it('deletes linked Actual records with the canonical Plan without mutating frozen legacy Plans', async () => {
    const storage = new MemoryStorage();
    const { gateway, repository } = createRepository(storage);
    const legacyPlan = plan();
    await gateway.writePlans([legacyPlan]);
    await gateway.writeMonthEvents([]);
    await gateway.writeActuals([actual()]);

    await repository.getPlans('user-1');
    await repository.deletePlan('user-1', legacyPlan.id);

    expect(await repository.getPlans('user-1')).toEqual([]);
    expect(await repository.getActuals('user-1')).toEqual([]);
    expect(await gateway.readPlans()).toEqual([legacyPlan]);
  });

  it('preserves multi-day MonthEvent range through canonical updates', async () => {
    const storage = new MemoryStorage();
    const { gateway, repository } = createRepository(storage);
    const source = monthEvent();
    await gateway.writePlans([]);
    await gateway.writeMonthEvents([source]);

    await repository.getMonthEvents('user-1');
    const updated = monthEvent({ title: '旅行変更', endDate: '2026-09-05' });
    await repository.upsertMonthEvent(updated);

    expect(await repository.getMonthEvents('user-1')).toEqual([updated]);
    expect(await gateway.readMonthEvents()).toEqual([source]);
  });
});
