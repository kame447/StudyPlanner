import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Eye,
  ListTree,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  buildSubjectsWithMaterialFallback,
  getActiveStudyMaterials,
  groupMaterialsBySubjectId,
} from '../lib/bookshelfMaterials';
import {
  getDefaultMaterialDetailPreferences,
  isRecordForMaterial,
  loadMaterialDetailPreferences,
  saveMaterialDetailPreferences,
  type MaterialDetailPreferences,
  type MaterialStructureItem,
} from '../lib/bookshelfMaterialDetails';
import { calculateMaterialPace } from '../lib/materialPace';
import { createId } from '../lib/id';
import { todayIsoDate } from '../lib/date';
import { BookshelfMaterialDetail } from './BookshelfMaterialDetail';
import { BookshelfMaterialDialog } from './BookshelfMaterialDialog';
import { BookshelfSubjectDialog } from './BookshelfSubjectDialog';
import {
  getSubjectColor,
  getSubjectStyle,
  SUBJECT_COLOR_OPTIONS,
} from './BookshelfDialogFields';
import type {
  Actual,
  Plan,
  StudyMaterial,
  StudyMaterialDraft,
  StudySubject,
  StudySubjectDraft,
} from '../types/domain';

export type BookshelfInitialAction = 'add-material' | null;

interface BookshelfViewProps {
  userId: string;
  subjects: StudySubject[];
  materials: StudyMaterial[];
  plans: Plan[];
  actuals: Actual[];
  initialAction?: BookshelfInitialAction;
  onInitialActionHandled?: () => void;
  onSaveSubject: (
    draft: StudySubjectDraft,
    targetSubjectId?: string,
  ) => Promise<StudySubject>;
  onDeleteSubject: (subject: StudySubject) => Promise<void>;
  onSaveMaterial: (
    draft: StudyMaterialDraft,
    targetMaterialId?: string,
  ) => Promise<StudyMaterial>;
  onDeleteMaterial: (material: StudyMaterial) => Promise<void>;
  onAddMaterialToPlan: (material: StudyMaterial) => void;
}

function MaterialCover({
  material,
  subject,
  compact = false,
}: {
  material: StudyMaterial;
  subject: StudySubject | null;
  compact?: boolean;
}) {
  const color = material.color || getSubjectColor(subject);

  if (material.coverImageDataUrl || material.coverImageUrl) {
    return (
      <img
        className={compact ? 'bookshelf-list-cover' : 'bookshelf-featured-cover'}
        src={material.coverImageDataUrl || material.coverImageUrl}
        alt={material.name}
      />
    );
  }

  return (
    <div
      className={
        compact
          ? 'bookshelf-list-cover bookshelf-cover-placeholder'
          : 'bookshelf-featured-cover bookshelf-cover-placeholder'
      }
      style={getSubjectStyle(color)}
      aria-hidden="true"
    >
      <BookOpen size={compact ? 18 : 26} strokeWidth={1.8} />
    </div>
  );
}

