import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { BookOpen, Bookmark, Image as ImageIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  calculateMaterialPace,
  getMaterialUnitLabel,
  type MaterialPaceResult,
} from '../lib/materialPace';
import { createMaterialCoverDataUrl } from '../lib/materialImage';
import { todayIsoDate } from '../lib/date';
import type {
  StudyMaterial,
  StudyMaterialDraft,
  StudyMaterialProgressUnit,
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

const SUBJECT_COLOR_OPTIONS = [
  { label: '青', value: '#2f6fc2' },
  { label: '緑', value: '#2f8f6f' },
  { label: '赤', value: '#cc4b4b' },
  { label: 'ピンク', value: '#d65b8a' },
  { label: '紫', value: '#7d65c8' },
  { label: 'オレンジ', value: '#d9822b' },
  { label: 'グレー', value: '#6b7280' },
] as const;

const PROGRESS_UNIT_OPTIONS: Array<{
  value: StudyMaterialProgressUnit;
  label: string;
}> = [
  { value: 'page', label: 'ページ' },
  { value: 'problem', label: '問題' },
  { value: 'section', label: '章' },
  { value: 'video', label: '動画' },
  { value: 'word', label: '単語' },
  { value: 'custom', label: 'その他' },
];

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : undefined;
}

function formatPaceAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function getSubjectColor(subject: StudySubject | null | undefined): string {
  return subject?.color || SUBJECT_COLOR_OPTIONS[0].value;
}

