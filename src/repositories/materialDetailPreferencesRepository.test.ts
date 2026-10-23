import { afterEach, expect, it, vi } from 'vitest';
import { MemoryStorage } from './localPersistenceConcurrency.testUtils';
import { loadMaterialDetailPreferences, saveMaterialDetailPreferences } from './materialDetailPreferencesRepository';
import { getDefaultMaterialDetailPreferences } from '../lib/bookshelfMaterialDetails';

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


it('preserves unavailable and malformed read defaults without writing replacements', () => {
  vi.stubGlobal('window', undefined);
  expect(loadMaterialDetailPreferences('owner', 'material')).toEqual(getDefaultMaterialDetailPreferences());
  vi.stubGlobal('window', {});
  expect(loadMaterialDetailPreferences('owner', 'material')).toEqual(getDefaultMaterialDetailPreferences());
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  for (const raw of ['not-json', 'null', '{}', '42']) {
    storage.setItem('studyplanner:material-detail:v1:owner:material', raw);
    expect(loadMaterialDetailPreferences('owner', 'material')).toEqual(getDefaultMaterialDetailPreferences());
    expect(storage.getItem('studyplanner:material-detail:v1:owner:material')).toBe(raw);
  }
});

it('preserves recursive persisted normalization and does not mutate stored bytes', () => {
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  const raw = JSON.stringify({ structureEnabled: true, structureVisible: false, favorite: true,
    structureItems: [null, { id: ' ', title: 'invalid' }, { id: ' chapter ', title: ' Chapter ', startUnit: 0,
      endUnit: '20', progressRate: 120, children: [{ id: 'section', title: ' Section ', endUnit: 10 }, { id: 'bad', title: ' ' }] }] });
  storage.setItem('studyplanner:material-detail:v1:owner:material', raw);
  expect(loadMaterialDetailPreferences('owner', 'material')).toEqual({ structureEnabled: true,
    structureVisible: false, favorite: true, structureItems: [{ id: 'chapter', title: 'Chapter', startUnit: 0,
      progressRate: 120, children: [{ id: 'section', title: 'Section', endUnit: 10 }] }] });
  expect(storage.getItem('studyplanner:material-detail:v1:owner:material')).toBe(raw);
});

it('characterizes read denial at the storage getter separately from read-operation failure', () => {
  const denied = new DOMException('Denied', 'SecurityError');
  vi.stubGlobal('window', { get localStorage() { throw denied; } });
  expect(() => loadMaterialDetailPreferences('owner', 'material')).toThrow(denied);
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  vi.spyOn(storage, 'getItem').mockImplementation(() => { throw denied; });
  expect(loadMaterialDetailPreferences('owner', 'material')).toEqual(getDefaultMaterialDetailPreferences());
});
