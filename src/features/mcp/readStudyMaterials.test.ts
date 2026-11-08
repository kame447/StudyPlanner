import { describe, expect, it, vi } from 'vitest';
import type { StudyMaterial } from '../../types/domain';
import { STUDY_MATERIAL_PORT_ROW_LIMIT, StudyMaterialReadError, createLearningProgressReader, createStudyMaterialLister,
  type StudyMaterialReadPort } from './readStudyMaterials';

const OWNER = 'owner-a';
const stamp = '2026-11-01T00:00:00.000Z';
const material = (changes: Partial<StudyMaterial> = {}): StudyMaterial => ({ id: 'm1', userId: OWNER, name: '青チャート', subjectId: 'math',
  subjectName: '数学', createdAt: stamp, updatedAt: stamp, ...changes });
// Every field the readers must never return, set to a recognisable value.
const sensitive = { color: '#123456', coverImageUrl: 'https://img.example/cover', coverImageDataUrl: 'data:image/png;base64,AAAA',
  catalogEntryId: 'cat-1', catalogTitle: 'catalog title', catalogIsbn10: '4010101010', catalogIsbn13: '9784010101010', aliases: ['alias-x'],
  estimatedMinutesPerUnit: 7777, maxUnitsPerDay: 9999 };
const paced = (changes: Partial<StudyMaterial> = {}) => material({ paceEnabled: true, progressUnit: 'page', progressUnitLabel: 'ページ',
  currentUnit: 30, totalUnits: 300, targetDate: '2026-12-31', ...changes });

function port(rows: StudyMaterial[] | Error = [material()]) {
  const listMaterialsByOwner = vi.fn(async (_ownerId: string): Promise<StudyMaterial[]> => { if (rows instanceof Error) throw rows; return rows; });
  return { listMaterialsByOwner } satisfies StudyMaterialReadPort;
}
const lister = (rows?: StudyMaterial[] | Error) => { const p = port(rows); return { p, run: createStudyMaterialLister({ ownerId: OWNER, port: p }) }; };
const progress = (rows?: StudyMaterial[] | Error) => { const p = port(rows); return { p, run: createLearningProgressReader({ ownerId: OWNER, port: p }) }; };
const code = async (run: Promise<unknown>) => run.then(() => 'resolved', (error: unknown) => (error instanceof StudyMaterialReadError ? error.code : 'other'));

describe.each([
  ['get_study_materials reader', (rows?: StudyMaterial[] | Error) => lister(rows)],
  ['get_learning_progress reader', (rows?: StudyMaterial[] | Error) => progress(rows)],
])('%s: owner boundary, limit and input', (_name, build) => {
  it('refuses a different or empty actor before the port is called', async () => {
    const h = build();
    expect(await code(h.run('owner-b', {}))).toBe('owner_mismatch');
    expect(await code(h.run('', {}))).toBe('owner_mismatch');
    expect(h.p.listMaterialsByOwner).not.toHaveBeenCalled();
  });
  it('takes no arguments: anything but an empty object is invalid_input, before the port is called', async () => {
    const h = build();
    for (const input of [null, undefined, [], 'x', 1, { ownerId: 'owner-b' }, { limit: 5 }]) expect(await code(h.run(OWNER, input))).toBe('invalid_input');
    expect(h.p.listMaterialsByOwner).not.toHaveBeenCalled();
  });
  it('queries the port for the actor only, once', async () => {
    const h = build();
    await h.run(OWNER, {});
    expect(h.p.listMaterialsByOwner).toHaveBeenCalledOnce();
    expect(h.p.listMaterialsByOwner).toHaveBeenCalledWith(OWNER);
  });
  it('rejects the whole result when one row belongs to another owner, instead of returning the rest', async () => {
    const h = build([material({ id: 'a' }), material({ id: 'b', userId: 'owner-b' }), material({ id: 'c' })]);
    expect(await code(h.run(OWNER, {}))).toBe('owner_mismatch');
  });
  it('fails closed when the port fails, and tells an empty result apart from a failure', async () => {
    expect(await code(build(new Error('network')).run(OWNER, {}))).toBe('source_unavailable');
    const empty = await build([]).run(OWNER, {});
    expect(empty).toEqual({ materials: [] });
  });
  it('accepts one row under the port limit and refuses a result of exactly the limit (it may be cut off)', async () => {
    const rows = (count: number) => Array.from({ length: count }, (_, index) => paced({ id: `m${String(index).padStart(4, '0')}` }));
    expect(await code(build(rows(STUDY_MATERIAL_PORT_ROW_LIMIT - 1)).run(OWNER, {}))).toBe('resolved');
    expect(await code(build(rows(STUDY_MATERIAL_PORT_ROW_LIMIT)).run(OWNER, {}))).toBe('source_unavailable');
  });
  it('checks the limit before ownership, as the todo reader does, so a full page is never read as complete', async () => {
    const rows = Array.from({ length: STUDY_MATERIAL_PORT_ROW_LIMIT }, (_, index) => material({ id: `m${index}`, userId: index === 0 ? 'owner-b' : OWNER }));
    expect(await code(build(rows).run(OWNER, {}))).toBe('source_unavailable');
  });
  it('puts nothing but the code into the error message', async () => {
    const h = build(new Error('secret-token https://firestore.example/owner-a'));
    const error = await h.run(OWNER, {}).catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(StudyMaterialReadError);
    expect((error as Error).message).toBe('source_unavailable');
  });
});

