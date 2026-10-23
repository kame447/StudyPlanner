import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookshelfView } from './BookshelfView';
import { BookshelfMaterialDetail } from './BookshelfMaterialDetail';
import { MaterialContentsPhotoImport } from './MaterialContentsPhotoImport';
import { getDefaultMaterialDetailPreferences, loadMaterialDetailPreferences, saveMaterialDetailPreferences, type MaterialStructureItem } from '../lib/bookshelfMaterialDetails';
import * as id from '../lib/id';
import { materialContentsToStructure } from '../lib/materialContentsPhoto';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';
import type { StudyMaterial } from '../types/domain';

const material: StudyMaterial = { id: 'm', userId: 'u', name: '教材', subjectId: 'math', subjectName: '数学', createdAt: '', updatedAt: '', progressUnit: 'page' };
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'object' ? text(child) : String(child)).join(''); }
function click(label: string) { act(() => renderer.root.findAllByType('button').find(node => text(node) === label)!.props.onClick()); }
function title(position: string) { return renderer.root.findAllByType('label').find(node => text(node) === `章・節の名前 ${position}`)!.findByType('input'); }
function fillTitle(position: string, value: string) { act(() => title(position).props.onChange({ target: { value } })); }
function fillField(label: string, value: string) { act(() => renderer.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } })); }
function remove(label: string) { act(() => renderer.root.findByProps({ 'aria-label': `${label}を削除` }).props.onClick()); }
function openEditor() { act(() => renderer.root.findByType(BookshelfMaterialDetail).props.onEditStructure()); }
function mount() {
  act(() => { renderer = create(<BookshelfView userId="u" subjects={[]} materials={[material]} plans={[]} actuals={[]} onSaveSubject={vi.fn()} onDeleteSubject={vi.fn()} onCaptureMaterialBaseline={vi.fn()} onSaveMaterial={vi.fn()} onDeleteMaterial={vi.fn()} onAddMaterialToPlan={vi.fn()} />); });
  act(() => renderer.root.findAllByProps({ 'aria-label': '教材を開く' })[0].props.onClick({ stopPropagation() {} }));
  openEditor();
}
function setup(items?: MaterialStructureItem[]) {
  const storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('window', { localStorage: storage });
  if (items) saveMaterialDetailPreferences('u', 'm', { ...getDefaultMaterialDetailPreferences(), structureEnabled: true, structureItems: items });
  mount();
}
const photographed = () => materialContentsToStructure([
  { level: 1, title: '第1章', startPage: 1, endPage: 20 },
  { level: 2, title: '第1節', startPage: 2, endPage: 10 },
  { level: 3, title: '第1小節', startPage: 3, endPage: 5 },
  { level: 2, title: '第2節', startPage: 11, endPage: 20 },
  { level: 1, title: '第2章', startPage: 21, endPage: null },
]);

