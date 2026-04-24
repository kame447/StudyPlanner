import { useEffect, useState } from 'react';
import { formatMinutes } from '../lib/date';
import type { DayNote, DayNoteDraft, EvaluationSummary } from '../types/domain';

interface DayNotebookPanelProps {
  dayNote: DayNote | DayNoteDraft;
  plannedMinutes?: number;
  actualMinutes?: number;
  actualCount?: number;
  planCount?: number;
  evaluation?: EvaluationSummary;
  planDeltaMinutes?: number;
  displayedScheduleCount?: number;
  onSave: (draft: DayNoteDraft) => Promise<void>;
  compact?: boolean;
}

function toDayNoteDraft(dayNote: DayNote | DayNoteDraft): DayNoteDraft {
  return {
    userId: dayNote.userId,
    date: dayNote.date,
    quickMemo: dayNote.quickMemo,
    reflection: dayNote.reflection,
    nextFocus: dayNote.nextFocus,
    checkedPlan: dayNote.checkedPlan,
    checkedRecord: dayNote.checkedRecord,
    checkedReady: dayNote.checkedReady,
  };
}

export function DayNotebookPanel({
  dayNote,
  plannedMinutes,
  actualMinutes,
  actualCount,
  planCount,
  evaluation,
  planDeltaMinutes = 0,
  displayedScheduleCount = 0,
  onSave,
  compact = false,
}: DayNotebookPanelProps) {
  const [draft, setDraft] = useState<DayNoteDraft>(toDayNoteDraft(dayNote));
  const [status, setStatus] = useState('');
  const dayNoteIdentity = 'id' in dayNote ? dayNote.id : `${dayNote.userId}:${dayNote.date}`;

  useEffect(() => {
    setDraft(toDayNoteDraft(dayNote));
    setStatus('');
  }, [
    dayNoteIdentity,
    dayNote.quickMemo,
    dayNote.reflection,
    dayNote.nextFocus,
    dayNote.checkedPlan,
    dayNote.checkedRecord,
    dayNote.checkedReady,
  ]);

  const completionRate =
    (plannedMinutes ?? 0) === 0
      ? (actualMinutes ?? 0) > 0
        ? 100
        : 0
      : Math.min(
          Math.round(((actualMinutes ?? 0) / (plannedMinutes ?? 0)) * 100),
          100,
        );

  let progressLabel = 'これから';

  if (completionRate >= 90) {
    progressLabel = 'よく進んだ日';
  } else if (completionRate >= 60) {
    progressLabel = 'おおむね順調';
  } else if ((planCount ?? 0) > 0) {
    progressLabel = '少し立て直し';
  }

  async function handleSave() {
    await onSave(draft);
    setStatus('保存しました。');
  }

  if (compact) {
    return (
      <section className="panel notebook-panel notebook-panel-compact">
        <div className="section-header">
          <div>
            <h2>メモ</h2>
          </div>
        </div>

        <label className="field field-full">
          <span>今日のメモ</span>
          <textarea
            value={draft.quickMemo}
            onChange={(event) =>
              setDraft({
                ...draft,
                quickMemo: event.target.value,
              })
            }
            rows={3}
            placeholder="今日の予定や気づきを短く残す"
          />
        </label>

        <div className="row-actions">
          <button className="ghost-button" onClick={() => void handleSave()} type="button">
            メモを保存
          </button>
          {status ? <span className="inline-note">{status}</span> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="panel notebook-panel">
      <div className="section-header">
        <div>
          <h2>今日の記録</h2>
          <p>手帳の余白のように、進み具合と振り返りを1か所に残します。</p>
        </div>
      </div>

      <div className="notebook-summary-grid">
        <div className="summary-chip">
          <span>予定</span>
          <strong>{formatMinutes(plannedMinutes ?? 0)}</strong>
        </div>
        <div className="summary-chip">
          <span>実績</span>
          <strong>{formatMinutes(actualMinutes ?? 0)}</strong>
        </div>
        <div className="summary-chip">
          <span>達成度</span>
          <strong>{evaluation?.achievement ?? 0}%</strong>
        </div>
        <div className="summary-chip">
          <span>差分</span>
          <strong>
            {planDeltaMinutes === 0
              ? '±0'
              : `${planDeltaMinutes > 0 ? '+' : '-'}${formatMinutes(
                  Math.abs(planDeltaMinutes),
                )}`}
          </strong>
        </div>
        <div className="summary-chip">
          <span>予定件数</span>
          <strong>{displayedScheduleCount}件</strong>
        </div>
      </div>

      <div className="notebook-topline">
        <div className="summary-chip notebook-chip">
          <span>合計勉強時間</span>
          <strong>{formatMinutes(actualMinutes ?? 0)}</strong>
        </div>
        <div className="summary-chip notebook-chip">
          <span>達成状況</span>
          <strong>{progressLabel}</strong>
        </div>
        <div className="summary-chip notebook-chip">
          <span>記録済み</span>
          <strong>
            {actualCount ?? 0}/{planCount ?? 0}
          </strong>
        </div>
      </div>

      <div className="progress-card">
        <div className="label-row">
          <strong>今日の進み具合</strong>
          <span>{completionRate}%</span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${completionRate}%` }}
          />
        </div>
        <p className="detail-note">{evaluation?.comment ?? ''}</p>
      </div>

      <div className="check-grid">
        <label className="check-card">
          <input
            type="checkbox"
            checked={draft.checkedPlan}
            onChange={(event) =>
              setDraft({
                ...draft,
                checkedPlan: event.target.checked,
              })
            }
          />
          <span>計画どおり進める意識ができた</span>
        </label>
        <label className="check-card">
          <input
            type="checkbox"
            checked={draft.checkedRecord}
            onChange={(event) =>
              setDraft({
                ...draft,
                checkedRecord: event.target.checked,
              })
            }
          />
          <span>実績をその日のうちに記録した</span>
        </label>
        <label className="check-card">
          <input
            type="checkbox"
            checked={draft.checkedReady}
            onChange={(event) =>
              setDraft({
                ...draft,
                checkedReady: event.target.checked,
              })
            }
          />
          <span>明日の準備や見直しをした</span>
        </label>
      </div>

      <div className="form-grid day-note-grid">
        <label className="field field-full">
          <span>メモ</span>
          <textarea
            value={draft.quickMemo}
            onChange={(event) =>
              setDraft({
                ...draft,
                quickMemo: event.target.value,
              })
            }
            rows={3}
            placeholder="今日は何を中心に進めたか"
          />
        </label>

        <label className="field">
          <span>振り返り</span>
          <textarea
            value={draft.reflection}
            onChange={(event) =>
              setDraft({
                ...draft,
                reflection: event.target.value,
              })
            }
            rows={4}
            placeholder="うまくいった点、ズレた点"
          />
        </label>

        <label className="field">
          <span>明日への一言</span>
          <textarea
            value={draft.nextFocus}
            onChange={(event) =>
              setDraft({
                ...draft,
                nextFocus: event.target.value,
              })
            }
            rows={4}
            placeholder="次に意識したいこと"
          />
        </label>
      </div>

      <div className="row-actions">
        <button className="primary-button" onClick={() => void handleSave()} type="button">
          日次メモを保存
        </button>
        {status ? <span className="inline-note">{status}</span> : null}
      </div>
    </section>
  );
}
