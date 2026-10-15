import { useState } from 'react';
import { POMODORO_MAX_SETS, POMODORO_MAX_MINUTES, isValidPomodoroMinutes, type PomodoroSettings } from '../lib/pomodoroSession';

export function PomodoroSettingsView({ initialSettings, planned, onSave }: {
  initialSettings: PomodoroSettings;
  planned: boolean;
  onSave: (settings: PomodoroSettings) => void;
}) {
  const [draft, setDraft] = useState(initialSettings);
  const [focusInput, setFocusInput] = useState(String(initialSettings.customFocusMinutes ?? (initialSettings.preset === '50-10' ? 50 : 25)));
  const [breakInput, setBreakInput] = useState(String(initialSettings.customBreakMinutes ?? (initialSettings.preset === '50-10' ? 10 : 5)));
  const validCustom = isValidPomodoroMinutes(Number(focusInput)) && isValidPomodoroMinutes(Number(breakInput));
  const canSave = draft.preset !== 'custom' || validCustom;
  function save() {
    if (!canSave) return;
    onSave(validCustom ? { ...draft, customFocusMinutes: Number(focusInput), customBreakMinutes: Number(breakInput) } : draft);
  }
  return (
    <main className="study-session-content study-session-settings-view">
      <section className="study-session-card study-session-record-card">
        <h2>集中と休憩</h2>
        <div className="study-session-segments study-session-pomodoro-presets" role="group" aria-label="集中と休憩の時間">
          {(['25-5', '50-10', 'custom'] as const).map(preset => (
            <button key={preset} type="button" className={draft.preset === preset ? 'active' : ''}
              aria-pressed={draft.preset === preset} onClick={() => setDraft(current => ({ ...current, preset }))}>
              {preset === '25-5' ? '25分 / 5分' : preset === '50-10' ? '50分 / 10分' : 'カスタム'}
            </button>
          ))}
        </div>
        {draft.preset === 'custom' ? <div className="study-session-field-grid">
          <label>集中（分）
            <input type="number" inputMode="numeric" aria-label="集中（分）" min={1} max={POMODORO_MAX_MINUTES} step={1}
              value={focusInput} aria-invalid={!isValidPomodoroMinutes(Number(focusInput))} onChange={event => setFocusInput(event.target.value)} />
          </label>
          <label>休憩（分）
            <input type="number" inputMode="numeric" aria-label="休憩（分）" min={1} max={POMODORO_MAX_MINUTES} step={1}
              value={breakInput} aria-invalid={!isValidPomodoroMinutes(Number(breakInput))} onChange={event => setBreakInput(event.target.value)} />
          </label>
          {!validCustom ? <p role="alert">集中と休憩は1〜1440分の整数で入力してください。</p> : null}
        </div> : null}
        <div className="study-session-field-grid">
          <label className="study-session-target-choice">セット数
            <select aria-label="セット数" value={draft.setCount ?? ''} onChange={event => {
              const setCount = event.target.value === '' ? null : Number(event.target.value);
              setDraft(current => ({ ...current, setCount }));
            }}>
              <option value="">{planned ? '目安（予定時間に合わせる）' : '制限なし'}</option>
              {Array.from({ length: POMODORO_MAX_SETS }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count}セット</option>)}
            </select>
          </label>
        </div>
      </section>
      <button type="button" className="study-session-save-button" disabled={!canSave} onClick={save}>設定を保存</button>
    </main>
  );
}
