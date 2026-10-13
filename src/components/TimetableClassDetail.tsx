import { useState, type FormEvent } from 'react';
import { attendanceCounts, ATTENDANCE_LABELS, ATTENDANCE_STATUSES, type AttendanceStatus } from '../domain/classAttendance';
import { useClassAttendance } from '../hooks/useClassAttendance';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { todayIsoDate } from '../lib/date';
import { isIsoCalendarDate } from '../lib/timetableCalendar';
import type { ClassAttendanceRepository } from '../repositories/classAttendanceRepository';
import type { Plan, PlanDraft, ScheduleTemplate } from '../types/domain';
import { TimetableClassScheduleForm } from './TimetableClassScheduleForm';
import '../styles/timetable-class-detail.css';

const WEEKDAYS = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' };
type Panel = { kind: 'summary' } | { kind: 'attendance'; date: string; status: AttendanceStatus | null } | { kind: 'schedule' };

export function TimetableClassDetail({ template, plans, attendanceRepository, onEdit, onClose, onSavePlan }: {
  template: ScheduleTemplate;
  plans: readonly Plan[];
  attendanceRepository: ClassAttendanceRepository;
  onEdit: () => void;
  onClose: () => void;
  onSavePlan?: (draft: PlanDraft) => Promise<void>;
}) {
  const attendance = useClassAttendance(template.userId, template.id, attendanceRepository);
  const [panel, setPanel] = useState<Panel>({ kind: 'summary' });
  const { dialogRef, initialFocusRef } = useDialogFocus<HTMLElement>(true, () => {
    if (panel.kind !== 'summary') setPanel({ kind: 'summary' }); else onClose();
  });
  const counts = attendanceCounts(attendance.records);
  const schedules = plans.filter(plan => plan.userId === template.userId && plan.classTemplateId === template.id)
    .slice().sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const upcoming = schedules.filter(plan => plan.date >= todayIsoDate());
  const past = schedules.filter(plan => plan.date < todayIsoDate()).reverse();
  function openAttendance(date = todayIsoDate()) {
    setPanel({ kind: 'attendance', date, status: attendance.records.find(row => row.date === date)?.status ?? null });
  }
  async function saveAttendance(event: FormEvent) {
    event.preventDefault();
    if (panel.kind !== 'attendance' || !panel.status) return;
    const saved = await attendance.save(panel.date, panel.status);
    if (saved) setPanel({ kind: 'summary' });
  }
  function scheduleList(items: Plan[]) {
    return <ul className="class-schedule-list">{items.map(plan => <li key={plan.id}>
      <div><strong>{plan.title}</strong><span>{plan.date.split('-').join('/')} · {plan.startTime}–{plan.endTime}</span></div>
      <span className="class-schedule-kind">{plan.type === 'deadline' ? '提出' : plan.type === 'mock-exam' ? '試験' : '予定'}</span>
    </li>)}</ul>;
  }
  return <div className="overlay modal-overlay timetable-modal-overlay" onClick={onClose}>
    <section className="modal-card timetable-editor-modal timetable-class-detail" ref={dialogRef} tabIndex={-1}
      role="dialog" aria-modal="true" aria-label={`${template.title}の詳細`} onClick={event => event.stopPropagation()}>
      <header className="timetable-editor-header">
        <button className="ghost-button" ref={node => { initialFocusRef.current = node; }} type="button" onClick={onClose}>閉じる</button>
        <div className="timetable-editor-heading"><h2>{template.title}</h2></div>
        <button className="ghost-button" type="button" onClick={onEdit}>編集</button>
      </header>
      <div className="timetable-editor-body class-detail-body">
        <div className="class-detail-summary"><strong>{WEEKDAYS[template.weekday]}曜 · {template.periodNumber ? `${template.periodNumber}限 · ` : ''}{template.startTime}–{template.endTime}</strong>
          {(template.subject || template.classroom) ? <p>{[template.subject, template.classroom].filter(Boolean).join(' · ')}</p> : null}
          {(template.weekInterval === 2 || (template.alternatingWeek && template.alternatingWeek !== 'both')) ? <p>{[template.weekInterval === 2 ? '隔週' : '', template.alternatingWeek === 'a' ? 'A週' : template.alternatingWeek === 'b' ? 'B週' : ''].filter(Boolean).join(' · ')}</p> : null}
        </div>
        <section className="class-detail-section" aria-label="出欠管理">
          <div className="class-detail-section-heading"><h3>出欠</h3><button className="ghost-button" type="button" disabled={attendance.kind !== 'ready' || attendance.saving}
            onClick={() => openAttendance()}>記録</button></div>
          {attendance.kind === 'loading' ? <p role="status">出欠を読み込み中…</p> : attendance.kind === 'error' ? <div><p role="alert">{attendance.message}</p><button className="ghost-button" type="button" onClick={attendance.retry}>再読み込み</button></div> : <>
            <dl className="class-attendance-counts">{ATTENDANCE_STATUSES.map(status => <div key={status}><dt>{ATTENDANCE_LABELS[status]}</dt><dd>{counts[status]}</dd></div>)}</dl>
            {panel.kind === 'attendance' ? <form className="class-detail-form" aria-label="出欠を記録" onSubmit={saveAttendance}>
              <label className="field"><span>実施日</span><input type="date" value={panel.date} disabled={attendance.saving} required onChange={event => openAttendance(event.target.value)} /></label>
              <div className="class-attendance-options" role="group" aria-label="出欠の状態">{ATTENDANCE_STATUSES.map(status => <button key={status} type="button" disabled={attendance.saving}
                className={`segment${panel.status === status ? ' active' : ''}`} aria-pressed={panel.status === status}
                onClick={() => setPanel({ ...panel, status })}>{ATTENDANCE_LABELS[status]}</button>)}</div>
              {attendance.records.some(row => row.date === panel.date) ? <small>この日の記録を更新します。</small> : null}
              {attendance.saveError ? <p role="alert">{attendance.saveError}</p> : null}
              <div className="class-detail-form-actions"><button className="ghost-button" type="button" disabled={attendance.saving} onClick={() => setPanel({ kind: 'summary' })}>キャンセル</button>
                <button className="primary-button" type="submit" disabled={attendance.saving || !panel.status || !isIsoCalendarDate(panel.date)}>{attendance.saving ? '保存中…' : '保存'}</button></div>
            </form> : null}
            {attendance.records.length > 0 ? <details className="class-detail-history"><summary>履歴 {attendance.records.length}件</summary>
              <ul>{attendance.records.map(record => <li key={record.date}><button type="button" disabled={attendance.saving} onClick={() => openAttendance(record.date)} aria-label={`${record.date} ${ATTENDANCE_LABELS[record.status]}を訂正`}>
                <time dateTime={record.date}>{record.date.split('-').join('/')}</time><span>{ATTENDANCE_LABELS[record.status]}</span><span aria-hidden="true">›</span>
              </button></li>)}</ul>
            </details> : null}
          </>}
        </section>
        <section className="class-detail-section" aria-label="授業の予定">
          <div className="class-detail-section-heading"><h3>予定</h3>{onSavePlan ? <button className="ghost-button" type="button" disabled={attendance.saving} onClick={() => setPanel({ kind: 'schedule' })}>追加</button> : null}</div>
          {panel.kind === 'schedule' && onSavePlan ? <TimetableClassScheduleForm template={template} onSave={onSavePlan} onClose={() => setPanel({ kind: 'summary' })} /> : null}
          {upcoming.length ? scheduleList(upcoming) : <p className="class-detail-empty">これからの予定はありません</p>}
          {past.length ? <details className="class-detail-history"><summary>過去の予定 {past.length}件</summary>{scheduleList(past)}</details> : null}
        </section>
        {template.memo ? <details className="class-detail-section class-detail-memo"><summary>授業メモ</summary><p>{template.memo}</p></details> : null}
      </div>
    </section>
  </div>;
}
