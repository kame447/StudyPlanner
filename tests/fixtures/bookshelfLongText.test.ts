import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalPlannerRepository } from '../../src/repositories/createLocalPlannerRepository';
import { MemoryStorage } from '../../src/repositories/localPersistenceConcurrency.testUtils';

// Exercise the actual browser init callback, without importing/running an E2E suite.
const spec = ts.createSourceFile('bookshelf-surface.spec.mjs', readFileSync(
  new URL('../e2e/bookshelf-surface.spec.mjs', import.meta.url), 'utf8',
), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const seedFunction = spec.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'seedBookshelf');
let seedCallback = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(spec) === 'page.addInitScript') {
    seedCallback = node.arguments[0].getText(spec);
  }
  ts.forEachChild(node, visit);
}
if (!seedFunction) throw new Error('Missing browser fixture');
visit(seedFunction);
if (!seedCallback) throw new Error('Missing browser init callback');

const owner = 'bookshelf-e2e-user';
const preferenceKey = `studyplanner:material-detail:v1:${owner}:bookshelf-e2e-material`;
const longText = {
  name: 'MATERIALTOKEN'.repeat(20), subject: 'SUBJECTTOKEN'.repeat(14), activity: 'ACTIVITYTOKEN'.repeat(20),
};
function seed(storage: Storage, values: typeof longText | null = null) {
  runInNewContext(`(${seedCallback})`, { localStorage: storage, Date })(values);
}
function read(storage: Storage, key: string) { return JSON.parse(storage.getItem(key) ?? 'null'); }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-19T01:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('bookshelf long-text browser fixture', () => {
  it('retains the ordinary short fixture for existing callers', () => {
    const storage = new MemoryStorage(); seed(storage);
    expect(read(storage, 'studyplanner.studyMaterials.v1').map((item: { name: string }) => item.name))
      .toEqual(['アルゴリズム問題集', 'ネットワーク演習']);
    expect(read(storage, preferenceKey).structureItems).toHaveLength(2);
    expect(storage.getItem('study-planner-appearance')).toBeNull();
    expect(storage.getItem('studyplanner.scheduleEvents.v1')).toBeNull();
  });

  it('lets the real first migration create the long owned plan and provenance', async () => {
    const storage = new MemoryStorage(); seed(storage, longText);
    expect(storage.getItem('studyplanner.scheduleEvents.v1')).toBeNull();
    expect(storage.getItem('studyplanner.scheduleEventMigrations.v1')).toBeNull();
    const repository = createLocalPlannerRepository(storage);
    expect(await repository.getPlans(owner)).toEqual([expect.objectContaining({
      id: 'bookshelf-e2e-plan', userId: owner,
      title: longText.activity, subject: longText.subject, materialName: longText.name,
    })]);
    expect(read(storage, 'studyplanner.scheduleEvents.v1')).toEqual([expect.objectContaining({
      userId: owner, title: longText.activity,
      provenance: expect.objectContaining({ legacy: { kind: 'plan', id: 'bookshelf-e2e-plan' } }),
    })]);
    expect(read(storage, 'studyplanner.scheduleEventMigrations.v1')).toHaveLength(1);
    expect(await repository.getStudyMaterials(owner)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bookshelf-e2e-material', name: longText.name, subjectName: longText.subject }),
    ]));
    const actuals = await repository.getActuals(owner);
    expect(actuals[0]).toMatchObject({ note: longText.activity, materialName: longText.name });
    expect(actuals[0].materialProgressUpdates).toBeUndefined();
    const chapters = read(storage, preferenceKey).structureItems;
    expect(chapters).toHaveLength(24);
    expect(chapters[23]).toEqual({ id: 'long-23', title: `${longText.name}24`, startUnit: 184, endUnit: 192 });
  });

  it('does not reseed saved chapter values during the real reload path', () => {
    const storage = new MemoryStorage(); seed(storage, longText);
    const preferences = read(storage, preferenceKey);
    preferences.structureItems.at(-1).title = '保存した章 200';
    storage.setItem(preferenceKey, JSON.stringify(preferences));
    seed(storage, longText);
    expect(read(storage, preferenceKey)).toEqual(preferences);
  });

  it('preserves unrelated canonical ownership and migration receipts', async () => {
    const storage = new MemoryStorage(); seed(storage, longText);
    const foreign = { id: 'foreign-event', userId: 'other', title: 'untouched' };
    const receipt = { userId: 'other', marker: 'untouched' };
    storage.setItem('studyplanner.scheduleEvents.v1', JSON.stringify([foreign]));
    storage.setItem('studyplanner.scheduleEventMigrations.v1', JSON.stringify([receipt]));
    await createLocalPlannerRepository(storage).getPlans(owner);
    expect(read(storage, 'studyplanner.scheduleEvents.v1')).toContainEqual(foreign);
    expect(read(storage, 'studyplanner.scheduleEventMigrations.v1')).toContainEqual(receipt);
  });
});
