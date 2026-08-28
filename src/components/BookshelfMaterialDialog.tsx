import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { Image as ImageIcon, Trash2 } from 'lucide-react';
import { getMaterialUnitLabel } from '../lib/materialPace';
import { createMaterialCoverDataUrl } from '../lib/materialImage';
import {
  getSubjectColor,
  getSubjectStyle,
  parseOptionalNumber,
  PROGRESS_UNIT_OPTIONS,
} from './BookshelfDialogFields';
import { BookshelfMaterialSearch } from './BookshelfMaterialSearch';
import type {
  StudyMaterial,
  StudyMaterialDraft,
  StudyMaterialProgressUnit,
  StudySubject,
} from '../types/domain';

interface BookshelfMaterialDialogProps {
  userId: string;
  material: StudyMaterial | null;
  subjects: StudySubject[];
  onClose: () => void;
  onSave: (
    draft: StudyMaterialDraft,
    targetMaterialId?: string,
  ) => Promise<StudyMaterial>;
  onDelete: (material: StudyMaterial) => Promise<void>;
}

export function BookshelfMaterialDialog({
  userId,
  material,
  subjects,
  onClose,
  onSave,
  onDelete,
}: BookshelfMaterialDialogProps) {
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

          {!material ? (
            <BookshelfMaterialSearch
              onSelect={(candidate) => {
                setName(candidate.title);
                setStatus('検索候補の教材名を反映しました。');
                setStatusTone('info');
              }}
            />
          ) : null}

          <div className="bookshelf-material-edit-grid">
            <div
              className="bookshelf-cover-preview"
              style={getSubjectStyle(getSubjectColor(selectedSubject))}
            >
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
