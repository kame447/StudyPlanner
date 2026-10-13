import { useEffect, useRef, useState, type FormEvent } from 'react';
import { todayIsoDate } from '../lib/date';
import { isIsoCalendarDate } from '../lib/timetableCalendar';
import type { PlanDraft, PlanType, ScheduleTemplate } from '../types/domain';

export function TimetableClassScheduleForm({ template, onSave, onClose }: {
  template: ScheduleTemplate;
  onSave: (draft: PlanDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayIsoDate);
  const [category, setCategory] = useState<PlanType>('deadline');
  const [startTime, setStartTime] = useState(template.startTime);
  const [endTime, setEndTime] = useState(template.endTime);
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const valid = title.trim() && isIsoCalendarDate(date) && validTime(startTime) && validTime(endTime) && endTime > startTime;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !valid) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave({ userId: template.userId, classTemplateId: template.id, title: title.trim(),
        subject: template.subject, date, startTime, endTime, type: category, memo: memo.trim(),
        repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], sourceType: 'manual' });
      if (mounted.current) onClose();
    } catch {
      if (mounted.current) setError('予定を保存できませんでした。入力を確認して、もう一度お試しください。');
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return <form className="class-detail-form" aria-label="授業の予定を追加" onSubmit={submit}>
    <label className="field"><span>予定名</span><input autoFocus disabled={saving} value={title}
      placeholder="レポート提出、中間試験など" onChange={event => setTitle(event.target.value)} required /></label>
    <div className="class-detail-form-row">
      <label className="field"><span>日付</span><input disabled={saving} type="date" value={date} onChange={event => setDate(event.target.value)} required /></label>
      <label className="field"><span>種類</span><select disabled={saving} value={category} onChange={event => setCategory(event.target.value as PlanType)}>
        <option value="deadline">課題・提出</option><option value="mock-exam">試験</option><option value="other">その他</option>
      </select></label>
    </div>
    <div className="class-detail-form-row">
      <label className="field"><span>開始</span><input disabled={saving} type="time" value={startTime} onChange={event => setStartTime(event.target.value)} required /></label>
      <label className="field"><span>終了</span><input disabled={saving} type="time" value={endTime} onChange={event => setEndTime(event.target.value)} required /></label>
    </div>
    {startTime && endTime && endTime <= startTime ? <p role="alert">終了を開始より後にしてください。</p> : null}
    <label className="field"><span>メモ（任意）</span><textarea disabled={saving} rows={2} value={memo} onChange={event => setMemo(event.target.value)} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <div className="class-detail-form-actions"><button className="ghost-button" type="button" disabled={saving} onClick={onClose}>キャンセル</button>
      <button className="primary-button" type="submit" disabled={saving || !valid}>{saving ? '保存中…' : '予定を追加'}</button></div>
  </form>;
}
