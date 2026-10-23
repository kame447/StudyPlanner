import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { BookshelfView } from './BookshelfView';
import { BookshelfMaterialDialog } from './BookshelfMaterialDialog';
import type { StudyMaterial, StudySubject } from '../types/domain';

const subject: StudySubject = { id: 'math', userId: 'owner', name: '数学', color: '#123456', createdAt: '', updatedAt: '' };
const legacy: StudyMaterial = { id: 'legacy', userId: 'owner', name: 'Legacy book', subjectId: 'math', subjectName: '数学', status: 'active', currentUnit: 100, totalUnits: 100, createdAt: '', updatedAt: '' };
const completed: StudyMaterial = { ...legacy, id: 'completed', name: 'Completed book', studyStatus: 'completed', currentUnit: 30 };
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); });

it('changes all shelf sections together and keeps archived/other-owner records excluded', () => {
  const onSaveMaterial = vi.fn();
  act(() => { renderer = create(<BookshelfView userId="owner" subjects={[subject]}
    materials={[legacy, completed, { ...completed, id: 'archive', name: 'Archived book', status: 'archived' }, { ...completed, id: 'other', name: 'Other owner', userId: 'other' }]}
    plans={[]} actuals={[]} onSaveSubject={vi.fn()} onDeleteSubject={vi.fn()}
    onCaptureMaterialBaseline={vi.fn()} onSaveMaterial={onSaveMaterial} onDeleteMaterial={vi.fn()} onAddMaterialToPlan={vi.fn()} />); });
  const select = (label: string) => {
    const group = renderer.root.findByProps({ 'aria-label': '学習状態で絞り込み' });
    act(() => group.findAllByType('button').find(button => button.props.children === label)!.props.onClick());
  };
  const shelf = () => JSON.stringify(renderer.toJSON());
  expect(shelf()).toContain('Legacy book');
  expect(shelf()).toContain('Completed book');
  expect(shelf()).not.toContain('Archived book');
  expect(shelf()).not.toContain('Other owner');
  select('学習済み');
  expect(shelf()).toContain('Completed book');
  expect(shelf()).not.toContain('Legacy book');
  select('学習中');
  expect(shelf()).toContain('Legacy book');
  expect(shelf()).not.toContain('Completed book');
  select('すべての状態');
  expect(shelf()).toContain('Completed book');
  expect(onSaveMaterial).not.toHaveBeenCalled();
});

it('opens the existing edit dialog for a completed material with its state and baseline', () => {
  const capture = vi.fn().mockReturnValue({ marker: 'baseline' });
  act(() => { renderer = create(<BookshelfView userId="owner" subjects={[subject]} materials={[completed]}
    plans={[]} actuals={[]} onSaveSubject={vi.fn()} onDeleteSubject={vi.fn()} onCaptureMaterialBaseline={capture}
    onSaveMaterial={vi.fn()} onDeleteMaterial={vi.fn()} onAddMaterialToPlan={vi.fn()} />); });
  act(() => renderer.root.findAllByProps({ 'aria-label': 'Completed bookのメニュー' })[0].props.onClick({ stopPropagation: vi.fn() }));
  const edit = renderer.root.findAllByType('button').find(button => button.findAll(node => typeof node.type === 'string' && node.children.includes('教材情報・進捗を編集')).length > 0);
  expect(edit).toBeDefined();
  act(() => edit!.props.onClick());
  const dialog = renderer.root.findByType(BookshelfMaterialDialog);
  expect(dialog.props.material.studyStatus).toBe('completed');
  expect(capture).toHaveBeenCalledWith(completed);
});

