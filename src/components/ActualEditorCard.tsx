import { useEffect, useState } from 'react';
import { formatMinutes, minutesBetween } from '../lib/date';
import { supportsScopedRecurringPlanEdits } from '../domain/recurringPlan';
import { getPlanTypeLabel } from '../lib/plans';
import { getPlanOccurrenceDate } from '../lib/planRecurrence';
import type { Actual, ActualDraft, Plan } from '../types/domain';
import { ActualTrackingTools } from './ActualTrackingTools';

interface ActualEditorCardProps {
  plan: Plan;
  actual?: Actual;
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  forceOpen?: boolean;
  hideToggleButton?: boolean;
}

function resolveActualTitle(plan: Plan, actual?: Actual): string {
  return actual?.title?.trim() || plan.title;
}

function resolveActualSubject(plan: Plan, actual?: Actual): string {
  return actual?.subject?.trim() || plan.subject;
}

function resolveAlignedToPlan(plan: Plan, actual?: Actual): boolean {
  if (typeof actual?.isAlignedToPlan === 'boolean') {
    return actual.isAlignedToPlan;
  }

  return (
    resolveActualTitle(plan, actual) === plan.title &&
    resolveActualSubject(plan, actual) === plan.subject
  );
}

function buildDraft(plan: Plan, actual?: Actual): ActualDraft {
  return {
    userId: plan.userId,
    planId: plan.id,
    occurrenceDate: getPlanOccurrenceDate(plan),
    actualStartTime: actual?.actualStartTime ?? plan.startTime,
    actualEndTime: actual?.actualEndTime ?? plan.endTime,
    title: resolveActualTitle(plan, actual),
    subject: resolveActualSubject(plan, actual),
    isAlignedToPlan: resolveAlignedToPlan(plan, actual),
    note: actual?.note ?? '',
  };
}

