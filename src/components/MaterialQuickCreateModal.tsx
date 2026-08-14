import { useState, type FormEvent } from 'react';
import {
  isValidQuickEntryDuration,
  resolveQuickEntryEndTime,
} from '../lib/quickEntryDrafts';
import type {
  ActualDraft,
  PlanDraft,
  StudyMaterial,
} from '../types/domain';

type MaterialQuickCreateKind = 'plan' | 'actual';
type DurationOptionValue = number | 'custom';

const MATERIAL_DURATION_OPTIONS: Array<{ value: DurationOptionValue; label: string }> = [
  { value: 15, label: '15分' },
  { value: 30, label: '30分' },
  { value: 45, label: '45分' },
  { value: 60, label: '60分' },
  { value: 90, label: '90分' },
  { value: 120, label: '120分' },
  { value: 'custom', label: '自由' },
];

interface MaterialQuickCreateModalProps {
  userId: string;
  selectedDate: string;
  material: StudyMaterial;
  onClose: () => void;
  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
}

export function MaterialQuickCreateModal({
  userId,
  selectedDate,
  material,
  onClose,
  onSavePlan,
  onSaveStandaloneActual,
}: MaterialQuickCreateModalProps) {
  const [kind, setKind] = useState<MaterialQuickCreateKind>('actual');
  const [date, setDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState('19:00');
  const [durationMinutes, setDurationMinutes] = useState<number | null>(30);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const endTime = isValidQuickEntryDuration(durationMinutes)
    ? resolveQuickEntryEndTime(startTime, durationMinutes)
    : null;
  const canSave = Boolean(endTime) && !isSubmitting;

  function applyDurationOption(value: DurationOptionValue) {
    if (value === 'custom') {
      setIsCustomDuration(true);

      const nextMinutes = Number(customDurationInput);
      setDurationMinutes(
        Number.isInteger(nextMinutes) && nextMinutes > 0 ? nextMinutes : null,
      );
      return;
    }

    setIsCustomDuration(false);
    setCustomDurationInput('');
    setDurationMinutes(value);
  }

  function updateCustomDuration(value: string) {
    setCustomDurationInput(value);

    const nextMinutes = Number(value);
    setDurationMinutes(
      Number.isInteger(nextMinutes) && nextMinutes > 0 ? nextMinutes : null,
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!endTime) {
      setError(
        durationMinutes === null
          ? '所要時間を選択してください。'
          : '所要時間は24時間未満にしてください。',
      );
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const baseFields = {
        userId,
        title: material.name,
        subject: material.subjectName,
        materialId: material.id,
        materialName: material.name,
      };

      if (kind === 'plan') {
        await onSavePlan({
          ...baseFields,
          date,
          startTime,
          endTime,
          repeat: 'none',
          repeatUntil: null,
          excludedDates: [],
          recurrenceRules: [],
          type: 'study',
          memo: '',
          sourceType: 'manual',
          sourceId: null,
        });
      } else {
        await onSaveStandaloneActual({
          ...baseFields,
          planId: null,
          occurrenceDate: date,
          actualStartTime: startTime,
          actualEndTime: endTime,
          isAlignedToPlan: false,
          note: '',
        });
      }

      onClose();
    } catch {
      setError(kind === 'plan' ? '予定を保存できませんでした。' : '記録を保存できませんでした。');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <form
        className="modal-card material-quick-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>教材から追加</h2>
            </div>
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          <div
            className={
              kind === 'actual'
                ? 'quick-entry-kind-switch material-quick-kind-switch is-actual'
                : 'quick-entry-kind-switch material-quick-kind-switch'
            }
            role="tablist"
            aria-label="登録種別"
          >
            <span className="quick-entry-kind-slider" aria-hidden="true" />
            <button
              className={
                kind === 'plan'
                  ? 'quick-entry-kind-option active'
                  : 'quick-entry-kind-option'
              }
              type="button"
              role="tab"
              aria-selected={kind === 'plan'}
              aria-pressed={kind === 'plan'}
              onClick={() => setKind('plan')}
            >
              予定
            </button>
            <button
              className={
                kind === 'actual'
                  ? 'quick-entry-kind-option active'
                  : 'quick-entry-kind-option'
              }
              type="button"
              role="tab"
              aria-selected={kind === 'actual'}
              aria-pressed={kind === 'actual'}
              onClick={() => setKind('actual')}
            >
              記録
            </button>
          </div>

          <div className="material-quick-form">
            <div className="quick-entry-two-column-grid">
              <label className="field">
                <span>日付</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label className="field">
                <span>開始時間</span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
            </div>

            <div className="material-quick-duration-grid">
              {MATERIAL_DURATION_OPTIONS.map((option) => {
                const isActive =
                  option.value === 'custom'
                    ? isCustomDuration
                    : !isCustomDuration && durationMinutes === option.value;

                return (
                  <button
                    className={isActive ? 'quick-entry-chip active' : 'quick-entry-chip'}
                    key={option.label}
                    onClick={() => applyDurationOption(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {isCustomDuration ? (
              <label className="field quick-entry-custom-duration">
                <span>自由入力（分）</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={customDurationInput}
                  onChange={(event) => updateCustomDuration(event.target.value)}
                  placeholder="75"
                />
              </label>
            ) : null}
          </div>

          {error ? <p className="inline-error">{error}</p> : null}

          <div className="row-actions">
            <button className="primary-button" disabled={!canSave} type="submit">
              登録する
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
