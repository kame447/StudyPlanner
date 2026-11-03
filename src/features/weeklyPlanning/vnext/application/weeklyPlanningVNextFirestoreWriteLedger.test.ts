// @ts-expect-error The e2e support module is plain ESM without declarations.
import { createWriteLedger, protectedWritesIn } from '../../../../../tests/e2e/support/vnext-firestore-writes.mjs';
import { describe, expect, it } from 'vitest';

const DOC = 'projects/p/databases/(default)/documents';
const commit = (host: string, collection: string) => ({
  url: `${host}/v1/projects/p/databases/(default)/documents:commit`,
  method: 'POST',
  postData: JSON.stringify({ writes: [{ update: { name: `${DOC}/${collection}/doc1`, fields: {} } }] }),
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
});
