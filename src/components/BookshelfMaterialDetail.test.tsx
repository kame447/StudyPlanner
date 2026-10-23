import type { ComponentProps } from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookshelfMaterialDetail } from './BookshelfMaterialDetail';
import { getDefaultMaterialDetailPreferences } from '../lib/bookshelfMaterialDetails';
import type { StudyMaterial } from '../types/domain';

const material: StudyMaterial = { id: 'm', userId: 'u', name: '教材', subjectId: 'math', subjectName: '数学', createdAt: '', updatedAt: '', paceEnabled: false, totalUnits: 100, currentUnit: 25 };
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); });
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'object' ? text(child) : String(child)).join(''); }
function mount(changes: Partial<StudyMaterial> = {}, preferences = getDefaultMaterialDetailPreferences()) {
  act(() => { renderer = create(<BookshelfMaterialDetail material={{ ...material, ...changes }} subject={null} plans={[]} actuals={[]} preferences={preferences} onBack={vi.fn()} onOpenMenu={vi.fn()} onEditStructure={vi.fn()} onOpenDisplaySettings={vi.fn()} onAddToPlan={vi.fn()} />); });
}
function tab(label: string) { act(() => renderer.root.findByProps({ 'aria-label': '教材詳細タブ' }).findAllByType('button').find(node => text(node) === label)!.props.onClick()); }

describe('material detail configured content', () => {
  it.each([false, undefined])('hides unconfigured progress even if old quantities remain (%s)', paceEnabled => {
    mount({ paceEnabled });
    expect(text(renderer.root)).not.toContain('%');
    expect(text(renderer.root)).not.toContain('現在の進捗');
    expect(text(renderer.root)).not.toContain('使用していません');
    expect(text(renderer.root)).not.toContain('最近の学習記録');
    expect(text(renderer.root)).not.toContain('今後の予定');
    expect(text(renderer.root)).toContain('使用時間');
    tab('学習記録'); expect(text(renderer.root)).toContain('この教材に紐づく学習記録はまだありません。');
    tab('予定'); expect(text(renderer.root)).toContain('今後の予定');
    tab('概要'); expect(text(renderer.root)).not.toContain('今後の予定');
  });
  it('shows genuine configured progress including zero and suppresses invalid totals', () => {
    mount({ paceEnabled: true, currentUnit: 0 });
    expect(text(renderer.root)).toContain('進捗 0%');
    expect(text(renderer.root)).toContain('現在の進捗');
    act(() => renderer.update(<BookshelfMaterialDetail {...(renderer.root.findByType(BookshelfMaterialDetail).props as ComponentProps<typeof BookshelfMaterialDetail>)} material={{ ...material, paceEnabled: true, totalUnits: 0 }} />));
    expect(text(renderer.root)).not.toContain('%');
    expect(text(renderer.root)).not.toContain('現在の進捗');
  });
  it('keeps the enabled table of contents without inventing progress and honors hidden settings', () => {
    const preferences = { ...getDefaultMaterialDetailPreferences(), structureEnabled: true, structureVisible: true, structureItems: [{ id: 'chapter', title: '第1章', startUnit: 1, endUnit: 40, children: [{ id: 'section', title: '第1節', startUnit: 1, endUnit: 10 }] }] };
    mount({}, preferences);
    expect(text(renderer.root)).toContain('第1章');
    expect(text(renderer.root)).not.toContain('%');
    expect(text(renderer.root)).not.toContain('現在地');
    tab('目次'); expect(text(renderer.root)).toContain('第1節');
    act(() => renderer.update(<BookshelfMaterialDetail {...(renderer.root.findByType(BookshelfMaterialDetail).props as ComponentProps<typeof BookshelfMaterialDetail>)} preferences={{ ...preferences, structureVisible: false }} />));
    expect(text(renderer.root)).not.toContain('第1章');
    expect(text(renderer.root)).not.toContain('目次');
  });
});
