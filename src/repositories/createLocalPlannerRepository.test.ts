import { describe, expect, it, vi } from 'vitest';
import * as facadeModule from './scheduleEventAuthorityRepository';
import { createLocalPlannerRepository } from './createLocalPlannerRepository';
import { MemoryStorage, actual, deferred, event, createLocalFixture, microtasks, mutation, pauseActualRead, pauseActualWrite, plan, todo } from './localPersistenceConcurrency.testUtils';
// These gates delay the real local gateway, never mock the command's result.
// All final assertions reread durable Storage through real repository methods.
describe('local planner shared storage access', () => {
    for (const window of ['forward', 'rollback'] as const)
        for (const change of ['insert', 'update', 'delete'] as const) {
            it(`queues unrelated MonthEvent ${change} during the ${window} window`, async () => {
                const f = createLocalFixture();
                await f.repository.upsertMonthEvent(event());
                const pause = window === 'forward' ? pauseActualRead(f.gateway) : pauseActualWrite(f.gateway);
                const original = Error('dependent write failed');
                const restore = f.repository.restorePlanWithDependents(mutation()).catch(error => error);
                await pause.entered.promise;
                let saved = false;
                const other = (change === 'delete' ? f.repository.deleteMonthEvent('owner', 'event') : f.repository.upsertMonthEvent(event({ id: change === 'insert' ? 'new' : 'event', title: 'NEWER' }))).then(() => { saved = true; });
                await microtasks();
                expect(saved).toBe(false);
                if (window === 'rollback')
                    pause.release.reject(original);
                else
                    pause.release.resolve();
                expect(await restore).toBe(window === 'rollback' ? original : undefined);
                await other;
                const rows = await f.repository.getMonthEvents('owner');
                if (change === 'delete')
                    expect(rows).toEqual([]);
                else
                    expect(rows.find(row => row.id === (change === 'insert' ? 'new' : 'event'))?.title).toBe('NEWER');
            });
        }
    for (const change of ['changed-value', 'same-value', 'delete'] as const)
        it(`retains a later same-target Plan ${change} command`, async () => {
            const f = createLocalFixture();
            await f.repository.getPlans('owner');
            const pause = pauseActualWrite(f.gateway);
            const restore = f.repository.restorePlanWithDependents(mutation()).catch(error => error);
            await pause.entered.promise;
            let settled = false;
            const newer = (change === 'delete' ? f.repository.deletePlan('owner', 'plan') : f.repository.upsertPlan(plan({ title: change === 'changed-value' ? 'NEWER' : 'Restored Plan' }))).then(() => { settled = true; });
            await microtasks();
            expect(settled).toBe(false);
            pause.release.reject(Error('failed'));
            await restore;
            await newer;
            const rows = await f.repository.getPlans('owner');
            if (change === 'delete')
                expect(rows).toEqual([]);
            else
                expect(rows[0].title).toBe(change === 'changed-value' ? 'NEWER' : 'Restored Plan');
        });
    for (const kind of ['actual', 'todo'] as const)
        for (const window of ['forward', 'rollback'] as const)
            it(`preserves a later unrelated ${kind} through ${window}`, async () => {
                const f = createLocalFixture();
                await f.repository.upsertActual(actual({ id: 'other', planId: null }));
                await f.repository.upsertTodo(todo({ id: 'other' }));
                const pause = window === 'forward' ? pauseActualRead(f.gateway) : pauseActualWrite(f.gateway);
                const restore = f.repository.restorePlanWithDependents(mutation()).catch(error => error);
                await pause.entered.promise;
                const newer = kind === 'actual' ? f.repository.upsertActual(actual({ id: 'other', planId: null, note: 'NEWER' })) : f.repository.upsertTodo(todo({ id: 'other', title: 'NEWER' }));
                await microtasks();
                if (window === 'rollback')
                    pause.release.reject(Error('failed'));
                else
                    pause.release.resolve();
                await restore;
                await newer;
                if (kind === 'actual')
                    expect((await f.repository.getActuals('owner')).find(row => row.id === 'other')?.note).toBe('NEWER');
                else
                    expect((await f.repository.getTodos('owner')).find(row => row.id === 'other')?.title).toBe('NEWER');
            });
    for (const kind of ['actual', 'todo'] as const) {
        it(`preserves a newer same-target ${kind} including linked-Actual occurrence identity`, async () => {
            const f = createLocalFixture();
            const pause = pauseActualWrite(f.gateway);
            const restore = f.repository.restorePlanWithDependents(mutation()).catch(error => error);
            await pause.entered.promise;
            const later = kind === 'actual'
                ? f.repository.upsertActual(actual({ id: 'new-id-for-same-occurrence', note: 'NEWER' }))
                : f.repository.upsertTodo(todo({ title: 'NEWER' }));
            await microtasks();
            pause.release.reject(Error('failed'));
            await restore;
            await later;
            if (kind === 'actual') {
                const rows = await f.repository.getActuals('owner');
                expect(rows).toHaveLength(1);
                expect(rows[0].id).toBe('new-id-for-same-occurrence');
                expect(rows[0].note).toBe('NEWER');
            } else {
                expect((await f.repository.getTodos('owner'))[0].title).toBe('NEWER');
            }
        });
    }
    it('holds readers until compensation settles, rather than exposing partial restoration', async () => {
        const f = createLocalFixture();
        await f.repository.getPlans('owner');
        const pause = pauseActualWrite(f.gateway);
        const restore = f.repository.restorePlanWithDependents(mutation()).catch(error => error);
        await pause.entered.promise;
        // Physical storage does contain an intermediate row; the facade reader waits.
        expect(JSON.parse(f.storage.getItem('studyplanner.scheduleEvents.v1')!)).toHaveLength(1);
        let read = false;
        const reading = f.repository.getPlans('owner').then(rows => { read = true; return rows; });
        await microtasks();
        expect(read).toBe(false);
        pause.release.reject(Error('failed'));
        await restore;
        expect(await reading).toEqual([]);
    });
    it('shares one queue between factory instances and owners using the same physical Storage', async () => {
        const storage = new MemoryStorage(), a = createLocalFixture(storage), b = createLocalFixture(storage);
        await a.repository.getPlans('owner');
        await b.repository.upsertMonthEvent(event({ id: 'other-owner-event', userId: 'other-owner' }));
        const pause = pauseActualWrite(a.gateway), restore = a.repository.restorePlanWithDependents(mutation()).catch(error => error);
        await pause.entered.promise;
        let saved = false;
        const other = b.repository.upsertMonthEvent(event({ id: 'other-owner-event', userId: 'other-owner', title: 'NEWER' })).then(() => { saved = true; });
        await microtasks();
        expect(saved).toBe(false);
        pause.release.reject(Error('failed'));
        await restore;
        await other;
        expect((await b.repository.getMonthEvents('other-owner'))[0].title).toBe('NEWER');
    });
    it('does not block an independent physical Storage instance', async () => {
        const a = createLocalFixture(), b = createLocalFixture();
        const pause = pauseActualWrite(a.gateway), restore = a.repository.restorePlanWithDependents(mutation()).catch(error => error);
        await pause.entered.promise;
        await b.repository.upsertMonthEvent(event({ title: 'INDEPENDENT' }));
        expect((await b.repository.getMonthEvents('owner'))[0].title).toBe('INDEPENDENT');
        pause.release.reject(Error('failed'));
        await restore;
    });
    it('holds the queue through asynchronous rollback and releases it after rollback failure', async () => {
        const f = createLocalFixture();
        await f.repository.getPlans('owner');
        const entered = deferred(), failApply = deferred(), rollbackEntered = deferred(), failRollback = deferred();
        const write = f.gateway.writeActuals;
        let calls = 0;
        f.gateway.writeActuals = async (rows) => { calls++; if (calls === 1) {
            await write(rows);
            entered.resolve();
            await failApply.promise;
        }
        else if (calls === 2) {
            rollbackEntered.resolve();
            await failRollback.promise;
        }
        else
            await write(rows); };
        const restore = f.repository.restorePlanWithDependents(mutation()).catch(error => error);
        await entered.promise;
        let saved = false;
        const queued = f.repository.upsertActual(actual({ id: 'later', planId: null, note: 'NEWER' })).then(() => { saved = true; });
        failApply.reject(Error('original failure'));
        await rollbackEntered.promise;
        await microtasks();
        expect(saved).toBe(false);
        failRollback.reject(Error('rollback failure'));
        const failure = await restore;
        expect(failure.message).toBe('予定復元に失敗し、ロールバックにも失敗しました: rollback failure');
        await queued;
        // Compensation failure is still partial failure, not an atomic abort.
        const rows = await f.repository.getActuals('owner');
        expect(rows.some(row => row.id === 'actual')).toBe(true);
        expect(rows.find(row => row.id === 'later')?.note).toBe('NEWER');
    });
    it('preserves the original thrown object when compensation succeeds', async () => {
        const f = createLocalFixture(), pause = pauseActualWrite(f.gateway), original = { code: 'STORAGE_FAILURE' };
        const restore = f.repository.restorePlanWithDependents(mutation()).catch(error => error);
        await pause.entered.promise;
        pause.release.reject(original);
        expect(await restore).toBe(original);
        await f.repository.upsertMonthEvent(event());
        expect(await f.repository.getPlans('owner')).toEqual([]);
    });
    it('serializes first-read migration with writes from another fresh instance without reentrant deadlock', async () => {
        const storage = new MemoryStorage(), a = createLocalFixture(storage), b = createLocalFixture(storage);
        await a.gateway.writePlans([plan()]);
        await a.gateway.writeMonthEvents([event()]);
        const entered = deferred(), release = deferred(), read = a.gateway.readPlans;
        a.gateway.readPlans = async () => { const rows = await read(); entered.resolve(); await release.promise; return rows; };
        const migration = a.repository.getPlans('owner');
        await entered.promise;
        let saved = false;
        const later = b.repository.upsertMonthEvent(event({ title: 'NEWER' })).then(() => { saved = true; });
        await microtasks();
        expect(saved).toBe(false);
        release.resolve();
        expect(await migration).toHaveLength(1);
        await later;
        expect((await b.repository.getMonthEvents('owner'))[0].title).toBe('NEWER');
        expect((await b.gateway.readMonthEvents())[0].title).toBe('Original event');
    });
    it('wraps every facade method and recovers after a synchronous method throw', async () => {
        const original = facadeModule.createScheduleEventBackedPlannerRepository, entered = deferred(), release = deferred(), failure = Error('synchronous failure');
        let raw: ReturnType<typeof original> | undefined;
        const spy = vi.spyOn(facadeModule, 'createScheduleEventBackedPlannerRepository').mockImplementation((...args) => { raw = original(...args); raw.getPlans = () => { throw failure; }; raw.getTodos = async () => { entered.resolve(); await release.promise; return []; }; return raw; });
        const repository = createLocalPlannerRepository(new MemoryStorage());
        spy.mockRestore();
        expect(Object.keys(repository).sort()).toEqual(Object.keys(raw!).sort());
        for (const key of Object.keys(raw!) as (keyof typeof repository)[])
            expect(repository[key]).not.toBe(raw![key]);
        const first = repository.getTodos('owner');
        await entered.promise;
        const second = repository.getPlans('owner').catch(error => error), third = repository.getActuals('owner');
        release.resolve();
        await first;
        expect(await second).toBe(failure);
        expect(await third).toEqual([]);
    });
    it('queues a second compound command so its forward snapshot cannot erase a later save', async () => {
        const f = createLocalFixture();
        await f.repository.upsertPlan(plan());
        await f.repository.upsertMonthEvent(event());
        const pause = pauseActualRead(f.gateway), deletion = f.repository.deletePlan('owner', 'plan');
        await pause.entered.promise;
        const newer = f.repository.upsertMonthEvent(event({ title: 'NEWER' }));
        await microtasks();
        pause.release.resolve();
        await deletion;
        await newer;
        expect((await f.repository.getMonthEvents('owner'))[0].title).toBe('NEWER');
    });
});
