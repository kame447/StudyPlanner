import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { BookshelfView } from './BookshelfView';
import { BookshelfMaterialDetail } from './BookshelfMaterialDetail';
import {
  getDefaultMaterialDetailPreferences,
  loadMaterialDetailPreferences,
  saveMaterialDetailPreferences,
} from '../lib/bookshelfMaterialDetails';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';
import type { StudyMaterial } from '../types/domain';

const material: StudyMaterial = {
  id: 'material', userId: 'owner', name: '教材', subjectId: 'math', subjectName: '数学',
  createdAt: '', updatedAt: '', progressUnit: 'page',
};
let renderer: ReactTestRenderer;

afterEach(() => {
  act(() => renderer?.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function text(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'object' ? text(child) : String(child)).join('');
}

function click(label: string) {
  act(() => renderer.root.findAllByType('button').find(node => text(node) === label)!.props.onClick());
}

function title(position: string) {
  return renderer.root.findAllByType('label')
    .find(node => text(node) === `章・節の名前 ${position}`)!.findByType('input');
}

function fillTitle(position: string, value: string) {
  act(() => title(position).props.onChange({ target: { value } }));
}

function openEditor() {
  act(() => renderer.root.findByType(BookshelfMaterialDetail).props.onEditStructure());
}

function mount() {
  act(() => {
    renderer = create(<BookshelfView userId="owner" subjects={[]} materials={[material]} plans={[]} actuals={[]}
      onSaveSubject={vi.fn()} onDeleteSubject={vi.fn()} onCaptureMaterialBaseline={vi.fn()}
      onSaveMaterial={vi.fn()} onDeleteMaterial={vi.fn()} onAddMaterialToPlan={vi.fn()} />);
  });
  act(() => renderer.root.findAllByProps({ 'aria-label': '教材を開く' })[0].props.onClick({ stopPropagation() {} }));
  openEditor();
}

function setup() {
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  vi.stubGlobal('localStorage', storage);
  saveMaterialDetailPreferences('owner', 'material', {
    ...getDefaultMaterialDetailPreferences(),
    favorite: true,
    structureEnabled: true,
    structureItems: Array.from({ length: 24 }, (_, index) => ({
      id: `chapter-${index + 1}`, title: `第${index + 1}章`, startUnit: index * 10 + 1, endUnit: (index + 1) * 10,
      ...(index === 0 ? { children: [{ id: 'section-1', title: '保存済みの節', progressRate: 25 }] } : {}),
    })),
  });
  const original = loadMaterialDetailPreferences('owner', 'material');
  const originalBytes = storage.getItem(storage.key(0)!);
  mount();
  return { storage, original, originalBytes };
}

it.each(['QuotaExceededError', 'SecurityError'])('retains the complete draft after %s and saves it on retry', errorName => {
  const { storage, original, originalBytes } = setup();
  const revisedTitle = `第24章 ${'LONGTOKEN'.repeat(20)}`;
  fillTitle('24', revisedTitle);
  fillTitle('1-1', '未保存の節');
  act(() => renderer.root.findByProps({ 'aria-label': '進捗（%・任意） 1-1' }).props.onChange({ target: { value: '70' } }));
  const write = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new DOMException('Storage unavailable', errorName); });

  click('保存');

  expect(renderer.root.findAllByProps({ className: 'modal-card bookshelf-structure-editor' })).toHaveLength(1);
  expect(text(renderer.root.findByProps({ role: 'alert' }))).toContain('保存できませんでした');
  expect(title('24').props.value).toBe(revisedTitle);
  expect(title('1-1').props.value).toBe('未保存の節');
  expect(renderer.root.findByProps({ 'aria-label': '進捗（%・任意） 1-1' }).props.value).toBe(70);
  expect(renderer.root.findByProps({ 'aria-label': '目次を使う' }).props.checked).toBe(true);
  expect(renderer.root.findAllByProps({ placeholder: '例: 第1章 アルゴリズムの基礎' })).toHaveLength(25);
  expect(storage.getItem(storage.key(0)!)).toBe(originalBytes);
  expect(loadMaterialDetailPreferences('owner', 'material')).toEqual(original);
  expect(renderer.root.findByType(BookshelfMaterialDetail).props.preferences).toEqual(original);

  write.mockRestore();
  click('保存');

  const expected = structuredClone(original);
  expected.structureItems[23].title = revisedTitle;
  expected.structureItems[0].children![0].title = '未保存の節';
  expected.structureItems[0].children![0].progressRate = 70;
  expect(renderer.root.findAllByProps({ className: 'modal-card bookshelf-structure-editor' })).toHaveLength(0);
  expect(loadMaterialDetailPreferences('owner', 'material')).toEqual(expected);
  expect(renderer.root.findByType(BookshelfMaterialDetail).props.preferences).toEqual(expected);
  openEditor();
  expect(title('24').props.value).toBe(revisedTitle);
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  act(() => renderer.unmount());
  mount();
  expect(title('24').props.value).toBe(revisedTitle);
  expect(title('1-1').props.value).toBe('未保存の節');
});

it('lets Cancel discard a failed draft without changing the saved contents', () => {
  const { storage, original } = setup();
  fillTitle('24', '保存されない変更');
  const write = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  click('保存');
  expect(renderer.root.findAllByProps({ className: 'modal-card bookshelf-structure-editor' })).toHaveLength(1);
  click('キャンセル');
  expect(renderer.root.findAllByProps({ className: 'modal-card bookshelf-structure-editor' })).toHaveLength(0);
  expect(loadMaterialDetailPreferences('owner', 'material')).toEqual(original);
  write.mockRestore();
  openEditor();
  expect(title('24').props.value).toBe('第24章');
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
});

it('retains an open draft if browser storage access is revoked before Save', () => {
  const { storage, original } = setup();
  fillTitle('24', 'アクセス回復後に保存する変更');
  vi.stubGlobal('window', { get localStorage() { throw new DOMException('Denied', 'SecurityError'); } });
  expect(() => click('保存')).not.toThrow();
  expect(title('24').props.value).toBe('アクセス回復後に保存する変更');
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  vi.stubGlobal('window', { localStorage: storage });
  expect(loadMaterialDetailPreferences('owner', 'material')).toEqual(original);
  click('保存');
  expect(loadMaterialDetailPreferences('owner', 'material').structureItems[23].title).toBe('アクセス回復後に保存する変更');
});

it('retains a first-time table of contents when no saved preferences exist', () => {
  const storage = new MemoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
  vi.stubGlobal('localStorage', storage);
  mount();
  act(() => renderer.root.findByProps({ 'aria-label': '目次を使う' }).props.onChange({ target: { checked: true } }));
  click('章・節を追加');
  fillTitle('1', 'はじめて作る目次');
  const write = vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  click('保存');
  expect(title('1').props.value).toBe('はじめて作る目次');
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  expect(loadMaterialDetailPreferences('owner', 'material')).toEqual(getDefaultMaterialDetailPreferences());
  write.mockRestore();
  click('保存');
  expect(loadMaterialDetailPreferences('owner', 'material').structureItems[0].title).toBe('はじめて作る目次');
});
