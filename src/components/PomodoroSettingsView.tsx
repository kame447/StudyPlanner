import { useState } from 'react';
import { POMODORO_MAX_SETS, type PomodoroSettings } from '../lib/pomodoroSession';

export function PomodoroSettingsView({ initialSettings, planned, onSave }: {
  initialSettings: PomodoroSettings;
  planned: boolean;
  onSave: (settings: PomodoroSettings) => void;
}) {
  const [draft, setDraft] = useState(initialSettings);
  return (
    <main className="study-session-content study-session-settings-view">
      <section className="study-session-card study-session-record-card">
        <h2>集中と休憩</h2>
        <div className="study-session-segments" role="group" aria-label="集中と休憩の時間">
          {(['25-5', '50-10'] as const).map(preset => (
            <button key={preset} type="button" className={draft.preset === preset ? 'active' : ''}
              aria-pressed={draft.preset === preset} onClick={() => setDraft(current => ({ ...current, preset }))}>
              {preset === '25-5' ? '25分 / 5分' : '50分 / 10分'}
            </button>
          ))}
        </div>
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
        <p>集中と休憩で1セット。休憩を含めて記録します。</p>
        {draft.setCount !== null ? <p>指定したセット数で計測が止まります。記録は終了後に確認して保存します。</p> : null}
      </section>
      <button type="button" className="study-session-save-button" onClick={() => onSave(draft)}>設定を保存</button>
    </main>
  );
}
