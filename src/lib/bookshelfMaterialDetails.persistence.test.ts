import { afterEach, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';
import {
  getDefaultMaterialDetailPreferences,
  loadMaterialDetailPreferences,
  saveMaterialDetailPreferences,
} from './bookshelfMaterialDetails';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const preferences = {
  ...getDefaultMaterialDetailPreferences(),
  structureEnabled: true,
  structureItems: [{ id: 'chapter', title: '保存する章', children: [{ id: 'section', title: '保存する節' }] }],
};

it('acknowledges a completed synchronous write under the existing owner-qualified key', () => {
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  expect(saveMaterialDetailPreferences('owner', 'material', preferences)).toBe(true);
  expect(storage.getItem('studyplanner:material-detail:v1:owner:material')).toBe(JSON.stringify(preferences));
  expect(loadMaterialDetailPreferences('owner', 'material')).toEqual(preferences);
  expect(loadMaterialDetailPreferences('other-owner', 'material')).toEqual(getDefaultMaterialDetailPreferences());
});

it.each(['QuotaExceededError', 'SecurityError'])('reports %s without overwriting previously saved data', errorName => {
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  saveMaterialDetailPreferences('owner', 'material', preferences);
  const before = storage.getItem('studyplanner:material-detail:v1:owner:material');
  vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new DOMException('Unavailable', errorName); });
  expect(saveMaterialDetailPreferences('owner', 'material', { ...preferences, structureItems: [] })).toBe(false);
  expect(storage.getItem('studyplanner:material-detail:v1:owner:material')).toBe(before);
});

it('reports unavailable browser storage instead of acknowledging an unsaved edit', () => {
  vi.stubGlobal('window', {});
  expect(saveMaterialDetailPreferences('owner', 'material', preferences)).toBe(false);
});

it('reports unavailable window without throwing', () => {
  vi.stubGlobal('window', undefined);
  expect(saveMaterialDetailPreferences('owner', 'material', preferences)).toBe(false);
});

it('reports denied storage access even when the localStorage getter itself throws', () => {
  vi.stubGlobal('window', { get localStorage() { throw new DOMException('Denied', 'SecurityError'); } });
  expect(saveMaterialDetailPreferences('owner', 'material', preferences)).toBe(false);
});
