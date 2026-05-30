import { useEffect, useState } from 'react';
import { formatMinutesToTime, minutesBetween, parseTimeToMinutes } from '../lib/date';
import { expandPlansForDate } from '../lib/planRecurrence';
import { buildActualPlanLinkCandidates } from '../lib/actualPlanMatching';
import { inferSubjectFromTitle } from '../lib/subjectInference';
import type { Actual, ActualDraft, Plan } from '../types/domain';

type DurationOptionValue = number | 'custom';

interface StandaloneActualEditorCardProps {
  actual: Actual;
  plans: Plan[];
  actuals: Actual[];
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onLinkStandaloneActualToPlan: (actual: Actual, plan: Plan) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onClose: () => void;
}

const DURATION_OPTIONS: Array<{ value: DurationOptionValue; label: string }> = [
  { value: 15, label: '15分' },
  { value: 30, label: '30分' },
  { value: 45, label: '45分' },
  { value: 60, label: '60分' },
  { value: 90, label: '90分' },
  { value: 120, label: '120分' },
  { value: 'custom', label: '自由' },
];

function calculateEndTime(startTime: string, durationMinutes: number | null): string | null {
  if (durationMinutes === null || durationMinutes <= 0 || durationMinutes >= 24 * 60) {
    return null;
  }

  const endMinutes = Math.min(
    parseTimeToMinutes(startTime, 'start') + durationMinutes,
    24 * 60,
  );

  return formatMinutesToTime(endMinutes, 'end');
}

function getInitialDuration(actual: Actual): number | null {
  const minutes = minutesBetween(actual.actualStartTime, actual.actualEndTime);
  return minutes > 0 ? minutes : null;
}

function isPresetDuration(value: number | null): boolean {
  return DURATION_OPTIONS.some((option) => option.value === value);
}

