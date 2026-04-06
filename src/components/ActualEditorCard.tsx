import { useEffect, useState } from 'react';
import { formatMinutes, minutesBetween } from '../lib/date';
import { getPlanTypeLabel } from '../lib/plans';
import type { Actual, ActualDraft, Plan } from '../types/domain';

interface ActualEditorCardProps {
  plan: Plan;
  actual?: Actual;
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
}

function buildDraft(plan: Plan, actual?: Actual): ActualDraft {
  return {
    userId: plan.userId,
    planId: plan.id,
    actualStartTime: actual?.actualStartTime ?? plan.startTime,
    actualEndTime: actual?.actualEndTime ?? plan.endTime,
    subject: actual?.subject ?? plan.subject,
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
}: ActualEditorCardProps) {
  const [draft, setDraft] = useState<ActualDraft>(buildDraft(plan, actual));
  const [isOpen, setIsOpen] = useState(!actual);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(buildDraft(plan, actual));
    setError('');
  }, [actual?.id, plan]);

  const planMinutes = minutesBetween(plan.startTime, plan.endTime);
  const actualMinutes = actual
    ? minutesBetween(actual.actualStartTime, actual.actualEndTime)
    : 0;
  const deltaMinutes = actual ? actualMinutes - planMinutes : null;

  async function handleSave() {
    if (minutesBetween(draft.actualStartTime, draft.actualEndTime) <= 0) {
      setError('実績の終了時刻は開始時刻より後にしてください。');
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
            計画 {plan.startTime} - {plan.endTime}
            {plan.subject ? ` / ${plan.subject}` : ''}
          </p>
          <p className="comparison-metrics">
            {actual
              ? `実績 ${actual.actualStartTime} - ${actual.actualEndTime} / 差分 ${
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
              if (window.confirm('この予定を削除しますか？')) {
                onDeletePlan(plan).catch(() => undefined);
              }
            }}
            type="button"
          >
            削除
          </button>
          <button
            className="mini-button"
            onClick={() => setIsOpen((current) => !current)}
            type="button"
          >
            {isOpen ? '入力を閉じる' : actual ? '実績修正' : '実績入力'}
          </button>
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

            <label className="field">
              <span>実績科目</span>
              <input
                value={draft.subject}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    subject: event.target.value,
                  })
                }
                placeholder="省略可"
              />
            </label>

            <label className="field field-full">
              <span>実績メモ</span>
              <textarea
                value={draft.note}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    note: event.target.value,
                  })
                }
                rows={2}
                placeholder="やった内容やズレの理由"
              />
            </label>
          </div>

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
