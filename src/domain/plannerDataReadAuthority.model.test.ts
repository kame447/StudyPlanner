import { describe, expect, it } from 'vitest';
import {
  PlannerDataReadAuthority,
  type PlannerDataLoadToken,
  type PlannerRepairTarget,
} from './plannerDataReadAuthority';

// Independent contract vocabulary: importing the production target list would
// let a missing group disappear from both the system and its oracle.
const GROUPS = ['actual-material', 'month-events', 'plans-todos', 'day-notes', 'timetable'] as const;
const targets = (mask: number): PlannerRepairTarget[] => GROUPS.filter((_, bit) => mask & (1 << bit));
function observedMask(values: readonly PlannerRepairTarget[]): number {
  expect(new Set(values).size).toBe(values.length);
  return values.reduce((mask, group) => mask | (1 << GROUPS.indexOf(group)), 0);
}
function ready() {
  const authority = new PlannerDataReadAuthority();
  authority.succeed(authority.begin('A', 'start').token, 'full success');
  return authority;
}

// These are the two demonstrated gaps under #382: a four-group cap and replay
// of a terminal full-read token survived the existing 949 domain/hook tests.
// No repository writes occur here; storage atomicity, save replay, conditional
// Subject reads and coordinator promise scheduling retain their hook tests.
describe('bounded planner read contract model', () => {
  it.each(['pending', 'reading', 'failed'] as const)(
    'retains all 1,024 mask unions from %s through failure, retry and readiness', phase => {
      for (let first = 0; first < 32; first += 1) {
        for (let second = 0; second < 32; second += 1) {
          const context = `${phase}: ${first} | ${second}`;
          const authority = ready();
          const scope = authority.captureOwnerScope()!;
          const revision = authority.captureProjectionLease()!.acceptedRevision;
          expect(authority.requireReconciliation(scope, 'first', targets(first)), context).toBe(first !== 0);
          const old = first && phase !== 'pending' ? authority.beginReconciliation(scope, 'old read') : null;
          if (old && phase === 'failed') authority.failReconciliation(old, 'old failure');
          expect(authority.requireReconciliation(scope, 'second', targets(second)), context).toBe(second !== 0);

          // The reference model is integer set union, independent of the
          // production array filtering, target order, and request counters.
          const expected = first | second;
          if (!expected) {
            expect(authority.beginReconciliation(scope, 'empty'), context).toBeNull();
            expect(authority.read().status, context).toBe('ready');
            continue;
          }
          if (old && second) {
            expect(authority.acceptReconciliation(old, 'superseded'), context).toBe(false);
            expect(authority.failReconciliation(old, 'superseded'), context).toBe(false);
          }
          if (old && !second && phase === 'failed') {
            expect(authority.retryReconciliation(scope, 'retry old'), context).toBe(true);
          }
          const batch = old && !second && phase === 'reading'
            ? old : authority.beginReconciliation(scope, 'union read');
          expect(batch, context).not.toBeNull();
          expect(observedMask(batch!.targets), context).toBe(expected);
          expect(authority.read().status, context).toBe('stale');
          expect(authority.failReconciliation(batch!, 'union failure'), context).toBe(true);
          expect(authority.captureProjectionLease()!.acceptedRevision, context).toBe(revision);
          expect(authority.beginReconciliation(scope, 'ordinary pump'), context).toBeNull();
          expect(authority.retryAction(scope), context).toBe('projection');
          expect(authority.retryReconciliation(scope, 'explicit retry'), context).toBe(true);
          expect(authority.retryReconciliation(scope, 'duplicate retry'), context).toBe(false);
          const retry = authority.beginReconciliation(scope, 'retry read')!;
          expect(observedMask(retry.targets), context).toBe(expected);
          expect(authority.acceptReconciliation(batch!, 'late result'), context).toBe(false);
          expect(authority.acceptReconciliation(retry, 'recovered'), context).toBe(true);
          // Positive progress excludes implementations that reject everything
          // or retain stale forever, even if all their safety checks pass.
          expect(authority.read(), context).toMatchObject({ status: 'ready', lastSuccessfulAt: 'full success' });
          expect(authority.readSnapshot().recovery, context).toBeNull();
        }
      }
    },
  );

  it.each(['completion evidence', 'request during full read'] as const)(
    'covers or retains all 1,024 old/new mask pairs with %s', source => {
      for (let older = 0; older < 32; older += 1) {
        for (let newer = 0; newer < 32; newer += 1) {
          const context = `${source}: ${older}, ${newer}`;
          const authority = ready();
          const scope = authority.captureOwnerScope()!;
          authority.requireReconciliation(scope, 'older', targets(older));
          const full = authority.begin('A', 'covering full');
          if (source === 'request during full read') authority.requireReconciliation(scope, 'newer', targets(newer));
          authority.succeed(full.token, 'new full success', true,
            source === 'completion evidence' ? targets(newer) : []);
          // A stable full read covers pre-existing requests. A new request
          // during collection preserves the outstanding batch as a whole.
          const expected = source === 'completion evidence' ? newer : newer ? older | newer : 0;
          const batch = authority.beginReconciliation(scope, 'after full');
          if (expected) {
            expect(batch, context).not.toBeNull();
            expect(observedMask(batch!.targets), context).toBe(expected);
            expect(authority.read().status, context).toBe('stale');
            expect(authority.acceptReconciliation(batch!, 'settled'), context).toBe(true);
          } else expect(batch, context).toBeNull();
          expect(authority.read(), context).toMatchObject({ status: 'ready', lastSuccessfulAt: 'new full success' });
        }
      }
    },
  );

  it('matches an independent single-use read ledger for every depth-5 history with two owners and two retained tokens', () => {
    type Owner = 'A' | 'B';
    type Entry = { id: number; owner: Owner; incarnation: number };
    type Event = 'A' | 'B' | 'reset' | 'success0' | 'failure0' | 'success1' | 'failure1';
    const alphabet: readonly Event[] = ['A', 'B', 'reset', 'success0', 'failure0', 'success1', 'failure1'];
    const reached = new Set<string>();
    let histories = 0;

    function check(history: readonly Event[]) {
      const authority = new PlannerDataReadAuthority();
      // This oracle is a ledger of open/closed requests, not a translation of
      // generation/epoch checks. Only the most recently opened request can
      // consume one terminal outcome; owner replacement discards the ledger.
      let owner: Owner | null = null;
      let incarnation = 0;
      let open: number | null = null;
      let health: 'idle' | 'reading' | 'ok' | 'failed' = 'idle';
      let fullSuccess: string | null = null;
      let observed: string | null = null;
      let accepted = 0;
      let nextId = 0;
      const entries: Entry[] = [];
      const tokens: PlannerDataLoadToken[] = [];

      history.forEach((event, step) => {
        const stamp = `event ${step}`;
        const context = history.slice(0, step + 1).join(' → ');
        if (event === 'A' || event === 'B') {
          if (owner !== event) {
            incarnation += 1;
            fullSuccess = null;
            accepted = 0;
          }
          owner = event;
          open = ++nextId;
          health = 'reading';
          observed = stamp;
          entries.push({ id: open, owner, incarnation });
          tokens.push(authority.begin(event, stamp).token);
          if (entries.length > 2) { entries.shift(); tokens.shift(); }
        } else if (event === 'reset') {
          incarnation += 1;
          owner = null;
          open = null;
          health = 'idle';
          fullSuccess = null;
          observed = null;
          accepted = 0;
          authority.reset();
        } else {
          const slot = event.endsWith('0') ? 0 : 1;
          const entry = entries[slot];
          if (entry) {
            const admitted = entry.id === open;
            const successful = event.startsWith('success');
            const result = successful ? authority.succeed(tokens[slot], stamp) : authority.fail(tokens[slot], stamp);
            expect(result !== null, context).toBe(admitted);
            if (admitted) {
              open = null;
              health = successful ? 'ok' : 'failed';
              observed = stamp;
              if (successful) { fullSuccess = stamp; accepted += 1; }
            }
          }
        }
        const status = !owner ? 'idle' : health === 'reading' ? 'loading'
          : health === 'ok' ? 'ready' : fullSuccess ? 'stale' : 'unavailable';
        expect(authority.read(), context).toEqual({ status, ownerId: owner, observedAt: observed, lastSuccessfulAt: fullSuccess });
        expect(authority.captureProjectionLease()?.acceptedRevision ?? 0, context).toBe(accepted);
        entries.forEach((entry, slot) => {
          expect(authority.isCurrent(tokens[slot]), context).toBe(entry.id === open);
          expect(authority.isOwnerCurrent(tokens[slot]), context).toBe(owner === entry.owner && incarnation === entry.incarnation);
        });
        reached.add(JSON.stringify([owner, health, fullSuccess !== null,
          entries.map(entry => [entry.owner, entry.incarnation === incarnation, entry.id === open])]));
      });
      // Every finite prefix can make progress when a fresh current read arrives.
      const recovery = authority.begin(owner ?? 'A', 'drain start');
      expect(authority.succeed(recovery.token, 'drain success')).toMatchObject({ status: 'ready' });
      expect(authority.readSnapshot().recovery).toBeNull();
      histories += 1;
    }
    function explore(prefix: readonly Event[]) {
      if (prefix.length === 5) { check(prefix); return; }
      for (const event of alphabet) explore([...prefix, event]);
    }
    explore([]);
    expect(histories).toBe(16_807); // 7^5, every shorter prefix is also checked.
    // Guards against a degenerate exploration; the shape count comes from the ledger alone.
    expect(reached.size).toBe(35);
  });
});
