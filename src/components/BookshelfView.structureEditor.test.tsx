import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { BookshelfView } from './BookshelfView';
import { BookshelfMaterialDetail } from './BookshelfMaterialDetail';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';
import { loadMaterialDetailPreferences } from '../lib/bookshelfMaterialDetails';
import type { StudyMaterial } from '../types/domain';
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'object' ? text(child) : String(child)).join(''); }
function click(label: string) { act(() => renderer.root.findAllByType('button').find(node => text(node) === label)!.props.onClick()); }
it('labels and saves table-of-contents fields, preserving cancellation and reopen', () => {
  const storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage });
  const material: StudyMaterial = { id: 'm', userId: 'u', name: '教材', subjectId: 'math', subjectName: '数学', createdAt: '', updatedAt: '', progressUnit: 'problem' };
  act(() => { renderer = create(<BookshelfView userId="u" subjects={[]} materials={[material]} plans={[]} actuals={[]} onSaveSubject={vi.fn()} onDeleteSubject={vi.fn()} onCaptureMaterialBaseline={vi.fn()} onSaveMaterial={vi.fn()} onDeleteMaterial={vi.fn()} onAddMaterialToPlan={vi.fn()} />); });
  act(() => renderer.root.findAllByProps({ 'aria-label': '教材を開く' })[0].props.onClick({ stopPropagation() {} }));
  act(() => renderer.root.findByType(BookshelfMaterialDetail).props.onEditStructure());
  act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }));
  click('章・節を追加');
  const labels = renderer.root.findAllByType('label');
  expect(labels.some(node => text(node) === '章・節の名前 1')).toBe(true);
  expect(labels.some(node => text(node) === '開始（問）')).toBe(true);
  expect(labels.some(node => text(node) === '終了（問）')).toBe(true);
  act(() => renderer.root.findByProps({ placeholder: '例: 第1章 アルゴリズムの基礎' }).props.onChange({ target: { value: '第1章' } }));
  click('保存');
  expect(loadMaterialDetailPreferences('u', 'm').structureItems[0].title).toBe('第1章');
  act(() => renderer.root.findByType(BookshelfMaterialDetail).props.onEditStructure());
  act(() => renderer.root.findByProps({ placeholder: '例: 第1章 アルゴリズムの基礎' }).props.onChange({ target: { value: '未保存' } }));
  click('キャンセル');
  act(() => renderer.root.findByType(BookshelfMaterialDetail).props.onEditStructure());
  expect(renderer.root.findByProps({ placeholder: '例: 第1章 アルゴリズムの基礎' }).props.value).toBe('第1章');
});
