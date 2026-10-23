import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ShieldCheck, Ticket } from 'lucide-react';
import { StudyStreakFlame } from './StudyStreakFlame';
import { usePeriodNavigationMotion } from '../hooks/usePeriodNavigationMotion';
import { addMonths, formatMonthLabel, getMonthGrid, getWeekdayLabels, startOfMonth } from '../lib/date';
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
  refreshing?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function StudyStreakView({ today, model, onClose, pending = false, refreshing = false, error, onRetry }: StudyStreakViewProps) {
  const [month, setMonth] = useState(() => startOfMonth(today));
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
  // Another month slides in from the side the user moved toward.
  const calendarRef = useRef<HTMLTableElement | null>(null);
  usePeriodNavigationMotion(calendarRef, month);
  useLayoutEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return <main className="study-streak-page" aria-labelledby={titleId} aria-busy={pending || refreshing} onKeyDown={event => {
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
        <StudyStreakFlame className="study-streak-hero-flame" size={64} studiedToday={studyDates.has(today)} />
      </section>

      <dl className="study-streak-summary">
        <div><dt><span className="study-streak-legend-study" aria-hidden="true" />学習日数</dt><dd>{model.historyComplete ? model.studyDates.length : '—'}<span>日</span></dd></div>
        <div><dt><ShieldCheck size={18} aria-hidden="true" />お休み日数</dt><dd>{!model.historyComplete ? '—' : model.protectedDates.length}<span>日</span></dd></div>
        <div><dt><Ticket size={16} aria-hidden="true" />お休み券</dt><dd aria-label={`お休みチケット ${model.availableTickets === null ? '確認中' : `${model.availableTickets}枚`}`}>
          {model.availableTickets === null ? '—' : model.availableTickets}<span>枚</span>
        </dd></div>
      </dl>

      <section className="study-streak-calendar" aria-labelledby={monthId} style={{ '--streak-week-count': rows.length } as CSSProperties}>
        <header className="study-streak-calendar-header">
          <h2 id={monthId} aria-live="polite">{formatMonthLabel(month)}</h2>
          <div className="study-streak-calendar-controls">
            <button className="study-streak-control" type="button" aria-label="前の月" onClick={() => setMonth(value => addMonths(value, -1))}><ChevronLeft size={22} aria-hidden="true" /></button>
            <button className="study-streak-control" type="button" aria-label="次の月" disabled={month >= currentMonth} onClick={() => setMonth(value => value < currentMonth ? addMonths(value, 1) : value)}><ChevronRight size={22} aria-hidden="true" /></button>
            <button className="study-streak-today" type="button" onClick={() => setMonth(currentMonth)}>今日</button>
          </div>
        </header>
        <table ref={calendarRef} aria-labelledby={monthId}>
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

      {model.studyDaysTowardNextTicket !== null && !error ? <p className="study-streak-ticket-note">
        <span>次の1枚まで {7 - model.studyDaysTowardNextTicket}日</span>
      </p> : null}
      {model.historyComplete && !error && unprotectedDates.size > 0 ? <p className="study-streak-use-note" role="status">
        学習記録の変更により、お休み{unprotectedDates.size}日分を連続学習に含められません（{[...unprotectedDates].slice(0, 3).map(date => date.split('-').join('/')).join('、')}{unprotectedDates.size > 3 ? ' ほか' : ''}）。点線の日を確認してください。
      </p> : null}
      {pending && !model.historyComplete ? <p className="study-streak-status" role="status">記録を確認しています…</p> : null}
      {error ? <div className="study-streak-error" role="alert"><p>{error}</p>{onRetry ? <button className="study-streak-today" type="button" onClick={onRetry}>再読み込み</button> : null}</div> : null}
    </div>
  </main>;
}
