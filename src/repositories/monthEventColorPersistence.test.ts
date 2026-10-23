import { describe, expect, it } from 'vitest';
import { createMonthEventDraftFromEvent, createMonthEventFromDraft } from '../domain/planner';
import { buildRecurringMonthEventEdit, createMonthEventOccurrenceDraft } from '../domain/recurringMonthEvent';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import { getScheduleOccurrenceColor } from '../lib/scheduleEventColor';
import { createLocalPlannerRepository } from './createLocalPlannerRepository';
import { createLocalPlannerStorageGateway } from './localStorageGateway';
import { createPlannerRepository } from './plannerRepository';
import { MemoryStorage, event } from './localPersistenceConcurrency.testUtils';

for (const mode of ['canonical', 'legacy'] as const) {
  const createRepository = (storage: Storage) => mode === 'canonical'
    ? createLocalPlannerRepository(storage) : createPlannerRepository(createLocalPlannerStorageGateway(storage));
  describe(`${mode} month event colors`, () => {
    it('round trips selected color, draft cloning and returning to automatic through storage', async () => {
      const storage = new MemoryStorage();
      const source = event({ color: 'purple' });
      await createRepository(storage).upsertMonthEvent(source);
      const [loaded] = await createRepository(storage).getMonthEvents('owner');
      expect(loaded.color).toBe('purple');
      const cloned = createMonthEventFromDraft(createMonthEventDraftFromEvent(loaded));
      expect(cloned.color).toBe('purple');
      expect(cloned.id).not.toBe(loaded.id);
      const changed = createMonthEventFromDraft({ ...createMonthEventDraftFromEvent(loaded), color: 'pink' }, loaded);
      await createRepository(storage).upsertMonthEvent(changed);
      expect((await createRepository(storage).getMonthEvents('owner'))[0].color).toBe('pink');
      await createRepository(storage).upsertMonthEvent(createMonthEventFromDraft({ ...createMonthEventDraftFromEvent(changed), color: undefined }, changed));
      expect((await createRepository(storage).getMonthEvents('owner'))[0].color).toBeUndefined();
    });

    it.each(['single', 'future'] as const)('saves and projects the selected %s recurrence color without recoloring prior dates', async scope => {
      const storage = new MemoryStorage();
      const repository = createRepository(storage);
      const source = event({ repeat: 'weekly', color: 'purple' });
      await repository.upsertMonthEvent(source);
      const draft = { ...createMonthEventOccurrenceDraft(source, '2026-10-11'), color: 'pink' as const };
      const edit = buildRecurringMonthEventEdit(source, draft, '2026-10-11', scope);
      await repository.applyRecurringMonthEventMutation('owner', edit.monthEvents);
      const loaded = await createRepository(storage).getMonthEvents('owner');
      const { occurrences } = createScheduleOccurrenceProjection({ ownerId: 'owner', startDate: '2026-10-04', endDate: '2026-10-18', plans: [], monthEvents: loaded });
      expect(occurrences.map(occurrence => [occurrence.start.date, getScheduleOccurrenceColor(occurrence)])).toEqual([
        ['2026-10-04', '#a787ef'], ['2026-10-11', '#ef7b9f'], ['2026-10-18', scope === 'single' ? '#a787ef' : '#ef7b9f'],
      ]);
    });

    it('preserves existing colorless records on read and edit', async () => {
      const storage = new MemoryStorage();
      await createRepository(storage).upsertMonthEvent(event());
      const [loaded] = await createRepository(storage).getMonthEvents('owner');
      expect(loaded).not.toHaveProperty('color');
      expect(createMonthEventFromDraft(createMonthEventDraftFromEvent(loaded), loaded)).not.toHaveProperty('color');
    });
  });
}

it('preserves named color when the existing local legacy migration imports an event', async () => {
  const storage = new MemoryStorage();
  await createLocalPlannerStorageGateway(storage).writeMonthEvents([event({ color: 'blue' })]);
  const [loaded] = await createLocalPlannerRepository(storage).getMonthEvents('owner');
  expect(loaded.color).toBe('blue');
  const canonical = JSON.parse(storage.getItem('studyplanner.scheduleEvents.v1')!);
  expect(canonical[0].general.color).toBe('blue');
});