describe('get_study_materials reader: result', () => {
  it('returns the minimal fields, with the stored defaults for a missing status', async () => {
    const h = lister([material({ ...sensitive, name: 'B' }), material({ id: 'm2', name: 'A', subjectName: '英語', status: 'archived', studyStatus: 'completed' })]);
    const result = await h.run(OWNER, {});
    expect(result.materials).toEqual([
      { id: 'm2', name: 'A', subjectName: '英語', status: 'archived', studyStatus: 'completed' },
      { id: 'm1', name: 'B', subjectName: '数学', status: 'active', studyStatus: 'studying' },
    ]);
  });
  it('never returns images, catalog data, aliases, colour, owner id, timestamps or pace tuning', async () => {
    const text = JSON.stringify(await lister([paced({ ...sensitive })]).run(OWNER, {}));
    for (const value of [...Object.values(sensitive).flat(), OWNER, stamp]) expect(text).not.toContain(String(value));
    expect(Object.keys((await lister([paced({ ...sensitive })]).run(OWNER, {})).materials[0]).sort())
      .toEqual(['id', 'name', 'status', 'studyStatus', 'subjectName']);
  });
  it('orders by name then id, whatever the order the port returned', async () => {
    const result = await lister([material({ id: 'z', name: 'B' }), material({ id: 'b', name: 'A' }), material({ id: 'a', name: 'A' })]).run(OWNER, {});
    expect(result.materials.map(item => item.id)).toEqual(['a', 'b', 'z']);
  });
  it('does not mutate the rows the port returned', async () => {
    const rows = [material({ id: 'z', name: 'B' }), material({ id: 'a', name: 'A' })];
    await lister(rows).run(OWNER, {});
    expect(rows.map(row => row.id)).toEqual(['z', 'a']);
  });
});

describe('get_learning_progress reader: result', () => {
  it('returns progress only for materials with pace enabled, with the progress fields only', async () => {
    const h = progress([paced({ id: 'p1', name: '青チャート', ...sensitive }), material({ id: 'n1', name: '英単語', paceEnabled: false, currentUnit: 5 }), material({ id: 'n2', name: '国語' })]);
    expect(await h.run(OWNER, {})).toEqual({ materials: [{ id: 'p1', name: '青チャート', progressUnit: 'page', progressUnitLabel: 'ページ',
      currentUnit: 30, totalUnits: 300, targetDate: '2026-12-31' }] });
  });
  it('reports a missing progress field as null, never as 0 or an invented value', async () => {
    const result = await progress([material({ id: 'p', paceEnabled: true })]).run(OWNER, {});
    expect(result.materials).toEqual([{ id: 'p', name: '青チャート', progressUnit: null, progressUnitLabel: null, currentUnit: null, totalUnits: null, targetDate: null }]);
  });
  it('leaves archived materials out even when their pace is enabled, and keeps an active one with no status set', async () => {
    const result = await progress([paced({ id: 'old', status: 'archived' }), paced({ id: 'new', status: 'active' }), paced({ id: 'bare' })]).run(OWNER, {});
    expect(result.materials.map(item => item.id)).toEqual(['bare', 'new']);
  });
  it('keeps a current unit of 0 as 0', async () => {
    const result = await progress([paced({ currentUnit: 0 })]).run(OWNER, {});
    expect(result.materials[0].currentUnit).toBe(0);
  });
  it('never returns images, catalog data, aliases, colour, owner id, timestamps or pace tuning', async () => {
    const text = JSON.stringify(await progress([paced({ ...sensitive })]).run(OWNER, {}));
    for (const value of [...Object.values(sensitive).flat(), OWNER, stamp, '数学']) expect(text).not.toContain(String(value));
  });
  it('returns an empty list, not an error, when no material has pace enabled', async () => {
    expect(await progress([material()]).run(OWNER, {})).toEqual({ materials: [] });
  });
});