export function ActualEditorCard({
  plan,
  actual,
  onEditPlan,
  onDeletePlan,
  onSaveActual,
  onDeleteActual,
  forceOpen = false,
  hideToggleButton = false,
}: ActualEditorCardProps) {
  const [draft, setDraft] = useState<ActualDraft>(buildDraft(plan, actual));
  const [isOpen, setIsOpen] = useState(forceOpen || !actual);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(buildDraft(plan, actual));
    setError('');
    setIsOpen(forceOpen || !actual);
  }, [actual?.id, forceOpen, plan]);

  const planMinutes = minutesBetween(plan.startTime, plan.endTime);
  const actualMinutes = actual
    ? minutesBetween(actual.actualStartTime, actual.actualEndTime)
    : 0;
  const deltaMinutes = actual ? actualMinutes - planMinutes : null;
  const isScopedRecurringPlan = supportsScopedRecurringPlanEdits(plan);
  const actualTitle = resolveActualTitle(plan, actual);
  const actualSubject = resolveActualSubject(plan, actual);
  const alignedToPlan = resolveAlignedToPlan(plan, actual);

  function setAlignedToPlan(nextAligned: boolean) {
    setDraft((current) => ({
      ...current,
      isAlignedToPlan: nextAligned,
      title: nextAligned ? plan.title : current.title || plan.title,
      subject: nextAligned ? plan.subject : current.subject || plan.subject,
    }));
  }

  function applyMeasuredRange(startTime: string, endTime: string) {
    setDraft((current) => ({
      ...current,
      actualStartTime: startTime,
      actualEndTime: endTime,
    }));
    setError('');
  }

  async function handleSave() {
    if (minutesBetween(draft.actualStartTime, draft.actualEndTime) <= 0) {
      setError('実績の終了時刻は開始時刻より後にしてください。');
      return;
    }

    if (!draft.isAlignedToPlan && !draft.title.trim()) {
      setError('違う内容で記録する場合は、実際にやった内容を入れてください。');
      return;
    }

    setError('');
    await onSaveActual(plan, draft);
    setIsOpen(false);
  }

  return (
    <article className="plan-detail-card">
      <div className="plan-detail-head">
        <div>
          <div className="label-row">
            <strong>{plan.title}</strong>
            <span className="type-badge">{getPlanTypeLabel(plan.type)}</span>
          </div>
          <p className="comparison-subtitle">
            計画 {getPlanOccurrenceDate(plan)} / {plan.startTime} - {plan.endTime}
            {plan.subject ? ` / ${plan.subject}` : ''}
          </p>
          <p className="comparison-metrics">
            {actual
              ? `実績 ${actual.actualStartTime} - ${actual.actualEndTime} / ${
                  alignedToPlan
                    ? '予定通り'
                    : `実施内容: ${actualTitle}${actualSubject ? ` / ${actualSubject}` : ''}`
                } / 差分 ${
                  deltaMinutes && deltaMinutes !== 0
                    ? `${deltaMinutes > 0 ? '+' : ''}${formatMinutes(
                        Math.abs(deltaMinutes),
                      )}`
                    : 'ぴったり'
                }`
              : '実績未入力'}
          </p>
        </div>

        <div className="row-actions">
          <button
            className="mini-button"
            onClick={() => onEditPlan(plan)}
            type="button"
          >
            予定編集
          </button>
          <button
            className="mini-button danger"
            onClick={() => {
              if (
                isScopedRecurringPlan ||
                window.confirm('この予定を削除しますか？')
              ) {
                void onDeletePlan(plan);
              }
            }}
            type="button"
          >
            削除
          </button>
          {hideToggleButton ? null : (
            <button
              className="mini-button"
              onClick={() => setIsOpen((current) => !current)}
              type="button"
            >
              {isOpen ? '入力を閉じる' : actual ? '実績修正' : '実績入力'}
            </button>
          )}
        </div>
      </div>

      {plan.memo ? <p className="detail-note">{plan.memo}</p> : null}

      {isOpen ? (
        <div className="actual-form">
          <div className="form-grid compact">
            <label className="field">
              <span>実績開始</span>
              <input
                type="time"
                value={draft.actualStartTime}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    actualStartTime: event.target.value,
                  })
                }
              />
            </label>

            <label className="field">
              <span>実績終了</span>
              <input
                type="time"
                value={draft.actualEndTime}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    actualEndTime: event.target.value,
                  })
                }
              />
            </label>

            <label className="field field-full">
              <span>内容は予定通りですか</span>
              <div className="segmented-control">
                <button
                  className={draft.isAlignedToPlan ? 'segment active' : 'segment'}
                  onClick={() => setAlignedToPlan(true)}
                  type="button"
                >
                  予定通り
                </button>
                <button
                  className={!draft.isAlignedToPlan ? 'segment active' : 'segment'}
                  onClick={() => setAlignedToPlan(false)}
                  type="button"
                >
                  違う内容
                </button>
              </div>
            </label>

            {draft.isAlignedToPlan ? (
              <div className="assistant-feedback-card field-full">
                <strong>予定ベースで記録します</strong>
                <p className="detail-note">
                  内容: {plan.title}
                  {plan.subject ? ` / ${plan.subject}` : ''}
                </p>
              </div>
            ) : (
              <>
                <label className="field">
                  <span>実際にやった内容</span>
                  <input
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        title: event.target.value,
                      })
                    }
                    placeholder="例: 重要問題集 力学"
                  />
                </label>

                <label className="field">
                  <span>実際の科目</span>
                  <input
                    value={draft.subject}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        subject: event.target.value,
                      })
                    }
                    placeholder="例: 物理"
                  />
                </label>
              </>
            )}

            <label className="field field-full">
              <span>{draft.isAlignedToPlan ? 'メモ・気づき' : 'ズレの理由・メモ'}</span>
              <textarea
                value={draft.note}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    note: event.target.value,
                  })
                }
                rows={2}
                placeholder={
                  draft.isAlignedToPlan
                    ? 'つまずいた点や気づき'
                    : '予定との差分や実際にやったことの補足'
                }
              />
            </label>
          </div>

          <ActualTrackingTools onApplyMeasuredRange={applyMeasuredRange} />

          {error ? <p className="inline-error">{error}</p> : null}

          <div className="row-actions">
            {actual ? (
              <button
                className="ghost-button danger"
                onClick={() => {
                  if (window.confirm('この実績を削除しますか？')) {
                    void onDeleteActual(actual);
                  }
                }}
                type="button"
              >
                実績削除
              </button>
            ) : null}
            <button
              className="primary-button"
              onClick={() => void handleSave()}
              type="button"
            >
              実績を保存
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