describe('nested material contents editing', () => {
  it('reopens, edits and reloads photographed sections/subsections without changing IDs or siblings', () => {
    setup(); const items = photographed();
    act(() => renderer.root.findByType(MaterialContentsPhotoImport).props.onApply(items));
    click('保存');
    expect(loadMaterialDetailPreferences('u', 'm').structureItems).toEqual(items);
    expect(text(renderer.root.findByType(BookshelfMaterialDetail))).toContain('第1小節');
    openEditor();
    expect(title('1-1-1').props.value).toBe('第1小節');
    fillTitle('1-1', '  修正した節  '); fillTitle('1-1-1', '修正した小節');
    fillField('開始（ページ） 1-1-1', '4'); fillField('終了（ページ） 1-1-1', '6');
    fillField('進捗（%・任意） 1-1-1', '25'); click('保存');
    act(() => renderer.unmount()); mount();
    expect(title('1-1').props.value).toBe('修正した節');
    expect(title('1-1-1').props.value).toBe('修正した小節');
    const saved = loadMaterialDetailPreferences('u', 'm').structureItems;
    expect(saved[0].children![0].children![0]).toMatchObject({ id: items[0].children![0].children![0].id, startUnit: 4, endUnit: 6, progressRate: 25 });
    expect(saved[0].children![1]).toEqual(items[0].children![1]); expect(saved[1]).toEqual(items[1]);
  });
  it('keeps saved descendants unchanged on cancel and removes only the chosen subtree on save', () => {
    const items = photographed(); setup(items);
    fillTitle('1-1-1', '未保存'); remove('第1節'); click('キャンセル'); openEditor();
    expect(title('1-1-1').props.value).toBe('第1小節');
    expect(loadMaterialDetailPreferences('u', 'm').structureItems).toEqual(items);
    remove('第1節'); click('保存'); openEditor();
    expect(title('1-1').props.value).toBe('第2節'); expect(title('2').props.value).toBe('第2章');
    expect(loadMaterialDetailPreferences('u', 'm').structureItems[0].children).toEqual([items[0].children![1]]);
    remove('第1章'); click('保存');
    expect(loadMaterialDetailPreferences('u', 'm').structureItems).toEqual([items[1]]);
  });
  it('isolates duplicate IDs and keeps input instances stable while typing or deleting a previous sibling', () => {
    const source = [{ id: 'same', title: '章', children: [{ id: 'same', title: '節A' }, { id: 'same', title: '節B' }] }];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup(source);
    expect(loadMaterialDetailPreferences('u', 'm').structureItems[0].children!.map(item => item.id)).toEqual(['same', 'same']);
    const input = title('1-2');
    fillTitle('1-2', '修正B'); expect(title('1-2')).toBe(input);
    expect(title('1').props.value).toBe('章'); expect(title('1-1').props.value).toBe('節A');
    remove('節A'); expect(title('1-1')).toBe(input); expect(title('1-1').props.value).toBe('修正B');
    click('保存'); openEditor();
    const saved = loadMaterialDetailPreferences('u', 'm').structureItems;
    expect(saved[0].id).toBe('same'); expect(saved[0].children![0].id).not.toBe('same');
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key|unique.*key/i);
  });
  it('keeps existing input keys stable if a newly added item receives a colliding ID', () => {
    setup([{ id: 'same', title: '元の章', children: [{ id: 'child', title: '元の節' }] }]);
    const existing = title('1-1');
    vi.spyOn(id, 'createId').mockReturnValue('same');
    click('章・節を追加');
    expect(title('1-1')).toBe(existing); fillTitle('2', '追加した章'); click('保存');
    const saved = loadMaterialDetailPreferences('u', 'm').structureItems;
    expect(saved[0]).toEqual({ id: 'same', title: '元の章', startUnit: undefined, endUnit: undefined, progressRate: undefined, children: [{ id: 'child', title: '元の節', startUnit: undefined, endUnit: undefined, progressRate: undefined }] });
    expect(saved[1].id).not.toBe('same'); expect(saved[1].title).toBe('追加した章');
  });
  it('retains the draft and saved descendants when a child name is blank', () => {
    const items = photographed(); setup(items);
    fillTitle('1-1', '  '); click('保存');
    expect(renderer.root.findByProps({ role: 'alert' }).props.children).toContain('章・節の名前');
    expect(title('1-1-1').props.value).toBe('第1小節');
    expect(loadMaterialDetailPreferences('u', 'm').structureItems).toEqual(items);
    act(() => renderer.root.findByProps({ 'aria-label': '目次を使う' }).props.onChange({ target: { checked: false } }));
    click('保存');
    expect(loadMaterialDetailPreferences('u', 'm').structureItems).toEqual(items);
    act(() => renderer.root.findByProps({ 'aria-label': '目次を使う' }).props.onChange({ target: { checked: true } }));
    fillTitle('1-1', '修正済み'); click('保存'); openEditor();
    expect(title('1-1').props.value).toBe('修正済み');
  });
});
