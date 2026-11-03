// @ts-expect-error The e2e support module is plain ESM without declarations.
import { cancellationCommitProblems, createWriteLedger, protectedWritesIn } from '../../../../../tests/e2e/support/vnext-firestore-writes.mjs';
import { describe, expect, it } from 'vitest';

const DOC = 'projects/p/databases/(default)/documents';
const commit = (host: string, collection: string) => ({
  url: `${host}/v1/projects/p/databases/(default)/documents:commit`,
  method: 'POST',
  postData: JSON.stringify({ writes: [{ update: { name: `${DOC}/${collection}/doc1`, fields: {} } }] }),
});
type Op = { update?: string; delete?: string; verify?: string };
const batch = (host: string, ops: Op[]) => ({
  url: `${host}/v1/projects/p/databases/(default)/documents:commit`,
  method: 'POST',
  postData: JSON.stringify({ writes: ops.map(op => op.update ? { update: { name: `${DOC}/${op.update}`, fields: {} } }
    : op.delete ? { delete: `${DOC}/${op.delete}` } : { verify: `${DOC}/${op.verify}`, currentDocument: { exists: false } }) }),
});
const PRODUCTION = 'https://firestore.googleapis.com';
const EMULATOR = 'http://127.0.0.1:8180';

describe('phase-scoped Firestore write ledger', () => {
  it.each([PRODUCTION, EMULATOR])('an approved save in its own phase is seen and is not a violation (%s)', async host => {
    const ledger = createWriteLedger();
    await ledger.during('save', async () => { ledger.record(commit(host, 'plans')); });
    expect(protectedWritesIn(ledger.inPhase('save'))).toHaveLength(1);
    expect(ledger.violations()).toEqual([]);
  });

  it.each([PRODUCTION, EMULATOR])('the same write outside an authorized phase is a violation (%s)', host => {
    const ledger = createWriteLedger();
    ledger.record(commit(host, 'schedule_events'));
    expect(ledger.violations()).toHaveLength(1);
  });

  it('the no-write phase is restored after an authorized phase, even when it throws', async () => {
    const ledger = createWriteLedger();
    await expect(ledger.during('cleanup', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    ledger.record(commit(PRODUCTION, 'plans'));
    expect(ledger.violations()).toHaveLength(1);
  });

  it('profile writes and unrelated local requests are not violations', () => {
    const ledger = createWriteLedger();
    ledger.record(commit(PRODUCTION, 'profiles'));
    ledger.record({ url: 'http://127.0.0.1:18788/weekly-planning/turns', method: 'POST', postData: '{}' });
    expect(ledger.violations()).toEqual([]);
  });

  it('a write in a later no-write phase is caught after an authorized one', async () => {
    const ledger = createWriteLedger();
    await ledger.during('save', async () => { ledger.record(commit(EMULATOR, 'plans')); });
    ledger.record(commit(EMULATOR, 'plans'));
    expect(ledger.violations()).toHaveLength(1);
    expect(ledger.violations()[0].phase).toBe('none');
  });

  describe.each([PRODUCTION, EMULATOR])('exact allow-lists of the authorized phases (%s)', host => {
    const during = async (phase: string, request: ReturnType<typeof batch>) => {
      const ledger = createWriteLedger();
      await ledger.during(phase, async () => { ledger.record(request); });
      return ledger;
    };

    it('the approval transaction (operation, item, plan, migration read) is allowed in save', async () => {
      const ledger = await during('save', batch(host, [
        { update: 'weekly_planning_approval_operations/op1' },
        { update: 'weekly_planning_approval_operations/op1/weekly_planning_approval_items/i1' },
        { update: 'schedule_events/e1' },
        { verify: 'schedule_event_migrations/u1' },
      ]));
      expect(ledger.inPhase('save')).toHaveLength(1);
      expect(ledger.violations()).toEqual([]);
    });

    it('the occurrence cancellation (one update of the plan) is allowed in cleanup and in sweep, canonical and legacy', async () => {
      for (const phase of ['cleanup', 'sweep']) {
        for (const collection of ['schedule_events', 'plans']) {
          const ledger = await during(phase, batch(host, [{ update: `${collection}/e1` }]));
          expect(ledger.violations()).toEqual([]);
          expect(cancellationCommitProblems(ledger.commitsIn(phase), 1)).toEqual([]);
        }
      }
    });

    it('a delete, an actuals write, a todos write or a migration write in cleanup or sweep is a violation', async () => {
      for (const phase of ['cleanup', 'sweep']) {
        for (const op of [{ delete: 'schedule_events/e1' }, { delete: 'plans/e1' }, { update: 'actuals/a1' }, { delete: 'actuals/a1' },
          { update: 'todos/t1' }, { update: 'schedule_event_migrations/u1' }, { update: 'study_subjects/s1' }]) {
          expect((await during(phase, batch(host, [op]))).violations()).toHaveLength(1);
        }
      }
    });

    it('the cancellation commit count must equal the removed count, with one operation per commit', async () => {
      const ledger = createWriteLedger();
      await ledger.during('sweep', async () => {
        ledger.record(batch(host, [{ update: 'schedule_events/e1' }]));
        ledger.record(batch(host, [{ update: 'schedule_events/e2' }]));
      });
      expect(cancellationCommitProblems(ledger.commitsIn('sweep'), 2)).toEqual([]);
      expect(cancellationCommitProblems(ledger.commitsIn('sweep'), 1)).toHaveLength(1);
      expect(cancellationCommitProblems(ledger.commitsIn('sweep'), 3)).toHaveLength(1);
      const two = await during('cleanup', batch(host, [{ update: 'schedule_events/e1' }, { update: 'plans/e2' }]));
      expect(two.violations()).toEqual([]);
      expect(cancellationCommitProblems(two.commitsIn('cleanup'), 1)).toHaveLength(1);
    });

    it('an unrelated collection written in save is a violation', async () => {
      expect((await during('save', batch(host, [{ update: 'schedule_events/e1' }, { update: 'todos/t1' }]))).violations()).toHaveLength(1);
    });

    it('a delete in save is a violation', async () => {
      expect((await during('save', batch(host, [{ update: 'schedule_events/e1' }, { delete: 'schedule_events/e2' }]))).violations()).toHaveLength(1);
    });

    it('an update paired with a todos write in one cancellation commit is a violation', async () => {
      for (const phase of ['cleanup', 'sweep']) {
        expect((await during(phase, batch(host, [{ update: 'schedule_events/e1' }, { update: 'todos/t1' }]))).violations()).toHaveLength(1);
      }
    });

    it('the migration collection may only be read, never written, in save', async () => {
      expect((await during('save', batch(host, [{ update: 'schedule_event_migrations/u1' }]))).violations()).toHaveLength(1);
    });

    it('same commit: UPDATE schedule_event_migrations + VERIFY schedule_event_migrations is a violation in save', async () => {
      expect((await during('save', batch(host, [{ update: 'schedule_event_migrations/u1' }, { verify: 'schedule_event_migrations/u1' }]))).violations()).toHaveLength(1);
    });

    it('same commit: UPDATE plans + UPDATE todos is a violation in cleanup', async () => {
      expect((await during('cleanup', batch(host, [{ update: 'plans/p1' }, { update: 'todos/t1' }]))).violations()).toHaveLength(1);
    });

    it('a verify of another collection, and a delete paired with an allowed update, are violations in save', async () => {
      expect((await during('save', batch(host, [{ update: 'schedule_events/e1' }, { verify: 'todos/t1' }]))).violations()).toHaveLength(1);
      expect((await during('save', batch(host, [{ update: 'plans/p1' }, { delete: 'plans/p2' }]))).violations()).toHaveLength(1);
    });

    it('a profile write is tolerated in an authorized phase', async () => {
      expect((await during('save', batch(host, [{ update: 'profiles/u1' }]))).violations()).toEqual([]);
    });

    it('an unclassified write in any authorized phase is a violation', async () => {
      for (const phase of ['save', 'sweep', 'cleanup']) {
        const ledger = await during(phase, { url: `${host}/v1/projects/p/databases/(default)/documents:commit`, method: 'POST', postData: 'not json' });
        expect(ledger.violations()).toHaveLength(1);
      }
    });
  });
});
