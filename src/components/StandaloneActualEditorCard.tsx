import { useEffect, useState } from 'react';
import { buildPlanOccurrenceKey } from '../lib/planRecurrence';
import { minutesBetween, minutesFromTime, timeFromMinutes } from '../lib/date';
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

interface LinkCandidate {
  plan: Plan;
  score: number;
  isRecorded: boolean;
  reasons: string[];
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

  const endMinutes = (minutesFromTime(startTime) + durationMinutes) % (24 * 60);

  return timeFromMinutes(endMinutes);
}

function getInitialDuration(actual: Actual): number | null {
  const minutes = minutesBetween(actual.actualStartTime, actual.actualEndTime);
  return minutes > 0 ? minutes : null;
}

function isPresetDuration(value: number | null): boolean {
  return DURATION_OPTIONS.some((option) => option.value === value);
}

function getInterval(startTime: string, endTime: string): { start: number; end: number } {
  const start = minutesFromTime(startTime);
  return {
    start,
    end: start + minutesBetween(startTime, endTime),
  };
}

function hasTimeOverlap(actual: Actual, plan: Plan): boolean {
  const actualInterval = getInterval(actual.actualStartTime, actual.actualEndTime);
  const planInterval = getInterval(plan.startTime, plan.endTime);

  return Math.max(actualInterval.start, planInterval.start) <
    Math.min(actualInterval.end, planInterval.end);
}