export function StandaloneActualEditorCard({
  actual,
  plans,
  actuals,
  onSaveStandaloneActual,
  onLinkStandaloneActualToPlan,
  onDeleteActual,
  onClose,
}: StandaloneActualEditorCardProps) {
  const initialDuration = getInitialDuration(actual);
  const [title, setTitle] = useState(actual.title?.trim() || '');
  const [subject, setSubject] = useState(actual.subject.trim());
  const [subjectWasEdited, setSubjectWasEdited] = useState(false);
  const [occurrenceDate, setOccurrenceDate] = useState(actual.occurrenceDate);
  const [startTime, setStartTime] = useState(actual.actualStartTime);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(initialDuration);
  const [isCustomDuration, setIsCustomDuration] = useState(
    initialDuration !== null && !isPresetDuration(initialDuration),
  );
  const [customDurationInput, setCustomDurationInput] = useState(
    initialDuration !== null && !isPresetDuration(initialDuration)
      ? String(initialDuration)
      : '',
  );
  const [note, setNote] = useState(actual.note);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const endTime = calculateEndTime(startTime, durationMinutes);
  const candidateActual: Actual = {
    ...actual,
    occurrenceDate,
    title,
    subject,
    actualStartTime: startTime,
    actualEndTime: endTime ?? actual.actualEndTime,
    isAlignedToPlan: false,
    note,
  };
  const candidatePlans = expandPlansForDate(plans, occurrenceDate);
  const linkCandidates = buildActualPlanLinkCandidates(candidateActual, candidatePlans, actuals);

  useEffect(() => {
    const nextDuration = getInitialDuration(actual);
    const nextIsCustomDuration =
      nextDuration !== null && !isPresetDuration(nextDuration);

    setTitle(actual.title?.trim() || '');
    setSubject(actual.subject.trim());
    setSubjectWasEdited(false);
    setOccurrenceDate(actual.occurrenceDate);
    setStartTime(actual.actualStartTime);
    setDurationMinutes(nextDuration);
    setIsCustomDuration(nextIsCustomDuration);
    setCustomDurationInput(nextIsCustomDuration && nextDuration !== null ? String(nextDuration) : '');
    setNote(actual.note);
    setError('');
  }, [actual]);

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

  function updateTitle(nextTitle: string) {
    setTitle(nextTitle);

    if (!subjectWasEdited && !subject.trim()) {
      const inferredSubject = inferSubjectFromTitle(nextTitle);

      if (inferredSubject) {
        setSubject(inferredSubject);
      }
    }
  }

  function updateSubject(nextSubject: string) {
    setSubjectWasEdited(true);
    setSubject(nextSubject);
  }

  async function handleSave() {
    if (!title.trim()) {
      setError('タイトルを入力してください。');
      return;
    }

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
    void onSaveStandaloneActual(
      {
        userId: actual.userId,
        planId: null,
        occurrenceDate,
        actualStartTime: startTime,
        actualEndTime: endTime,
        title: title.trim(),
        subject: subject.trim(),
        isAlignedToPlan: false,
        note: note.trim(),
        materialId: actual.materialId ?? null,
        materialName: actual.materialName ?? '',
        materialProgressUpdates: actual.materialProgressUpdates,
      },
      actual.id,
    ).catch(() => undefined);
    onClose();
  }

  async function handleDelete() {
    setIsSubmitting(true);
    void onDeleteActual(actual).catch(() => undefined);
    onClose();
  }

  async function handleLink(plan: Plan) {
    if (!title.trim()) {
      setError('タイトルを入力してください。');
      return;
    }

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
    void onLinkStandaloneActualToPlan(candidateActual, plan).catch(() => undefined);
    onClose();
  }

  return (
    <article className="plan-detail-card actual-editor-card standalone-actual-editor-card">
      <div className="plan-detail-head actual-editor-head">
        <div>
          <div className="label-row">
            <strong>{actual.title?.trim() || '記録'}</strong>
            <span className="type-badge">予定なし</span>
          </div>
          <p className="comparison-subtitle">
            記録 {occurrenceDate} / {actual.actualStartTime} - {actual.actualEndTime}
            {actual.subject ? ` / ${actual.subject}` : ''}
          </p>
        </div>

        <div className="row-actions actual-editor-head-actions">
          <button
            className="primary-button"
            disabled={isSubmitting}
            onClick={() => void handleSave()}
            type="button"
          >
            保存
          </button>
        </div>
      </div>

      <div className="actual-form actual-form-compact">
        <section className="actual-editor-section">
          <div className="actual-editor-section-title">
            <strong>内容</strong>
          </div>
          <div className="actual-content-grid">
            <label className="field">
              <span>タイトル</span>
              <input
                value={title}
                onChange={(event) => updateTitle(event.target.value)}
                placeholder="例: 英語の復習"
              />
            </label>
            <label className="field">
              <span>科目</span>
              <input
                value={subject}
                onChange={(event) => updateSubject(event.target.value)}
                placeholder="英語"
              />
            </label>
          </div>
        </section>

        <section className="actual-editor-section">
          <div className="actual-editor-section-title">
            <strong>時間</strong>
          </div>
          <div className="actual-time-grid">
            <label className="field">
              <span>日付</span>
              <input
                type="date"
                value={occurrenceDate}
                onChange={(event) => setOccurrenceDate(event.target.value)}
              />
            </label>
            <label className="field">
              <span>開始時刻</span>
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
            <label className="field">
              <span>終了時刻</span>
              <input type="time" value={endTime ?? ''} disabled />
            </label>
          </div>

          <div className="quick-entry-chip-row quick-entry-duration-grid standalone-actual-duration-grid">
            {DURATION_OPTIONS.map((option) => {
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
        </section>

        <section className="actual-editor-section">
          <label className="field">
            <span>メモ</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="メモを追加"
            />
          </label>
        </section>

        <section className="actual-editor-section standalone-link-section">
          <div className="actual-editor-section-title">
            <strong>紐づけ候補</strong>
          </div>
          {linkCandidates.length > 0 ? (
            <div className="standalone-link-candidates">
              {linkCandidates.map((candidate, index) => {
                return (
                  <article
                    className="standalone-link-candidate"
                    key={candidate.occurrenceKey}
                  >
                    <div>
                      <div className="label-row">
                        <strong>
                          {candidate.plan.startTime}-{candidate.plan.endTime} {candidate.plan.title}
                        </strong>
                        {index === 0 && candidate.score >= 70 ? (
                          <span className="type-badge">おすすめ</span>
                        ) : null}
                        {candidate.isRecorded ? (
                          <span className="type-badge">記録済み</span>
                        ) : null}
                      </div>
                      <p className="comparison-subtitle">
                        {candidate.plan.subject || '科目未設定'}
                        {candidate.reasons.length > 0
                          ? ` / ${candidate.reasons.join('・')}`
                          : ''}
                      </p>
                    </div>
                    <button
                      className="mini-button"
                      disabled={
                        candidate.isRecorded ||
                        isSubmitting ||
                        !endTime ||
                        !title.trim()
                      }
                      onClick={() => void handleLink(candidate.plan)}
                      type="button"
                    >
                      この予定に紐づける
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="inline-note">近い予定はありません。</p>
          )}
        </section>

        {error ? <p className="inline-error">{error}</p> : null}

        <div className="row-actions actual-editor-actions">
          <button
            className="ghost-button danger"
            disabled={isSubmitting}
            onClick={() => {
              if (window.confirm('この記録を削除しますか？')) {
                void handleDelete();
              }
            }}
            type="button"
          >
            記録を削除
          </button>
        </div>
      </div>
    </article>
  );
}