it('hides progress on untracked shelf rows while retaining a tracked zero percent', () => {
  act(() => { renderer = create(<BookshelfView userId="owner" subjects={[subject]} materials={[
    { ...legacy, name: 'Untracked', paceEnabled: false, currentUnit: 0 },
    { ...completed, name: 'Tracked zero', paceEnabled: true, currentUnit: 0 },
  ]} plans={[]} actuals={[]} onSaveSubject={vi.fn()} onDeleteSubject={vi.fn()} onCaptureMaterialBaseline={vi.fn()}
    onSaveMaterial={vi.fn()} onDeleteMaterial={vi.fn()} onAddMaterialToPlan={vi.fn()} />); });
  const rows = renderer.root.findAllByProps({ className: 'bookshelf-material-list-row' });
  const find = (name: string) => rows.find(row => row.findAllByType('strong').some(node => node.children.includes(name)))!;
  expect(find('Untracked').findAllByProps({ className: 'bookshelf-material-row-progress' })).toHaveLength(0);
  const featured = renderer.root.findAllByProps({ className: 'bookshelf-featured-card' });
  expect(featured.find(row => row.findAllByType('strong').some(node => node.children.includes('Untracked')))!.findAllByProps({ className: 'bookshelf-progress-caption' })).toHaveLength(0);
  expect(featured.find(row => row.findAllByType('strong').some(node => node.children.includes('Tracked zero')))!.findAllByProps({ className: 'bookshelf-progress-caption' })).toHaveLength(1);
  expect(find('Tracked zero').findByProps({ className: 'bookshelf-material-row-progress' }).findByType('small').children).toEqual(['進捗 ', '0', '%']);
});

it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  'hides unconfigured progress on shelf cards and rows, matching material detail (total %s)',
  (totalUnits) => {
    const onSaveMaterial = vi.fn();
    act(() => { renderer = create(<BookshelfView userId="owner" subjects={[subject]}
      materials={[{ ...legacy, name: 'No usable total', paceEnabled: true, totalUnits }]}
      plans={[]} actuals={[]} onSaveSubject={vi.fn()} onDeleteSubject={vi.fn()}
      onCaptureMaterialBaseline={vi.fn()} onSaveMaterial={onSaveMaterial}
      onDeleteMaterial={vi.fn()} onAddMaterialToPlan={vi.fn()} />); });

    expect(renderer.root.findAllByProps({ className: 'bookshelf-featured-card' })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ className: 'bookshelf-material-list-row' })).toHaveLength(1);
    expect.soft(renderer.root.findAllByProps({ className: 'bookshelf-progress-caption' })).toHaveLength(0);
    expect.soft(renderer.root.findAllByProps({ className: 'bookshelf-material-row-progress' })).toHaveLength(0);

    act(() => renderer.root.findAllByProps({ 'aria-label': 'No usable totalを開く' })[0].props.onClick({ stopPropagation: vi.fn() }));
    expect(renderer.root.findAllByProps({ className: 'bookshelf-detail-progress-line' })).toHaveLength(0);
    expect(onSaveMaterial).not.toHaveBeenCalled();
  },
);

it.each([0, 25, 100])('preserves configured progress of %s percent on both shelf surfaces', (currentUnit) => {
  act(() => { renderer = create(<BookshelfView userId="owner" subjects={[subject]}
    materials={[{ ...legacy, paceEnabled: true, currentUnit, totalUnits: 100 }]}
    plans={[]} actuals={[]} onSaveSubject={vi.fn()} onDeleteSubject={vi.fn()}
    onCaptureMaterialBaseline={vi.fn()} onSaveMaterial={vi.fn()}
    onDeleteMaterial={vi.fn()} onAddMaterialToPlan={vi.fn()} />); });

  const featured = renderer.root.findByProps({ className: 'bookshelf-progress-caption' });
  expect(featured.children.slice(-3)).toEqual(['進捗 ', String(currentUnit), '%']);
  const row = renderer.root.findByProps({ className: 'bookshelf-material-row-progress' });
  expect(row.findByType('small').children).toEqual(['進捗 ', String(currentUnit), '%']);
  for (const progress of [featured, row]) {
    expect(progress.findAll(node => node.props.style?.width === `${currentUnit}%`)).toHaveLength(1);
  }
});
