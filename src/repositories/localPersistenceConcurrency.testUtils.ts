import { vi } from 'vitest';
import * as gatewayModule from './localStorageGateway';
import { createLocalPlannerRepository } from './createLocalPlannerRepository';
import type { Actual, MonthEvent, Plan, TodoTask } from '../types/domain';
import type { PlannerStorageGateway } from './repositoryContracts';
export class MemoryStorage implements Storage {
    protected values = new Map<string, string>();
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key: string) { return this.values.get(key) ?? null; }
    key(index: number) { return [...this.values.keys()][index] ?? null; }
    removeItem(key: string) { this.values.delete(key); }
    setItem(key: string, value: string) { this.values.set(key, value); }
}
export const DATE = '2026-10-04', STAMP = DATE + 'T00:00:00.000Z';
export const plan = (o: Partial<Plan> = {}): Plan => ({ id: 'plan', seriesId: 'plan', userId: 'owner', title: 'Restored Plan', subject: 'Math', date: DATE, startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'study', memo: '', createdAt: STAMP, updatedAt: STAMP, ...o });
export const event = (o: Partial<MonthEvent> = {}): MonthEvent => ({ id: 'event', userId: 'owner', date: DATE, endDate: DATE, title: 'Original event', startTime: '08:00', endTime: '09:00', repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: STAMP, updatedAt: STAMP, ...o });
export const actual = (o: Partial<Actual> = {}): Actual => ({ id: 'actual', userId: 'owner', planId: 'plan', occurrenceDate: DATE, actualStartTime: '09:00', actualEndTime: '10:00', title: 'Restored Actual', subject: 'Math', note: 'Original actual', updatedAt: STAMP, ...o });
export const todo = (o: Partial<TodoTask> = {}): TodoTask => ({ id: 'todo', userId: 'owner', title: 'Restored Todo', subject: 'Math', type: 'study', estimatedMinutes: 60, dueDate: null, memo: '', status: 'scheduled', scheduledPlanId: 'plan', createdAt: STAMP, updatedAt: STAMP, ...o });
export const mutation = () => ({ plan: plan(), actuals: [actual()], todo: todo() });
export function deferred<T = void>() { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export async function microtasks() { for (let i = 0; i < 30; i++)
    await Promise.resolve(); }
export function createLocalFixture(storage: Storage = new MemoryStorage()) {
    const gateway = gatewayModule.createLocalPlannerStorageGateway(storage);
    const hook = vi.spyOn(gatewayModule, 'createLocalPlannerStorageGateway').mockReturnValue(gateway);
    const repository = createLocalPlannerRepository(storage);
    hook.mockRestore();
    return { storage, gateway, repository };
}
export function pauseActualWrite(gateway: PlannerStorageGateway, options: {
    afterPersist?: boolean;
    rollbackFailure?: Error;
} = {}) {
    const entered = deferred(), release = deferred(), original = gateway.writeActuals;
    let calls = 0;
    gateway.writeActuals = async (rows) => { calls++; if (calls === 1) {
        if (options.afterPersist)
            await original(rows);
        entered.resolve();
        await release.promise;
        if (options.afterPersist)
            return;
    } if (calls === 2 && options.rollbackFailure)
        throw options.rollbackFailure; await original(rows); };
    return { entered, release, get calls() { return calls; } };
}
export function pauseActualRead(gateway: PlannerStorageGateway) {
    const entered = deferred(), release = deferred(), original = gateway.readActuals;
    let first = true;
    gateway.readActuals = async () => { const result = await original(); if (first) {
        first = false;
        entered.resolve();
        await release.promise;
    } return result; };
    return { entered, release };
}
