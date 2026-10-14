import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Flame, ShieldCheck, Ticket } from 'lucide-react';
import { addDays, addMonths, formatMonthLabel, getMonthGrid, getWeekdayLabels, startOfMonth } from '../lib/date';
import type { StudyStreakModel } from '../lib/studyStreak';
import '../styles/study-streak.css';

export type StudyStreakDisplayModel = Pick<StudyStreakModel,
  'currentStreak' | 'bestStreak' | 'historyComplete' | 'studyDates' | 'protectedDates'
  | 'unprotectedRestDates' | 'availableTickets' | 'studyDaysTowardNextTicket'>;

export interface StudyStreakViewProps {
  today: string;
  model: StudyStreakDisplayModel;
  onClose: () => void;
  pending?: boolean;
  error?: string | null;
  onRetry?: () => void;
  restDayActions?: {
    saving: boolean;
    error?: string | null;
    blockReason: (date: string) => string | null;
    onUse: (date: string) => Promise<boolean>;
  };
}

export function StudyStreakView({ today, model, onClose, pending = false, error, onRetry, restDayActions }: StudyStreakViewProps) {
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [restDate, setRestDate] = useState(() => addDays(today, -1));
  const [useError, setUseError] = useState('');
  const [useNotice, setUseNotice] = useState('');
  const usePending = useRef(false);
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const restBlockReason = restDayActions?.blockReason(restDate) ?? null;
  const titleId = useId();
  const monthId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const studyDates = new Set(model.studyDates);
  const protectedDates = new Set(model.protectedDates);
  const unprotectedDates = new Set(model.unprotectedRestDates ?? []);
  const grid = getMonthGrid(month);
  const rows = Array.from({ length: 6 }, (_, index) => grid.slice(index * 7, index * 7 + 7))
    .filter(row => row.some(cell => cell.inCurrentMonth));
  const currentMonth = startOfMonth(today);
  useLayoutEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);

  return <main className="study-streak-page" aria-labelledby={titleId} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  }}>
    <div className="study-streak-content">
      <header className="study-streak-header">
        <button className="study-streak-control" type="button" onClick={onClose} aria-label="戻る">
          <ArrowLeft size={24} aria-hidden="true" />
        </button>
        <h1 id={titleId} ref={titleRef} tabIndex={-1}>学習記録</h1>
        <span aria-hidden="true" />
      </header>

      <section className={`study-streak-hero${!model.currentStreak ? ' is-empty' : ''}`} aria-label="連続学習">
        <div className="study-streak-hero-copy">
          <p><strong>{model.currentStreak ?? '—'}</strong><span>日</span></p>
          <h2>連続学習</h2>
          <span className="study-streak-best">最高 {model.bestStreak ?? '—'}日</span>
        </div>
        <Flame className="study-streak-hero-flame" size={104} strokeWidth={1.3} aria-hidden="true" />
      </section>

      <dl className="study-streak-summary">
        <div><dt><span className="study-streak-legend-study" aria-hidden="true" />学習日数</dt><dd>{model.historyComplete ? model.studyDates.length : '—'}<span>日</span></dd></div>
        <div><dt><ShieldCheck size={18} aria-hidden="true" />お休み日数</dt><dd>{pending || !model.historyComplete ? '—' : model.protectedDates.length}<span>日</span></dd></div>
      </dl>

      <section className="study-streak-calendar" aria-labelledby={monthId}>
        <header className="study-streak-calendar-header">
          <h2 id={monthId} aria-live="polite">{formatMonthLabel(month)}</h2>
          <div className="study-streak-calendar-controls">
            <button className="study-streak-control" type="button" aria-label="前の月" onClick={() => setMonth(value => addMonths(value, -1))}><ChevronLeft size={22} aria-hidden="true" /></button>
            <button className="study-streak-control" type="button" aria-label="次の月" disabled={month >= currentMonth} onClick={() => setMonth(value => value < currentMonth ? addMonths(value, 1) : value)}><ChevronRight size={22} aria-hidden="true" /></button>
            <button className="study-streak-today" type="button" onClick={() => setMonth(currentMonth)}>今日</button>
          </div>
        </header>
        <table aria-labelledby={monthId}>
          <thead><tr>{getWeekdayLabels().map(day => <th key={day} scope="col">{day}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row[0].date}>{row.map(cell => {
            if (!cell.inCurrentMonth) return <td key={cell.date} aria-hidden="true" />;
            const kind = studyDates.has(cell.date) ? 'study' : protectedDates.has(cell.date) ? 'protected' : unprotectedDates.has(cell.date) ? 'unprotected' : 'empty';
            const label = kind === 'study' ? '学習した日' : kind === 'protected' ? 'お休みチケット使用' : kind === 'unprotected' ? 'お休みチケットの再確認が必要' : cell.date > today ? 'これから' : model.historyComplete ? '記録なし' : '確認中';
            const [year, monthNumber, day] = cell.date.split('-').map(Number);
            return <td key={cell.date} className={`study-streak-day is-${kind}${cell.date > today ? ' is-future' : ''}`}
              aria-label={`${year}年${monthNumber}月${day}日、${label}${cell.date === today ? '、今日' : ''}`}>
              <span className="study-streak-day-mark" aria-current={cell.date === today ? 'date' : undefined}>
                <span>{day}</span>
              </span>
            </td>;
          })}</tr>)}</tbody>
        </table>
        <div className="study-streak-legend" aria-label="カレンダーの凡例">
          <span><i className="study-streak-legend-study" aria-hidden="true" />学習</span>
          <span><i className="study-streak-legend-rest" aria-hidden="true" />お休みチケット</span>
        </div>
      </section>

      <section className="study-streak-tickets" aria-label="お休みチケット">
        <Ticket size={28} aria-hidden="true" />
        <div><h2>お休みチケット</h2>
          {model.studyDaysTowardNextTicket !== null && !pending && !error ? <p>次の1枚まで {7 - model.studyDaysTowardNextTicket}日</p> : null}
        </div>
        <strong aria-label={`お休みチケット ${pending || model.availableTickets === null ? '確認中' : `${model.availableTickets}枚`}`}>
          {pending || model.availableTickets === null ? '—' : model.availableTickets}<span>枚</span>
        </strong>
      </section>
      {model.historyComplete && !pending && !error && unprotectedDates.size > 0 ? <p className="study-streak-use-note" role="status">
        学習記録の変更により、お休み{unprotectedDates.size}日分を連続学習に含められません（{[...unprotectedDates].slice(0, 3).map(date => date.split('-').join('/')).join('、')}{unprotectedDates.size > 3 ? ' ほか' : ''}）。点線の日を確認してください。
      </p> : null}
      {restDayActions && !pending && !error ? <section className="study-streak-use" aria-label="お休みチケットを使う">
        <div className="study-streak-use-controls">
          <label>お休みする日<input type="date" value={restDate} max={today} disabled={restDayActions.saving}
            onChange={event => { if (!usePending.current) { setRestDate(event.target.value); setUseNotice(''); setUseError(''); } }} /></label>
          <button type="button" className="study-streak-today" disabled={restDayActions.saving || Boolean(restBlockReason)} onClick={async () => {
            if (usePending.current || restDayActions.saving || restBlockReason) return;
            usePending.current = true;
            setUseError('');
            try {
              const saved = await restDayActions.onUse(restDate);
              if (saved && mounted.current) setUseNotice('お休みチケットを使いました。');
            } catch {
              if (mounted.current) setUseError('保存を確認できませんでした。再読み込みして確認してください。');
            } finally { usePending.current = false; }
          }}>{restDayActions.saving ? '保存中…' : 'チケットを使う'}</button>
        </div>
        {restDayActions.error || useError ? <p className="study-streak-error" role="alert">{restDayActions.error || useError}</p>
          : useNotice ? <p className="study-streak-status" role="status">{useNotice}</p>
          : restBlockReason ? <p className="study-streak-use-note">{restBlockReason}</p> : null}
      </section> : null}
      {pending ? <p className="study-streak-status" role="status">記録を確認しています…</p> : null}
      {error ? <div className="study-streak-error" role="alert"><p>{error}</p>{onRetry ? <button className="study-streak-today" type="button" onClick={onRetry}>再読み込み</button> : null}</div> : null}
    </div>
  </main>;
}