function getSubjectStyle(color: string): CSSProperties {
  return {
    '--subject-color': color,
  } as CSSProperties;
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

function SubjectDialog({
  userId,
  subject,
  onClose,
  onSave,
  onDelete,
  hasMaterials,
}: {
  userId: string;
  subject: StudySubject | null;
  onClose: () => void;
  onSave: (
    draft: StudySubjectDraft,
    targetSubjectId?: string,
  ) => Promise<StudySubject>;
  onDelete: (subject: StudySubject) => Promise<void>;
  hasMaterials: boolean;
}) {
  const [name, setName] = useState(subject?.name ?? '');
  const [color, setColor] = useState(subject?.color ?? SUBJECT_COLOR_OPTIONS[0].value);
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSave = name.trim().length > 0 && !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(
        {
          userId,
          name,
          color,
        },
        subject?.id,
      );
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '教科を保存できませんでした。');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!subject || hasMaterials || isSubmitting) {
      return;
    }

    const confirmed = window.confirm(`${subject.name} を削除しますか？`);
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onDelete(subject);
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '教科を削除できませんでした。');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <form
        className="modal-card bookshelf-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>{subject ? '教科を編集' : '教科を追加'}</h2>
              <p>本棚とレポートで使う教科色を選びます。</p>
            </div>
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          <label className="field">
            <span>教科名</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="数学"
            />
          </label>

          <div className="field">
            <span>色</span>
            <div className="bookshelf-color-grid">
              {SUBJECT_COLOR_OPTIONS.map((option) => (
                <button
                  className={
                    color === option.value
                      ? 'bookshelf-color-button active'
                      : 'bookshelf-color-button'
                  }
                  key={option.value}
                  onClick={() => setColor(option.value)}
                  style={getSubjectStyle(option.value)}
                  type="button"
                >
                  <span aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {subject && hasMaterials ? (
            <p className="inline-note">
              教材がある教科は削除できません。先に教材を削除してください。
            </p>
          ) : null}

          <div className="row-actions">
            <button className="primary-button" disabled={!canSave} type="submit">
              保存
            </button>
            <button className="ghost-button" onClick={onClose} type="button">
              キャンセル
            </button>
            {subject ? (
              <button
                className="ghost-button danger"
                disabled={hasMaterials || isSubmitting}
                onClick={() => void handleDelete()}
                type="button"
              >
                <Trash2 aria-hidden="true" size={18} strokeWidth={1.9} />
                削除
              </button>
            ) : null}
            {status ? <span className="inline-error">{status}</span> : null}
          </div>
        </div>
      </form>
    </div>
  );
}

function MaterialDialog({
  userId,
  material,
  subjects,
  onClose,
  onSave,
  onDelete,
}: {
  userId: string;
  material: StudyMaterial | null;
  subjects: StudySubject[];
  onClose: () => void;
  onSave: (
    draft: StudyMaterialDraft,
    targetMaterialId?: string,
  ) => Promise<StudyMaterial>;
  onDelete: (material: StudyMaterial) => Promise<void>;
}) {
  const firstSubject = subjects[0] ?? null;
  const [name, setName] = useState(material?.name ?? '');
  const [subjectId, setSubjectId] = useState(material?.subjectId ?? firstSubject?.id ?? '');
  const [coverImageDataUrl, setCoverImageDataUrl] = useState(
    material?.coverImageDataUrl ?? '',
  );
  const [paceEnabled, setPaceEnabled] = useState(material?.paceEnabled === true);
  const [progressUnit, setProgressUnit] = useState<StudyMaterialProgressUnit>(
    material?.progressUnit ?? 'page',
  );
  const [progressUnitLabel, setProgressUnitLabel] = useState(
    material?.progressUnitLabel ?? '',
  );
  const [totalUnits, setTotalUnits] = useState(
    material?.totalUnits !== undefined ? String(material.totalUnits) : '',
  );
  const [currentUnit, setCurrentUnit] = useState(
    material?.currentUnit !== undefined ? String(material.currentUnit) : '',
  );
  const [targetDate, setTargetDate] = useState(material?.targetDate ?? '');
  const [estimatedMinutesPerUnit, setEstimatedMinutesPerUnit] = useState(
    material?.estimatedMinutesPerUnit !== undefined
      ? String(material.estimatedMinutesPerUnit)
      : '',
  );
  const [maxUnitsPerDay, setMaxUnitsPerDay] = useState(
    material?.maxUnitsPerDay !== undefined ? String(material.maxUnitsPerDay) : '',
  );
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'info' | 'error'>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedSubject = subjects.find((subject) => subject.id === subjectId) ?? null;
  const parsedTotalUnits = parseOptionalNumber(totalUnits);
  const unitLabel =
    progressUnit === 'custom'
      ? progressUnitLabel.trim() || '単位'
      : getMaterialUnitLabel({ progressUnit });
  const canSave = name.trim().length > 0 && Boolean(selectedSubject) && !isSubmitting;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setStatus('画像を処理しています...');
    setStatusTone('info');

    try {
      const nextDataUrl = await createMaterialCoverDataUrl(file);
      setCoverImageDataUrl(nextDataUrl);
      setStatus('写真を読み込みました。保存すると反映されます。');
      setStatusTone('info');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '写真を読み込めませんでした。');
      setStatusTone('error');
    } finally {
      event.target.value = '';
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave || !selectedSubject) {
      return;
    }

    setIsSubmitting(true);
    try {
      const nextTotalUnits = parseOptionalNumber(totalUnits);
      const nextCurrentUnit = parseOptionalNumber(currentUnit);
      await onSave(
        {
          userId,
          name,
          subjectId: selectedSubject.id,
          subjectName: selectedSubject.name,
          color: selectedSubject.color,
          coverImageDataUrl: coverImageDataUrl || undefined,
          aliases: material?.aliases ?? [],
          status: material?.status ?? 'active',
          paceEnabled,
          progressUnit,
          progressUnitLabel:
            progressUnit === 'custom' ? progressUnitLabel.trim() : undefined,
          totalUnits: nextTotalUnits,
          currentUnit:
            nextCurrentUnit !== undefined && nextTotalUnits !== undefined
              ? Math.min(nextCurrentUnit, nextTotalUnits)
              : nextCurrentUnit,
          targetDate: targetDate || undefined,
          estimatedMinutesPerUnit: parseOptionalNumber(estimatedMinutesPerUnit),
          maxUnitsPerDay: parseOptionalNumber(maxUnitsPerDay),
        },
        material?.id,
      );
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '教材を保存できませんでした。');
      setStatusTone('error');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!material || isSubmitting) {
      return;
    }

    const confirmed = window.confirm(`${material.name} を削除しますか？`);
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onDelete(material);
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '教材を削除できませんでした。');
      setStatusTone('error');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <form
        className="modal-card bookshelf-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>{material ? '教材を編集' : '教材を追加'}</h2>
              <p>教材名、教科、写真を登録します。</p>
            </div>
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          {subjects.length === 0 ? (
            <p className="inline-error">
              教材を追加する前に教科を1つ作成してください。
            </p>
          ) : null}

          <div className="bookshelf-material-edit-grid">
            <div className="bookshelf-cover-preview" style={getSubjectStyle(getSubjectColor(selectedSubject))}>
              {coverImageDataUrl ? (
                <img src={coverImageDataUrl} alt={name.trim() || '教材写真'} />
              ) : (
                <ImageIcon aria-hidden="true" size={34} strokeWidth={1.7} />
              )}
            </div>

            <div className="section-stack">
              <label className="field">
                <span>教材名</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="黄色チャート"
                />
              </label>

              <label className="field">
                <span>教科</span>
                <select
                  value={subjectId}
                  onChange={(event) => setSubjectId(event.target.value)}
                >
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="row-actions">
                <button
                  className="ghost-button"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  写真を選ぶ
                </button>
                {coverImageDataUrl ? (
                  <button
                    className="ghost-button"
                    onClick={() => setCoverImageDataUrl('')}
                    type="button"
                  >
                    写真を外す
                  </button>
                ) : null}
                <input
                  ref={fileInputRef}
                  className="hidden-file-input"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  type="file"
                />
              </div>
              <p className="detail-note">
                jpeg / png / webp のみ。保存前に小さく変換します。
              </p>
            </div>
          </div>

          <section className="material-pace-settings">
            <label className="material-pace-toggle">
              <input
                checked={paceEnabled}
                onChange={(event) => setPaceEnabled(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>教材ペース管理を使う</strong>
                <small>総量と目標日から、1日あたりの目安を表示します。</small>
              </span>
            </label>

            {paceEnabled ? (
              <div className="material-pace-form-grid">
                <label className="field">
                  <span>単位</span>
                  <select
                    value={progressUnit}
                    onChange={(event) =>
                      setProgressUnit(event.target.value as StudyMaterialProgressUnit)
                    }
                  >
                    {PROGRESS_UNIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {progressUnit === 'custom' ? (
                  <label className="field">
                    <span>単位名</span>
                    <input
                      value={progressUnitLabel}
                      onChange={(event) => setProgressUnitLabel(event.target.value)}
                      placeholder="例: レッスン"
                    />
                  </label>
                ) : null}

                <label className="field">
                  <span>総量</span>
                  <input
                    min="0"
                    step="1"
                    value={totalUnits}
                    onChange={(event) => setTotalUnits(event.target.value)}
                    placeholder={`例: 300${unitLabel}`}
                    type="number"
                  />
                </label>

                <label className="field">
                  <span>現在位置</span>
                  <input
                    max={parsedTotalUnits ?? undefined}
                    min="0"
                    step="1"
                    value={currentUnit}
                    onChange={(event) => setCurrentUnit(event.target.value)}
                    placeholder={`例: 45${unitLabel}`}
                    type="number"
                  />
                </label>

                <label className="field">
                  <span>目標日</span>
                  <input
                    value={targetDate}
                    onChange={(event) => setTargetDate(event.target.value)}
                    type="date"
                  />
                </label>

                <label className="field">
                  <span>1単位あたりの目安時間</span>
                  <input
                    min="0"
                    step="1"
                    value={estimatedMinutesPerUnit}
                    onChange={(event) => setEstimatedMinutesPerUnit(event.target.value)}
                    placeholder="分"
                    type="number"
                  />
                </label>

                <label className="field">
                  <span>1日の最大量</span>
                  <input
                    min="0"
                    step="1"
                    value={maxUnitsPerDay}
                    onChange={(event) => setMaxUnitsPerDay(event.target.value)}
                    placeholder="任意"
                    type="number"
                  />
                </label>
              </div>
            ) : null}
          </section>

          <div className="row-actions">
            <button className="primary-button" disabled={!canSave} type="submit">
              保存
            </button>
            <button className="ghost-button" onClick={onClose} type="button">
              キャンセル
            </button>
            {material ? (
              <button
                className="ghost-button danger"
                disabled={isSubmitting}
                onClick={() => void handleDelete()}
                type="button"
              >
                <Trash2 aria-hidden="true" size={18} strokeWidth={1.9} />
                削除
              </button>
            ) : null}
            {status ? (
              <span className={statusTone === 'error' ? 'inline-error' : 'inline-note'}>
                {status}
              </span>
            ) : null}
          </div>
        </div>
      </form>
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
    () =>
      materials.filter(
        (material) => material.userId === userId && material.status !== 'archived',
      ),
    [materials, userId],
  );
  const subjectsWithFallback = useMemo(() => {
    const subjectIds = new Set(subjects.map((subject) => subject.id));
    const fallbackSubjects = new Map<string, StudySubject>();

    activeMaterials
      .filter((material) => !subjectIds.has(material.subjectId))
      .forEach((material) => {
        if (fallbackSubjects.has(material.subjectId)) {
          return;
        }

        fallbackSubjects.set(material.subjectId, {
          id: material.subjectId,
          userId,
          name: material.subjectName || '未分類',
          color: material.color || SUBJECT_COLOR_OPTIONS[6].value,
          createdAt: material.createdAt,
          updatedAt: material.updatedAt,
        });
      });

    return [...subjects, ...Array.from(fallbackSubjects.values())];
  }, [activeMaterials, subjects, userId]);
  const materialBySubjectId = useMemo(() => {
    const grouped = new Map<string, StudyMaterial[]>();

    activeMaterials.forEach((material) => {
      const group = grouped.get(material.subjectId) ?? [];
      group.push(material);
      grouped.set(material.subjectId, group);
    });

    grouped.forEach((group) => {
      group.sort(
        (left, right) =>
          left.name.localeCompare(right.name, 'ja') ||
          left.createdAt.localeCompare(right.createdAt),
      );
    });

    return grouped;
  }, [activeMaterials]);

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
                        <span>{material.name}</span>
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
        <SubjectDialog
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
        <MaterialDialog
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