function getStartDiffMinutes(actual: Actual, plan: Plan): number {
  const actualStart = minutesFromTime(actual.actualStartTime);
  const planStart = minutesFromTime(plan.startTime);
  const rawDiff = Math.abs(actualStart - planStart);

  return Math.min(rawDiff, 24 * 60 - rawDiff);
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function hasPartialSubjectMatch(actualSubject: string, planSubject: string): boolean {
  const actualValue = normalizeText(actualSubject);
  const planValue = normalizeText(planSubject);

  return (
    actualValue.length >= 2 &&
    planValue.length >= 2 &&
    (actualValue.includes(planValue) || planValue.includes(actualValue))
  );
}

const GENERIC_TITLE_WORDS = new Set([
  '勉強',
  '学習',
  '復習',
  '課題',
  '予習',
  '演習',
  '自習',
  '練習',
  '対策',
  '確認',
  '暗記',
]);

function tokenizeTitle(
  value: string | undefined,
  subjects: string[] = [],
): string[] {
  const normalized = normalizeText(value);

  if (!normalized) {
    return [];
  }

  const subjectSet = new Set(
    subjects
      .map((subject) => normalizeText(subject))
      .filter((subject) => subject.length > 0),
  );
  const tokens = normalized
    .split(/[\s、。・,./_-]+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !GENERIC_TITLE_WORDS.has(token) &&
        !subjectSet.has(token),
    );

  return tokens.length > 0 || GENERIC_TITLE_WORDS.has(normalized) || subjectSet.has(normalized)
    ? tokens
    : [normalized];
}

function getCommonTitleTokens(
  actual: Actual,
  plan: Plan,
): string[] {
  const subjects = [actual.subject, plan.subject];
  const actualTokens = tokenizeTitle(actual.title, subjects);
  const planTokens = tokenizeTitle(plan.title, subjects);
  const commonTokens = actualTokens.filter((actualToken) =>
    planTokens.some(
      (planToken) =>
        actualToken === planToken ||
        (actualToken.length >= 3 && planToken.includes(actualToken)) ||
        (planToken.length >= 3 && actualToken.includes(planToken)),
    ),
  );

  return [...new Set(commonTokens)];
}

function hasExactTitleMatch(actual: Actual, plan: Plan): boolean {
  const actualValue = normalizeText(actual.title);
  const planValue = normalizeText(plan.title);
  const subjects = new Set(
    [actual.subject, plan.subject]
      .map((subject) => normalizeText(subject))
      .filter((subject) => subject.length > 0),
  );

  return (
    actualValue.length > 0 &&
    actualValue === planValue &&
    !GENERIC_TITLE_WORDS.has(actualValue) &&
    !subjects.has(actualValue)
  );
}

function hasMaterialTitleMatch(commonTitleTokens: string[]): boolean {
  return commonTitleTokens.some((token) => token.length >= 3);
}

function getDurationDiffMinutes(actual: Actual, plan: Plan): number {
  return Math.abs(
    minutesBetween(actual.actualStartTime, actual.actualEndTime) -
      minutesBetween(plan.startTime, plan.endTime),
  );
}

function isStudyCandidatePlan(plan: Plan): boolean {
  return plan.type === 'study' || plan.type === 'mock-exam' || plan.type === 'cram-school';
}

function scoreLinkCandidate(
  actual: Actual,
  plan: Plan,
  actuals: Actual[],
): LinkCandidate | null {
  const reasons: string[] = [];
  let score = isStudyCandidatePlan(plan) ? 8 : 0;
  const isRecorded = actuals.some(
    (item) =>
      item.id !== actual.id &&
      item.planId === plan.id &&
      item.occurrenceDate === actual.occurrenceDate,
  );

  const hasOverlap = hasTimeOverlap(actual, plan);
  if (hasOverlap) {
    score += 40;
    reasons.push('時間が重なっています');
  }

  const startDiff = getStartDiffMinutes(actual, plan);

  if (startDiff <= 15) {
    score += 30;
    reasons.push('開始時刻が近いです');
  } else if (startDiff <= 30) {
    score += 20;
    reasons.push('開始時刻が近めです');
  } else if (startDiff <= 60) {
    score += 10;
  }
  const hasTimeSignal = hasOverlap || startDiff <= 60;

  const actualSubject = normalizeText(actual.subject);
  const planSubject = normalizeText(plan.subject);
  const hasExactSubjectMatch = Boolean(
    actualSubject && planSubject && actualSubject === planSubject,
  );

  if (hasExactSubjectMatch) {
    score += 25;
    reasons.push('科目が一致しています');
  } else if (hasPartialSubjectMatch(actual.subject, plan.subject)) {
    score += 15;
    reasons.push('科目が近いです');
  }

  const commonTitleTokens = getCommonTitleTokens(actual, plan);
  const hasTitleExactMatch = hasExactTitleMatch(actual, plan);
  const hasMaterialMatch = hasMaterialTitleMatch(commonTitleTokens);

  if (hasTitleExactMatch) {
    score += 35;
    reasons.push('タイトルが一致しています');
  } else if (hasMaterialMatch) {
    score += 35;
    reasons.push('教材名が近いです');
  } else if (commonTitleTokens.length > 0) {
    score += 15;
    reasons.push('タイトルの主要語が近いです');
  }

  const durationDiff = getDurationDiffMinutes(actual, plan);
  if (durationDiff <= 15) {
    score += 15;
    reasons.push('所要時間が近いです');
  } else if (durationDiff <= 30) {
    score += 8;
  }

  const hasStrongContentSignal =
    hasTitleExactMatch ||
    hasMaterialMatch ||
    (hasExactSubjectMatch && commonTitleTokens.length >= 1) ||
    commonTitleTokens.length >= 2;

  if (!hasTimeSignal && !hasStrongContentSignal) {
    return null;
  }

  if (score < 30) {
    return null;
  }

  return {
    plan,
    score,
    isRecorded,
    reasons,
  };
}

function buildLinkCandidates(
  actual: Actual,
  plans: Plan[],
  actuals: Actual[],
): LinkCandidate[] {
  return plans
    .filter((plan) => plan.date === actual.occurrenceDate)
    .map((plan) => scoreLinkCandidate(actual, plan, actuals))
    .filter((candidate): candidate is LinkCandidate => Boolean(candidate))
    .sort(
      (left, right) =>
        Number(left.isRecorded) - Number(right.isRecorded) ||
        right.score - left.score,
    )
    .slice(0, 3);
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
    title,
    subject,
    actualStartTime: startTime,
    actualEndTime: endTime ?? actual.actualEndTime,
    isAlignedToPlan: false,
    note,
  };
  const linkCandidates = buildLinkCandidates(candidateActual, plans, actuals);

  useEffect(() => {
    const nextDuration = getInitialDuration(actual);
    const nextIsCustomDuration =
      nextDuration !== null && !isPresetDuration(nextDuration);

    setTitle(actual.title?.trim() || '');
    setSubject(actual.subject.trim());
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
    try {
      await onSaveStandaloneActual(
        {
          userId: actual.userId,
          planId: null,
          occurrenceDate: actual.occurrenceDate,
          actualStartTime: startTime,
          actualEndTime: endTime,
          title: title.trim(),
          subject: subject.trim(),
          isAlignedToPlan: false,
          note: note.trim(),
        },
        actual.id,
      );
      onClose();
    } catch {
      setError('記録を保存できませんでした。');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    setIsSubmitting(true);
    try {
      await onDeleteActual(actual);
      onClose();
    } catch {
      setError('記録を削除できませんでした。');
    } finally {
      setIsSubmitting(false);
    }
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
    try {
      await onLinkStandaloneActualToPlan(candidateActual, plan);
      onClose();
    } catch {
      setError('予定に紐づけできませんでした。');
    } finally {
      setIsSubmitting(false);
    }
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
            記録 {actual.occurrenceDate} / {actual.actualStartTime} - {actual.actualEndTime}
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
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例: 英語の復習"
              />
            </label>
            <label className="field">
              <span>科目</span>
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
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
              <input type="date" value={actual.occurrenceDate} disabled />
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
                const occurrenceKey = buildPlanOccurrenceKey(
                  candidate.plan.id,
                  candidate.plan.date,
                );

                return (
                  <article
                    className="standalone-link-candidate"
                    key={occurrenceKey}
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
