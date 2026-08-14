import { useMemo, type CSSProperties } from 'react';
import { BookOpen } from 'lucide-react';
import {
  buildSubjectsWithMaterialFallback,
  getActiveStudyMaterials,
  groupMaterialsBySubjectId,
} from '../lib/bookshelfMaterials';
import type { StudyMaterial, StudySubject } from '../types/domain';

const FALLBACK_SUBJECT_COLOR = '#6b7280';

function getSubjectStyle(color: string): CSSProperties {
  return {
    '--subject-color': color,
  } as CSSProperties;
}

function MaterialShelfCover({
  material,
  color,
}: {
  material: StudyMaterial;
  color: string;
}) {
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
      <BookOpen aria-hidden="true" size={22} strokeWidth={1.8} />
    </div>
  );
}

interface DailyMaterialShelfProps {
  userId: string;
  subjects: StudySubject[];
  materials: StudyMaterial[];
  onOpenBookshelf: () => void;
  onOpenAddMaterial: () => void;
  onSelectMaterial: (material: StudyMaterial) => void;
}

export function DailyMaterialShelf({
  userId,
  subjects,
  materials,
  onOpenBookshelf,
  onOpenAddMaterial,
  onSelectMaterial,
}: DailyMaterialShelfProps) {
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
        fallbackColor: FALLBACK_SUBJECT_COLOR,
      }),
    [activeMaterials, subjects, userId],
  );
  const groupedMaterials = useMemo(
    () => groupMaterialsBySubjectId(activeMaterials),
    [activeMaterials],
  );
  const sections = useMemo(() => {
    const subjectById = new Map(
      subjectsWithFallback.map((subject) => [subject.id, subject]),
    );

    return Array.from(groupedMaterials.entries())
      .map(([subjectId, subjectMaterials]) => {
        const subject = subjectById.get(subjectId);
        const firstMaterial = subjectMaterials[0];

        return {
          id: subjectId,
          name: subject?.name || firstMaterial?.subjectName || '未分類',
          color:
            subject?.color ||
            firstMaterial?.color ||
            FALLBACK_SUBJECT_COLOR,
          materials: subjectMaterials,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'ja'));
  }, [groupedMaterials, subjectsWithFallback]);

  return (
    <section className="panel daily-bookshelf-link-card print-hide">
      <div className="daily-material-head">
        <div>
          <strong>教材から追加</strong>
          <p className="empty-copy">教材を選んで、タイトル入力なしで予定・記録にできます。</p>
        </div>
        <div className="row-actions">
          <button className="ghost-button" onClick={onOpenBookshelf} type="button">
            本棚を開く
          </button>
          {activeMaterials.length === 0 ? (
            <button className="primary-button" onClick={onOpenAddMaterial} type="button">
              教材を追加
            </button>
          ) : null}
        </div>
      </div>

      {sections.length > 0 ? (
        <div className="daily-material-section">
          {sections.map((section) => (
            <div className="daily-material-subject" key={section.id}>
              <h3
                className="daily-material-subject-title"
                style={getSubjectStyle(section.color)}
              >
                {section.name}
              </h3>
              <div className="daily-material-row">
                {section.materials.map((material) => (
                  <button
                    className="bookshelf-material-card daily-material-card"
                    key={material.id}
                    onClick={() => onSelectMaterial(material)}
                    style={getSubjectStyle(material.color || section.color)}
                    type="button"
                  >
                    <MaterialShelfCover
                      material={material}
                      color={material.color || section.color}
                    />
                    <span>{material.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-copy">本棚で教材を追加してください。</p>
      )}
    </section>
  );
}