function formatProgress(material: StudyMaterial): number {
  return calculateMaterialPace(material, todayIsoDate()).progressRate;
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clonePreferences(
  preferences: MaterialDetailPreferences,
): MaterialDetailPreferences {
  return {
    ...preferences,
    structureItems: preferences.structureItems.map((item) => ({
      ...item,
      children: item.children?.map((child) => ({ ...child })),
    })),
  };
}

export function BookshelfView({
  userId,
  subjects,
  materials,
  plans,
  actuals,
  initialAction = null,
  onInitialActionHandled,
  onSaveSubject,
  onDeleteSubject,
  onSaveMaterial,
  onDeleteMaterial,
  onAddMaterialToPlan,
}: BookshelfViewProps) {
  const [editingSubject, setEditingSubject] = useState<StudySubject | null | undefined>(
    undefined,
  );
  const [editingMaterial, setEditingMaterial] = useState<StudyMaterial | null | undefined>(
    undefined,
  );
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [menuMaterialId, setMenuMaterialId] = useState<string | null>(null);
  const [activeSubjectId, setActiveSubjectId] = useState<string>('all');
  const [expandedSubjectId, setExpandedSubjectId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [subjectManagerOpen, setSubjectManagerOpen] = useState(false);
  const [favoritesManagerOpen, setFavoritesManagerOpen] = useState(false);
  const [displaySettingsMaterialId, setDisplaySettingsMaterialId] = useState<string | null>(null);
  const [structureEditorMaterialId, setStructureEditorMaterialId] = useState<string | null>(null);
  const [structureDraft, setStructureDraft] = useState<MaterialDetailPreferences | null>(null);
  const [preferenceRevision, setPreferenceRevision] = useState(0);

  const activeMaterials = useMemo(
    () => getActiveStudyMaterials(materials, userId),
    [materials, userId],
  );
  const subjectsWithFallback = useMemo(
    () =>
      buildSubjectsWithMaterialFallback({
        subjects,
        activeMaterials,
        userId,
        fallbackColor: SUBJECT_COLOR_OPTIONS[6].value,
      }),
    [activeMaterials, subjects, userId],
  );
  const materialBySubjectId = useMemo(
    () => groupMaterialsBySubjectId(activeMaterials),
    [activeMaterials],
  );
  const preferencesByMaterialId = useMemo(() => {
    const preferences = new Map<string, MaterialDetailPreferences>();
    activeMaterials.forEach((material) => {
      preferences.set(
        material.id,
        loadMaterialDetailPreferences(userId, material.id),
      );
    });
    return preferences;
  }, [activeMaterials, preferenceRevision, userId]);

  useEffect(() => {
    if (initialAction === 'add-material') {
      setEditingMaterial(null);
      onInitialActionHandled?.();
    }
  }, [initialAction, onInitialActionHandled]);

  useEffect(() => {
    if (
      expandedSubjectId === null ||
      !subjectsWithFallback.some((subject) => subject.id === expandedSubjectId)
    ) {
      setExpandedSubjectId(subjectsWithFallback[0]?.id ?? null);
    }
  }, [expandedSubjectId, subjectsWithFallback]);

  useEffect(() => {
    if (
      selectedMaterialId &&
      !activeMaterials.some((material) => material.id === selectedMaterialId)
    ) {
      setSelectedMaterialId(null);
    }
  }, [activeMaterials, selectedMaterialId]);

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ja');
  const filteredMaterials = useMemo(
    () =>
      activeMaterials.filter((material) => {
        if (activeSubjectId !== 'all' && material.subjectId !== activeSubjectId) {
          return false;
        }
        if (!normalizedQuery) {
          return true;
        }
        return [material.name, material.subjectName, ...(material.aliases ?? [])]
          .join(' ')
          .toLocaleLowerCase('ja')
          .includes(normalizedQuery);
      }),
    [activeMaterials, activeSubjectId, normalizedQuery],
  );
  const filteredMaterialIds = useMemo(
    () => new Set(filteredMaterials.map((material) => material.id)),
    [filteredMaterials],
  );
  const frequentMaterials = useMemo(
    () =>
      filteredMaterials
        .slice()
        .sort((left, right) => {
          const leftPreferences =
            preferencesByMaterialId.get(left.id) ?? getDefaultMaterialDetailPreferences();
          const rightPreferences =
            preferencesByMaterialId.get(right.id) ?? getDefaultMaterialDetailPreferences();
          if (leftPreferences.favorite !== rightPreferences.favorite) {
            return leftPreferences.favorite ? -1 : 1;
          }

          const leftCount = actuals.filter((actual) => isRecordForMaterial(actual, left)).length;
          const rightCount = actuals.filter((actual) => isRecordForMaterial(actual, right)).length;
          return rightCount - leftCount || right.updatedAt.localeCompare(left.updatedAt);
        })
        .slice(0, 3),
    [actuals, filteredMaterials, preferencesByMaterialId],
  );
  const recentMaterials = useMemo(
    () =>
      filteredMaterials
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 3),
    [filteredMaterials],
  );

  const selectedMaterial = selectedMaterialId
    ? activeMaterials.find((material) => material.id === selectedMaterialId) ?? null
    : null;
  const menuMaterial = menuMaterialId
    ? activeMaterials.find((material) => material.id === menuMaterialId) ?? null
    : null;
  const displaySettingsMaterial = displaySettingsMaterialId
    ? activeMaterials.find((material) => material.id === displaySettingsMaterialId) ?? null
    : null;
  const structureEditorMaterial = structureEditorMaterialId
    ? activeMaterials.find((material) => material.id === structureEditorMaterialId) ?? null
    : null;

  function getPreferences(materialId: string): MaterialDetailPreferences {
    return (
      preferencesByMaterialId.get(materialId) ?? getDefaultMaterialDetailPreferences()
    );
  }

  function persistPreferences(
    materialId: string,
    nextPreferences: MaterialDetailPreferences,
  ) {
    saveMaterialDetailPreferences(userId, materialId, nextPreferences);
    setPreferenceRevision((current) => current + 1);
  }

  function openMaterialMenu(material: StudyMaterial) {
    setMenuMaterialId(material.id);
  }

  function openStructureEditor(material: StudyMaterial) {
    setMenuMaterialId(null);
    setStructureEditorMaterialId(material.id);
    setStructureDraft(clonePreferences(getPreferences(material.id)));
  }

  function toggleFavorite(material: StudyMaterial) {
    const current = getPreferences(material.id);
    persistPreferences(material.id, {
      ...current,
      favorite: !current.favorite,
    });
  }

  function updateStructureItem(
    itemId: string,
    patch: Partial<MaterialStructureItem>,
  ) {
    setStructureDraft((current) =>
      current
        ? {
            ...current,
            structureItems: current.structureItems.map((item) =>
              item.id === itemId ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  }

  function addStructureItem() {
    setStructureDraft((current) =>
      current
        ? {
            ...current,
            structureItems: [
              ...current.structureItems,
              {
                id: createId('material-structure'),
                title: '',
              },
            ],
          }
        : current,
    );
  }

  function removeStructureItem(itemId: string) {
    setStructureDraft((current) =>
      current
        ? {
            ...current,
            structureItems: current.structureItems.filter((item) => item.id !== itemId),
          }
        : current,
    );
  }

  function saveStructureEditor() {
    if (!structureEditorMaterial || !structureDraft) {
      return;
    }

    const cleanedItems = structureDraft.structureItems
      .map((item) => ({ ...item, title: item.title.trim() }))
      .filter((item) => item.title.length > 0);
    persistPreferences(structureEditorMaterial.id, {
      ...structureDraft,
      structureVisible: structureDraft.structureEnabled
        ? structureDraft.structureVisible
        : false,
      structureItems: cleanedItems,
    });
    setStructureEditorMaterialId(null);
    setStructureDraft(null);
  }

  async function deleteFromMenu(material: StudyMaterial) {
    const confirmed = window.confirm(`${material.name} を削除しますか？`);
    if (!confirmed) {
      return;
    }

    await onDeleteMaterial(material);
    setMenuMaterialId(null);
    if (selectedMaterialId === material.id) {
      setSelectedMaterialId(null);
    }
  }

  const bookshelfContent = selectedMaterial ? (
    <BookshelfMaterialDetail
      material={selectedMaterial}
      subject={
        subjectsWithFallback.find((subject) => subject.id === selectedMaterial.subjectId) ?? null
      }
      plans={plans}
      actuals={actuals}
      preferences={getPreferences(selectedMaterial.id)}
      onBack={() => setSelectedMaterialId(null)}
      onOpenMenu={() => openMaterialMenu(selectedMaterial)}
      onEditStructure={() => openStructureEditor(selectedMaterial)}
      onOpenDisplaySettings={() => setDisplaySettingsMaterialId(selectedMaterial.id)}
      onAddToPlan={() => onAddMaterialToPlan(selectedMaterial)}
    />
  ) : (
    <div className="bookshelf-dashboard">
      <header className="bookshelf-page-header">
        <div className="bookshelf-page-title-row">
          <span aria-hidden="true" />
          <h1>教材</h1>
          <button
            className="bookshelf-icon-button"
            onClick={() => setSearchOpen((current) => !current)}
            type="button"
            aria-label="教材を検索"
          >
            {searchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
          </button>
        </div>
        {searchOpen ? (
          <label className="bookshelf-search-field">
            <Search aria-hidden="true" size={18} />
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="教材名・カテゴリで検索"
            />
          </label>
        ) : null}
        <div className="bookshelf-category-filter-row">
          <div className="bookshelf-category-chips">
            <button
              className={activeSubjectId === 'all' ? 'active' : ''}
              onClick={() => setActiveSubjectId('all')}
              type="button"
            >
              すべて
            </button>
            {subjectsWithFallback.map((subject) => (
              <button
                className={activeSubjectId === subject.id ? 'active' : ''}
                key={subject.id}
                onClick={() => {
                  setActiveSubjectId(subject.id);
                  setExpandedSubjectId(subject.id);
                }}
                type="button"
              >
                {subject.name}
              </button>
            ))}
          </div>
          <button
            className="bookshelf-icon-button compact"
            onClick={() => setSubjectManagerOpen(true)}
            type="button"
            aria-label="カテゴリを管理"
          >
            <SlidersHorizontal aria-hidden="true" />
          </button>
        </div>
      </header>

      {frequentMaterials.length > 0 ? (
        <section className="bookshelf-dashboard-section">
          <div className="bookshelf-section-heading">
            <h2>よく使う教材</h2>
            <button type="button" onClick={() => setFavoritesManagerOpen(true)}>
              編集
            </button>
          </div>
          <div className="bookshelf-featured-grid">
            {frequentMaterials.map((material) => {
              const subject =
                subjectsWithFallback.find((item) => item.id === material.subjectId) ?? null;
              const progress = formatProgress(material);
              return (
                <button
                  className="bookshelf-featured-card"
                  key={material.id}
                  onClick={() => setSelectedMaterialId(material.id)}
                  type="button"
                >
                  <MaterialCover material={material} subject={subject} />
                  <span className="bookshelf-featured-copy">
                    <strong>{material.name}</strong>
                    <small>{subject?.name ?? material.subjectName}</small>
                    <span className="bookshelf-progress-caption">
                      <span className="bookshelf-inline-progress" aria-hidden="true">
                        <span style={{ width: `${progress}%` }} />
                      </span>
                      進捗 {Math.round(progress)}%
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="bookshelf-dashboard-section">
        <div className="bookshelf-section-heading">
          <h2>カテゴリ別</h2>
        </div>
        <div className="bookshelf-subject-list">
          {subjectsWithFallback
            .filter((subject) => activeSubjectId === 'all' || activeSubjectId === subject.id)
            .map((subject) => {
              const subjectMaterials = (materialBySubjectId.get(subject.id) ?? []).filter(
                (material) => filteredMaterialIds.has(material.id),
              );
              const expanded = expandedSubjectId === subject.id;

              return (
                <section
                  className={
                    expanded
                      ? 'bookshelf-subject-row expanded'
                      : 'bookshelf-subject-row'
                  }
                  key={subject.id}
                >
                  <button
                    className="bookshelf-subject-toggle"
                    onClick={() => setExpandedSubjectId(expanded ? null : subject.id)}
                    type="button"
                    style={getSubjectStyle(subject.color)}
                  >
                    <span className="bookshelf-subject-symbol">
                      <BookOpen aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{subject.name}</strong>
                      <small>{subjectMaterials.length}冊の教材</small>
                    </span>
                    {expanded ? (
                      <ChevronDown aria-hidden="true" />
                    ) : (
                      <ChevronRight aria-hidden="true" />
                    )}
                  </button>

                  {expanded ? (
                    <div className="bookshelf-expanded-materials">
                      {subjectMaterials.length > 0 ? (
                        subjectMaterials.map((material) => {
                          const progress = formatProgress(material);
                          return (
                            <div
                              className="bookshelf-material-list-row"
                              key={material.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedMaterialId(material.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setSelectedMaterialId(material.id);
                                }
                              }}
                            >
                              <MaterialCover material={material} subject={subject} compact />
                              <span className="bookshelf-material-row-copy">
                                <strong>{material.name}</strong>
                                <small>{material.subjectName}</small>
                              </span>
                              <span className="bookshelf-material-row-progress">
                                <small>進捗 {Math.round(progress)}%</small>
                                <span className="bookshelf-inline-progress" aria-hidden="true">
                                  <span style={{ width: `${progress}%` }} />
                                </span>
                              </span>
                              <button
                                type="button"
                                aria-label={`${material.name}のメニュー`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openMaterialMenu(material);
                                }}
                              >
                                <MoreHorizontal aria-hidden="true" />
                              </button>
                            </div>
                          );
                        })
                      ) : (
                        <div className="bookshelf-category-empty">
                          <p>このカテゴリに一致する教材はありません。</p>
                          <button type="button" onClick={() => setEditingMaterial(null)}>
                            教材を追加
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
        </div>
      </section>

      {recentMaterials.length > 0 ? (
        <section className="bookshelf-dashboard-section">
          <div className="bookshelf-section-heading">
            <h2>最近追加した教材</h2>
          </div>
          <div className="bookshelf-recent-list">
            {recentMaterials.map((material) => {
              const subject =
                subjectsWithFallback.find((item) => item.id === material.subjectId) ?? null;
              return (
                <div
                  className="bookshelf-recent-row"
                  key={material.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedMaterialId(material.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedMaterialId(material.id);
                    }
                  }}
                >
                  <MaterialCover material={material} subject={subject} compact />
                  <span>
                    <strong>{material.name}</strong>
                    <small>{material.subjectName}</small>
                  </span>
                  <time>
                    {new Date(material.createdAt).toLocaleDateString('ja-JP', {
                      month: 'numeric',
                      day: 'numeric',
                    })}
                  </time>
                  <button
                    type="button"
                    aria-label={`${material.name}のメニュー`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openMaterialMenu(material);
                    }}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeMaterials.length === 0 ? (
        <section className="bookshelf-empty-dashboard">
          <BookOpen aria-hidden="true" />
          <h2>教材を追加してください</h2>
          <p>階層構造を使わず、教材名だけ登録することもできます。</p>
          <button type="button" onClick={() => setEditingMaterial(null)}>
            教材を追加
          </button>
        </section>
      ) : null}

      <button
        className="bookshelf-add-material-fab"
        onClick={() => setEditingMaterial(null)}
        type="button"
      >
        <Plus aria-hidden="true" />
        教材追加
      </button>
    </div>
  );

  return (
    <section className="bookshelf-view">
      {bookshelfContent}

      {menuMaterial ? (
        <div className="overlay bookshelf-sheet-overlay" onClick={() => setMenuMaterialId(null)}>
          <div
            className="bookshelf-action-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="bookshelf-sheet-handle" />
            <div className="bookshelf-sheet-material">
              <MaterialCover
                material={menuMaterial}
                subject={
                  subjectsWithFallback.find(
                    (subject) => subject.id === menuMaterial.subjectId,
                  ) ?? null
                }
                compact
              />
              <span>
                <strong>{menuMaterial.name}</strong>
                <small>{menuMaterial.subjectName}</small>
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setDisplaySettingsMaterialId(menuMaterial.id);
                setMenuMaterialId(null);
              }}
            >
              <Eye aria-hidden="true" />
              表示設定
              <ChevronRight aria-hidden="true" />
            </button>
            <button type="button" onClick={() => openStructureEditor(menuMaterial)}>
              <ListTree aria-hidden="true" />
              教材内構造を編集
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingMaterial(menuMaterial);
                setMenuMaterialId(null);
              }}
            >
              <Pencil aria-hidden="true" />
              教材情報・進捗を編集
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                toggleFavorite(menuMaterial);
                setMenuMaterialId(null);
              }}
            >
              <Star aria-hidden="true" />
              {getPreferences(menuMaterial.id).favorite
                ? 'よく使う教材から外す'
                : 'よく使う教材に追加'}
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                onAddMaterialToPlan(menuMaterial);
                setMenuMaterialId(null);
              }}
            >
              <CalendarDays aria-hidden="true" />
              予定に追加
              <ChevronRight aria-hidden="true" />
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => void deleteFromMenu(menuMaterial)}
            >
              <Trash2 aria-hidden="true" />
              教材を削除
            </button>
            <button
              className="bookshelf-sheet-cancel"
              type="button"
              onClick={() => setMenuMaterialId(null)}
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}

      {displaySettingsMaterial ? (
        <div className="overlay modal-overlay" onClick={() => setDisplaySettingsMaterialId(null)}>
          <div
            className="modal-card bookshelf-settings-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="bookshelf-modal-title-row">
              <h2>表示設定</h2>
              <button
                type="button"
                onClick={() => setDisplaySettingsMaterialId(null)}
                aria-label="閉じる"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <section className="bookshelf-settings-group">
              <div>
                <strong>教材内構造を表示</strong>
                <small>章・節・単元などの一覧を教材詳細に表示します。</small>
              </div>
              <label className="bookshelf-switch">
                <input
                  type="checkbox"
                  disabled={!getPreferences(displaySettingsMaterial.id).structureEnabled}
                  checked={
                    getPreferences(displaySettingsMaterial.id).structureEnabled &&
                    getPreferences(displaySettingsMaterial.id).structureVisible
                  }
                  onChange={(event) => {
                    const current = getPreferences(displaySettingsMaterial.id);
                    persistPreferences(displaySettingsMaterial.id, {
                      ...current,
                      structureVisible: event.target.checked,
                    });
                  }}
                />
                <span aria-hidden="true" />
              </label>
            </section>
            <p className="bookshelf-settings-note">
              教材内構造を登録していても非表示にできます。非表示中も登録した項目は保持されます。
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() => setDisplaySettingsMaterialId(null)}
            >
              完了
            </button>
          </div>
        </div>
      ) : null}

      {structureEditorMaterial && structureDraft ? (
        <div
          className="overlay modal-overlay"
          onClick={() => {
            setStructureEditorMaterialId(null);
            setStructureDraft(null);
          }}
        >
          <div
            className="modal-card bookshelf-structure-editor"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="bookshelf-modal-title-row">
              <div>
                <h2>教材内構造</h2>
                <p>{structureEditorMaterial.name}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStructureEditorMaterialId(null);
                  setStructureDraft(null);
                }}
                aria-label="閉じる"
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <section className="bookshelf-settings-group">
              <div>
                <strong>教材内構造を使う</strong>
                <small>使わない場合は教材全体の進捗だけで管理します。</small>
              </div>
              <label className="bookshelf-switch">
                <input
                  type="checkbox"
                  checked={structureDraft.structureEnabled}
                  onChange={(event) =>
                    setStructureDraft((current) =>
                      current
                        ? {
                            ...current,
                            structureEnabled: event.target.checked,
                            structureVisible: event.target.checked
                              ? current.structureVisible || true
                              : false,
                          }
                        : current,
                    )
                  }
                />
                <span aria-hidden="true" />
              </label>
            </section>

            {structureDraft.structureEnabled ? (
              <div className="bookshelf-structure-edit-list">
                {structureDraft.structureItems.map((item, index) => (
                  <div className="bookshelf-structure-edit-row" key={item.id}>
                    <label>
                      <span>項目 {index + 1}</span>
                      <input
                        value={item.title}
                        onChange={(event) =>
                          updateStructureItem(item.id, { title: event.target.value })
                        }
                        placeholder="例: 第1章 アルゴリズムの基礎"
                      />
                    </label>
                    <label>
                      <span>開始位置</span>
                      <input
                        type="number"
                        min="0"
                        value={item.startUnit ?? ''}
                        onChange={(event) =>
                          updateStructureItem(item.id, {
                            startUnit: parseOptionalNumber(event.target.value),
                          })
                        }
                        placeholder="任意"
                      />
                    </label>
                    <label>
                      <span>終了位置</span>
                      <input
                        type="number"
                        min="0"
                        value={item.endUnit ?? ''}
                        onChange={(event) =>
                          updateStructureItem(item.id, {
                            endUnit: parseOptionalNumber(event.target.value),
                          })
                        }
                        placeholder="任意"
                      />
                    </label>
                    <label>
                      <span>進捗%</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={item.progressRate ?? ''}
                        onChange={(event) =>
                          updateStructureItem(item.id, {
                            progressRate: parseOptionalNumber(event.target.value),
                          })
                        }
                        placeholder="自動/任意"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeStructureItem(item.id)}
                      aria-label={`${item.title || `項目${index + 1}`}を削除`}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button
                  className="bookshelf-add-structure-row"
                  type="button"
                  onClick={addStructureItem}
                >
                  <Plus aria-hidden="true" />
                  項目を追加
                </button>
                <p className="bookshelf-settings-note">
                  章・節に限らず、問題集の単元や動画レッスンなど任意の区切りで登録できます。
                </p>
              </div>
            ) : (
              <p className="bookshelf-settings-note">
                この教材は階層なしで登録できます。後から有効にしても構いません。
              </p>
            )}

            <div className="row-actions">
              <button className="primary-button" type="button" onClick={saveStructureEditor}>
                保存
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setStructureEditorMaterialId(null);
                  setStructureDraft(null);
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {subjectManagerOpen ? (
        <div className="overlay modal-overlay" onClick={() => setSubjectManagerOpen(false)}>
          <div
            className="modal-card bookshelf-manager-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="bookshelf-modal-title-row">
              <h2>カテゴリ管理</h2>
              <button
                type="button"
                onClick={() => setSubjectManagerOpen(false)}
                aria-label="閉じる"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="bookshelf-manager-list">
              {subjects.map((subject) => (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => {
                    setEditingSubject(subject);
                    setSubjectManagerOpen(false);
                  }}
                  style={getSubjectStyle(subject.color)}
                >
                  <span className="bookshelf-manager-dot" />
                  <strong>{subject.name}</strong>
                  <Pencil aria-hidden="true" />
                </button>
              ))}
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setEditingSubject(null);
                setSubjectManagerOpen(false);
              }}
            >
              <Plus aria-hidden="true" />
              カテゴリを追加
            </button>
          </div>
        </div>
      ) : null}

      {favoritesManagerOpen ? (
        <div className="overlay modal-overlay" onClick={() => setFavoritesManagerOpen(false)}>
          <div
            className="modal-card bookshelf-manager-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="bookshelf-modal-title-row">
              <div>
                <h2>よく使う教材</h2>
                <p>星を付けた教材を優先して表示します。</p>
              </div>
              <button
                type="button"
                onClick={() => setFavoritesManagerOpen(false)}
                aria-label="閉じる"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="bookshelf-favorite-manager-list">
              {activeMaterials.map((material) => {
                const favorite = getPreferences(material.id).favorite;
                return (
                  <button
                    key={material.id}
                    type="button"
                    onClick={() => toggleFavorite(material)}
                  >
                    <Star
                      aria-hidden="true"
                      fill={favorite ? 'currentColor' : 'none'}
                    />
                    <span>
                      <strong>{material.name}</strong>
                      <small>{material.subjectName}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {editingSubject !== undefined ? (
        <BookshelfSubjectDialog
          userId={userId}
          subject={editingSubject}
          hasMaterials={
            editingSubject
              ? activeMaterials.some((material) => material.subjectId === editingSubject.id)
              : false
          }
          onClose={() => setEditingSubject(undefined)}
          onSave={onSaveSubject}
          onDelete={onDeleteSubject}
        />
      ) : null}

      {editingMaterial !== undefined ? (
        <BookshelfMaterialDialog
          userId={userId}
          material={editingMaterial}
          subjects={subjects}
          onClose={() => setEditingMaterial(undefined)}
          onSave={onSaveMaterial}
          onDelete={onDeleteMaterial}
        />
      ) : null}
    </section>
  );
}
