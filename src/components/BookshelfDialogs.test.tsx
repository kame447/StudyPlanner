import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { BookshelfMaterialDialog } from './BookshelfMaterialDialog';
import { BookshelfMaterialSearch } from './BookshelfMaterialSearch';
import { BookshelfSubjectDialog } from './BookshelfSubjectDialog';
import type { StudyMaterial, StudySubject } from '../types/domain';

const subject: StudySubject = {
  id: 'subject-math',
  userId: 'user-1',
  name: '数学',
  color: '#2f6fc2',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const material: StudyMaterial = {
  id: 'material-1',
  userId: 'user-1',
  name: '黄色チャート',
  subjectId: subject.id,
  subjectName: subject.name,
  color: subject.color,
  status: 'active',
  paceEnabled: true,
  progressUnit: 'page',
  totalUnits: 100,
  currentUnit: 120,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('bookshelf dialogs', () => {
  it('keeps subject creation and color selection inside the subject dialog', async () => {
    const onSave = vi.fn().mockResolvedValue(subject);
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <BookshelfSubjectDialog
          userId="user-1"
          subject={null}
          hasMaterials={false}
          onClose={onClose}
          onSave={onSave}
          onDelete={vi.fn()}
        />,
      );
    });

    act(() => {
      renderer.root.findByProps({ placeholder: '数学' }).props.onChange({
        target: { value: '数学' },
      });
      renderer.root.findAllByType('button').find(
        (button) => button.props.children?.[1] === '緑',
      )?.props.onClick();
    });

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onSave).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        name: '数学',
        color: '#2f8f6f',
      },
      undefined,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps subject deletion unavailable while materials still reference it', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <BookshelfSubjectDialog
          userId="user-1"
          subject={subject}
          hasMaterials
          onClose={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });

    const deleteButton = renderer.root.findAllByType('button').find(
      (button) => button.props.className === 'ghost-button danger',
    );

    expect(deleteButton?.props.disabled).toBe(true);
  });

  it('maps a new material to the selected subject without enabling pace implicitly', async () => {
    const onSave = vi.fn().mockResolvedValue(material);
    const onClose = vi.fn();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <BookshelfMaterialDialog
          userId="user-1"
          material={null}
          subjects={[subject]}
          onClose={onClose}
          onSave={onSave}
          onDelete={vi.fn()}
        />,
      );
    });

    act(() => {
      renderer.root.findByProps({ placeholder: '黄色チャート' }).props.onChange({
        target: { value: '黄色チャート' },
      });
    });

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        name: '黄色チャート',
        subjectId: 'subject-math',
        subjectName: '数学',
        color: '#2f6fc2',
        status: 'active',
        paceEnabled: false,
        progressUnit: 'page',
      }),
      undefined,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps catalog cover URLs separate and persists the selected catalog identity', async () => {
    const catalogCoverUrl = 'https://cover.example/9784023315686.jpg';
    const catalogCandidate = {
      catalogEntryId: 'seed:english-kintore',
      title: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
      authors: ['TEX加藤'],
      isbn13: '9784023315686',
      coverImageUrl: catalogCoverUrl,
      aliases: ['金フレ'],
    };
    const savedMaterial: StudyMaterial = {
      ...material,
      id: 'material-kintore',
      name: catalogCandidate.title,
      coverImageUrl: catalogCoverUrl,
      coverImageDataUrl: undefined,
      catalogEntryId: catalogCandidate.catalogEntryId,
      catalogTitle: catalogCandidate.title,
      catalogIsbn13: catalogCandidate.isbn13,
      aliases: catalogCandidate.aliases,
    };
    const onSave = vi.fn().mockResolvedValue(savedMaterial);
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <BookshelfMaterialDialog
          userId="user-1"
          material={null}
          subjects={[subject]}
          onClose={vi.fn()}
          onSave={onSave}
          onDelete={vi.fn()}
        />,
      );
    });

    act(() => {
      renderer.root.findByType(BookshelfMaterialSearch).props.onSelect(catalogCandidate);
    });

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: catalogCandidate.title,
        coverImageUrl: catalogCoverUrl,
        coverImageDataUrl: undefined,
        catalogEntryId: catalogCandidate.catalogEntryId,
        catalogTitle: catalogCandidate.title,
        catalogIsbn13: catalogCandidate.isbn13,
        aliases: catalogCandidate.aliases,
      }),
      undefined,
    );
  });

  it('shows the persisted catalog link while editing a linked material', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <BookshelfMaterialDialog
          userId="user-1"
          material={{
            ...material,
            catalogEntryId: 'isbn13:9784023315686',
            catalogTitle: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
            catalogIsbn13: '9784023315686',
          }}
          subjects={[subject]}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });

    const renderedText = renderer.root.findAllByType('p').map((node) => node.children.join(' ')).join('\n');
    expect(renderedText).toContain('教材DBに紐付け済み');
    expect(renderedText).toContain('9784023315686');
  });

  it('preserves the existing current-position clamp when editing paced material', async () => {
    const onSave = vi.fn().mockResolvedValue(material);
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <BookshelfMaterialDialog
          userId="user-1"
          material={material}
          subjects={[subject]}
          onClose={vi.fn()}
          onSave={onSave}
          onDelete={vi.fn()}
        />,
      );
    });

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        totalUnits: 100,
        currentUnit: 100,
        paceEnabled: true,
      }),
      'material-1',
    );
  });
});
