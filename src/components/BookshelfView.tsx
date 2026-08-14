import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Bookmark, Pencil, Plus } from 'lucide-react';
import {
  buildSubjectsWithMaterialFallback,
  getActiveStudyMaterials,
  groupMaterialsBySubjectId,
} from '../lib/bookshelfMaterials';
import {
  calculateMaterialPace,
  type MaterialPaceResult,
} from '../lib/materialPace';
import { todayIsoDate } from '../lib/date';
import { BookshelfMaterialDialog } from './BookshelfMaterialDialog';
import { BookshelfSubjectDialog } from './BookshelfSubjectDialog';
import {
  getSubjectColor,
  getSubjectStyle,
  SUBJECT_COLOR_OPTIONS,
} from './BookshelfDialogFields';
import type {
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
}

function formatPaceAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function MaterialCover({
  material,
  subject,
}: {
  material: StudyMaterial;
  subject: StudySubject | null;
}) {
  const color = material.color || getSubjectColor(subject);

  if (material.coverImageDataUrl || material.coverImageUrl) {
    return (
      <img
        className="bookshelf-material-image"
        src={material.coverImageDataUrl || material.coverImageUrl}
        alt={material.name}
      />
    );
  }

  return (
    <div className="bookshelf-material-placeholder" style={getSubjectStyle(color)}>
      <BookOpen aria-hidden="true" size={30} strokeWidth={1.8} />
    </div>
  );
}

function MaterialPaceSummary({ pace }: { pace: MaterialPaceResult }) {
  if (!pace.enabled || pace.status === 'disabled') {
    return null;
  }

  const remainingLabel = `残り ${formatPaceAmount(pace.remainingUnits)}${pace.unitLabel}`;
  const quotaLabel =
    pace.suggestedDailyUnits !== null
      ? `1日 ${formatPaceAmount(pace.suggestedDailyUnits)}${pace.unitLabel}`
      : null;

  return (
    <div className="material-pace-summary" aria-label="教材ペース">
      <div className="material-pace-progress">
        <span style={{ width: `${Math.min(100, Math.max(0, pace.progressRate))}%` }} />
      </div>
      <div className="material-pace-chip-row">
        <span>進捗 {formatPercent(pace.progressRate)}</span>
        {pace.status === 'completed' ? <span>完了</span> : <span>{remainingLabel}</span>}
      </div>
      {pace.status === 'on-track' ? (
        <div className="material-pace-chip-row">
          <span>あと{pace.remainingDays}日</span>
          {quotaLabel ? <span>{quotaLabel}</span> : null}
        </div>
      ) : null}
      {pace.status === 'on-track' && pace.estimatedDailyMinutes !== null ? (
        <span className="material-pace-note">目安 約{pace.estimatedDailyMinutes}分/日</span>
      ) : null}
      {pace.status === 'no-target' ? (
        <span className="material-pace-note">目標日未設定</span>
      ) : null}
      {pace.status === 'overdue' ? (
        <span className="material-pace-note">目標日を過ぎています</span>
      ) : null}
      {pace.status === 'invalid' ? (
        <span className="material-pace-note">総量を設定してください</span>
      ) : null}
    </div>
  );
}

export function BookshelfView({
  userId,
  subjects,
  materials,
  initialAction = null,
  onInitialActionHandled,
  onSaveSubject,
  onDeleteSubject,
  onSaveMaterial,
  onDeleteMaterial,
}: BookshelfViewProps) {
  const [editingSubject, setEditingSubject] = useState<StudySubject | null | undefined>(
    undefined,
  );
  const [editingMaterial, setEditingMaterial] = useState<StudyMaterial | null | undefined>(
    undefined,
  );
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

  useEffect(() => {
    if (initialAction === 'add-material') {
      setEditingMaterial(null);
      onInitialActionHandled?.();
    }
  }, [initialAction, onInitialActionHandled]);

  const hasAnySection = subjectsWithFallback.length > 0;

  return (
    <section className="section-stack bookshelf-view">
      <div className="panel bookshelf-hero">
        <div className="section-header">
          <div>
            <p className="eyebrow">Bookshelf</p>
            <h2>本棚</h2>
            <p>教科ごとに、よく使う教材を写真つきで整理します。</p>
          </div>
          <div className="row-actions">
            <button
              className="ghost-button"
              onClick={() => setEditingSubject(null)}
              type="button"
            >
              <Plus aria-hidden="true" size={18} strokeWidth={1.9} />
              教科
            </button>
            <button
              className="primary-button"
              onClick={() => setEditingMaterial(null)}
              type="button"
            >
              <Plus aria-hidden="true" size={18} strokeWidth={1.9} />
              教材
            </button>
          </div>
        </div>
      </div>

      {hasAnySection ? (
        subjectsWithFallback.map((subject) => {
          const subjectMaterials = materialBySubjectId.get(subject.id) ?? [];
          const isKnownSubject = subjects.some((item) => item.id === subject.id);

          return (
            <section className="panel bookshelf-subject-section" key={subject.id}>
              <div className="bookshelf-subject-head" style={getSubjectStyle(subject.color)}>
                <div className="bookshelf-subject-title">
                  <span className="bookshelf-bookmark">
                    <Bookmark aria-hidden="true" size={20} strokeWidth={2} />
                  </span>
                  <div>
                    <h3>{subject.name}</h3>
                    <p>{subjectMaterials.length}冊</p>
                  </div>
                </div>
                {isKnownSubject ? (
                  <button
                    className="mini-button"
                    onClick={() => setEditingSubject(subject)}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={16} strokeWidth={1.9} />
                    編集
                  </button>
                ) : null}
              </div>

              {subjectMaterials.length > 0 ? (
                <div className="bookshelf-material-grid">
                  {subjectMaterials.map((material) => {
                    const pace = calculateMaterialPace(material, todayIsoDate());

                    return (
                      <button
                        className={
                          pace.enabled
                            ? 'bookshelf-material-card has-pace'
                            : 'bookshelf-material-card'
                        }
                        key={material.id}
                        onClick={() => setEditingMaterial(material)}
                        style={getSubjectStyle(material.color || subject.color)}
                        type="button"
                      >
                        <MaterialCover material={material} subject={subject} />
                        <span className="bookshelf-material-title">{material.name}</span>
                        <MaterialPaceSummary pace={pace} />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="bookshelf-empty-subject">
                  <p className="empty-copy">まだ教材がありません。</p>
                  <button
                    className="mini-button"
                    onClick={() => setEditingMaterial(null)}
                    type="button"
                  >
                    教材を追加
                  </button>
                </div>
              )}
            </section>
          );
        })
      ) : (
        <section className="panel bookshelf-empty-state">
          <BookOpen aria-hidden="true" size={34} strokeWidth={1.7} />
          <h3>まずは教科を追加</h3>
          <p className="empty-copy">
            教科を作ると、その下に教材カードを並べられます。
          </p>
          <button
            className="primary-button"
            onClick={() => setEditingSubject(null)}
            type="button"
          >
            教科を追加
          </button>
        </section>
      )}

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
