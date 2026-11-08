import { useState } from 'react';
import { Timer } from 'lucide-react';
import { POMODORO_MAX_MINUTES, isValidPomodoroMinutes } from '../lib/pomodoroSession';
import { useWeeklyPlanningPersonalization } from '../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext';

const PRESET_MINUTES = { '25-5': [25, 5], '50-10': [50, 10] } as const;

/** The study mode a session starts in. The start screen can still override it for one session. */
export function DefaultStudyModeSetting() {
  const { defaultStudyMode, setDefaultStudyMode, saving } = useWeeklyPlanningPersonalization();
  const { mode, pomodoro } = defaultStudyMode;
  const [customOpen, setCustomOpen] = useState(pomodoro.preset === 'custom');
  const [focusInput, setFocusInput] = useState(String(pomodoro.customFocusMinutes ?? 25));
  const [breakInput, setBreakInput] = useState(String(pomodoro.customBreakMinutes ?? 5));
  const focusMinutes = Number(focusInput);
  const breakMinutes = Number(breakInput);
  const validCustom = isValidPomodoroMinutes(focusMinutes) && isValidPomodoroMinutes(breakMinutes);
  const showCustom = customOpen || pomodoro.preset === 'custom';
  const choice = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} type="button" disabled={saving} aria-pressed={active} onClick={onClick}>{label}</button>
  );

  return <div className="settings-row-block">
    <div className="settings-row">
      <span className="settings-field-label" id="settings-study-mode-label"><Timer aria-hidden="true" size={21} />既定の学習方式</span>
      <div className="settings-segments" role="group" aria-labelledby="settings-study-mode-label" aria-busy={saving}>
        {choice('通常タイマー', mode === 'normal', () => void setDefaultStudyMode({ mode: 'normal', pomodoro }))}
        {choice('ポモドーロ', mode === 'pomodoro', () => void setDefaultStudyMode({ mode: 'pomodoro', pomodoro }))}
      </div>
    </div>
    {mode === 'pomodoro' ? <>
      <div className="settings-row">
        <span className="settings-field-label" id="settings-pomodoro-length-label">集中と休憩</span>
        <div className="settings-segments" role="group" aria-labelledby="settings-pomodoro-length-label">
          {(['25-5', '50-10'] as const).map(preset => choice(
            `${PRESET_MINUTES[preset][0]}分 / ${PRESET_MINUTES[preset][1]}分`,
            !showCustom && pomodoro.preset === preset,
            () => { setCustomOpen(false); void setDefaultStudyMode({ mode, pomodoro: { preset } }); },
          ))}
          {choice('カスタム', showCustom, () => setCustomOpen(true))}
        </div>
      </div>
      {showCustom ? <div className="settings-row">
        <label className="settings-field-label">集中（分）
          <input type="number" inputMode="numeric" aria-label="集中（分）" min={1} max={POMODORO_MAX_MINUTES} step={1}
            value={focusInput} aria-invalid={!isValidPomodoroMinutes(focusMinutes)} onChange={event => setFocusInput(event.target.value)} />
        </label>
        <label className="settings-field-label">休憩（分）
          <input type="number" inputMode="numeric" aria-label="休憩（分）" min={1} max={POMODORO_MAX_MINUTES} step={1}
            value={breakInput} aria-invalid={!isValidPomodoroMinutes(breakMinutes)} onChange={event => setBreakInput(event.target.value)} />
        </label>
        <button type="button" disabled={saving || !validCustom} onClick={() => void setDefaultStudyMode({
          mode, pomodoro: { preset: 'custom', customFocusMinutes: focusMinutes, customBreakMinutes: breakMinutes },
        })}>保存</button>
        {!validCustom ? <p className="settings-inline-error" role="alert">集中と休憩は1〜1440分の整数で入力してください。</p> : null}
      </div> : null}
    </> : null}
    <p className="settings-group-note">学習を始めるときの初期の選択です。開始前に、その回だけ変えられます。</p>
  </div>;
}
