import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeMissingSavedBlocks } from '../e2e/support/saved-block-diagnosis.mjs';

const counts = (overrides = {}) => ({ saved: 0, drafts: 2, otherSaved: 3, visible: 2, ...overrides });

describe('saved-block diagnosis for the live smoke flow 3', () => {
  it('reports the day, the counts now and the counts after one reload, and nothing else', async () => {
    const reads = [counts(), counts({ saved: 2, drafts: 0 })];
    let reloads = 0;
    const text = await describeMissingSavedBlocks({
      date: '2026-11-11',
      read: async () => reads.shift()!,
      reloadAndOpenDay: async () => { reloads += 1; },
    });
    expect(text).toBe('day 2026-11-11; now: saved=0 drafts=2 otherSaved=3 visible=2; after one reload: saved=2 drafts=0 otherSaved=3 visible=2');
    expect(reloads).toBe(1);
  });

  it('keeps going when the counts or the reload cannot be read, and never throws', async () => {
    const unreadable = await describeMissingSavedBlocks({ date: '2026-11-11', read: async () => { throw new Error('page closed'); },
      reloadAndOpenDay: async () => undefined });
    expect(unreadable).toBe('day 2026-11-11; now: unreadable; after one reload: could not be read');
    let calls = 0;
    const reloadFails = await describeMissingSavedBlocks({ date: '2026-11-11', read: async () => { calls += 1; return counts(); },
      reloadAndOpenDay: async () => { throw new Error('signed out'); } });
    expect(reloadFails).toBe('day 2026-11-11; now: saved=0 drafts=2 otherSaved=3 visible=2; after one reload: could not be read');
    expect(calls).toBe(1);
  });

  it('puts no error text, title or id into the message: only the date and numbers', async () => {
    const text = await describeMissingSavedBlocks({ date: '2026-11-11', read: async () => counts(),
      reloadAndOpenDay: async () => { throw new Error('E2E-123-読書 secret-id'); } });
    expect(text).not.toMatch(/E2E|読書|secret/u);
  });

  it('leaves the flow check as it was: same wait, same message, same final assert, and the diagnosis only on failure', () => {
    const source = readFileSync(new URL('../e2e/support/vnext-production-flows.mjs', import.meta.url), 'utf8');
    const message = 'the corrected plan must be visible as saved blocks, not only a draft';
    expect(source).toContain(`{ message, timeout: 30_000 }).toBeGreaterThan(0)`);
    expect(source).toContain(`const message = '${message}';`);
    expect(source).toContain('throw new Error(`${message} (${diagnosis})`, { cause: error });');
    expect(source).toContain(`expect(savedBlocks, '${message}').toBeGreaterThan(0);`);
    expect(source.match(/await expectSavedBlocksShown\(page, title, target\);/gu)).toHaveLength(1);
  });
});
