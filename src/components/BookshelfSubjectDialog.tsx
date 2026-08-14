import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { getSubjectStyle, SUBJECT_COLOR_OPTIONS } from './BookshelfDialogFields';
import type { StudySubject, StudySubjectDraft } from '../types/domain';

interface BookshelfSubjectDialogProps {
  userId: string;
  subject: StudySubject | null;
  onClose: () => void;
  onSave: (
    draft: StudySubjectDraft,
    targetSubjectId?: string,
  ) => Promise<StudySubject>;
  onDelete: (subject: StudySubject) => Promise<void>;
  hasMaterials: boolean;
}

export function BookshelfSubjectDialog({
  userId,
  subject,
  onClose,
  onSave,
  onDelete,
  hasMaterials,
}: BookshelfSubjectDialogProps) {
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
