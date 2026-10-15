import { DEFAULT_STUDY_PROGRESS_PREFERENCES, type StudyProgressPreferences } from '../lib/studyProgressPolicy';
import { useState, type ReactNode } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, Palette, RotateCcw, Sparkles, SunMoon, Wind } from 'lucide-react';
import { useWeeklyPlanningPersonalization } from '../features/weeklyPlanning/personalization/WeeklyPlanningPersonalizationContext';
import { useMotionPreference } from '../hooks/useMotionPreference';
import { MOTION_PREFERENCE_OPTIONS } from '../lib/motionPreference';
import type { Appearance } from '../lib/appearance';
import { THEME_PALETTE_OPTIONS, type ThemeMode, type ThemePalette } from '../lib/themePalette';
import { DEFAULT_HOME_SCENE_PREFERENCES, HOME_SCENE_STYLE_OPTIONS, type HomeScenePreferences, type HomeSceneStyle } from '../lib/homeScenePreferences';
import { HomeScene } from './home/HomeScene';

export interface AppSettingsGeneralProps {
  progressPreferences?: StudyProgressPreferences;
  onChangeProgressPreferences?: (preferences: StudyProgressPreferences) => void;
  progressPreferencesError?: string | null;
  appearance?: Appearance;
  onChangeAppearance?: (appearance: Appearance) => void;
  appearanceError?: string | null;
  homeScenePreferences?: HomeScenePreferences;
  onChangeHomeSceneStyle?: (style: HomeSceneStyle) => void;
  onChangeHomeSceneMotion?: (animated: boolean) => void;
  homeSceneError?: string | null;
  showDayTimetable?: boolean;
  onChangeDayTimetable?: (value: boolean) => void;
  dayTimetableError?: string | null;
  showMonthTimetable?: boolean;
  onChangeMonthTimetable?: (value: boolean) => void;
  monthTimetableError?: string | null;
  themeMode: ThemeMode;
  themePalette: ThemePalette;
  themeError?: string | null;
  onChangeTheme: (mode: ThemeMode) => void;
  onChangeThemePalette: (palette: ThemePalette) => void;
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-group" aria-label={title}>
    <h2 className="settings-group-title">{title}</h2>
    <div className="settings-group-card">{children}</div>
  </section>;
}

export function AppSettingsGeneral({
  progressPreferences = DEFAULT_STUDY_PROGRESS_PREFERENCES, onChangeProgressPreferences, progressPreferencesError,
  appearance = 'standard', onChangeAppearance, appearanceError,
  homeScenePreferences = DEFAULT_HOME_SCENE_PREFERENCES,
  onChangeHomeSceneStyle, onChangeHomeSceneMotion, homeSceneError,
  showDayTimetable = true, onChangeDayTimetable, dayTimetableError,
  showMonthTimetable = true, onChangeMonthTimetable, monthTimetableError,
  themeMode, themePalette, themeError, onChangeTheme, onChangeThemePalette,
}: AppSettingsGeneralProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { weekStartsOn, setWeekStartsOn, resetProfile } = useWeeklyPlanningPersonalization();
  const selectedPalette = THEME_PALETTE_OPTIONS.find(option => option.id === themePalette) ?? THEME_PALETTE_OPTIONS[0];
  const motion = useMotionPreference();
  const motionCappedBySystem = motion.preference === 'standard' && motion.systemReduced;

  return <div className="settings-group-list">
    <SettingsGroup title="表示とデザイン">
      {onChangeAppearance ? <div className="settings-row-block">
        <div className="settings-row">
          <span className="settings-field-label" id="settings-appearance-label"><Palette aria-hidden="true" size={21} />テーマ</span>
          <div className="settings-segments" role="group" aria-labelledby="settings-appearance-label">
            {(['standard', 'pixel'] as const).map(value => <button key={value} type="button"
              aria-pressed={appearance === value} onClick={() => onChangeAppearance(value)}>
              {value === 'standard' ? '標準' : 'ドット'}
            </button>)}
          </div>
        </div>
        {appearanceError ? <p className="settings-inline-error settings-group-note" role="alert">{appearanceError}</p> : null}
      </div> : null}
      <div className="settings-row">
        <span className="settings-field-label" id="settings-theme-label"><SunMoon aria-hidden="true" size={21} />表示モード</span>
        <div className="settings-segments" role="group" aria-labelledby="settings-theme-label">
          {(['light', 'dark'] as const).map(mode => <button key={mode} type="button"
            aria-pressed={themeMode === mode} onClick={() => onChangeTheme(mode)}>
            {mode === 'light' ? 'ライト' : 'ダーク'}
          </button>)}
        </div>
      </div>
      <div className="settings-disclosure-row">
        <button className="settings-row settings-row-button" type="button" aria-expanded={paletteOpen}
          aria-controls="settings-palette-options" onClick={() => setPaletteOpen(value => !value)}>
          <span className="settings-field-label"><Palette aria-hidden="true" size={21} />配色</span>
          <span className="settings-row-value">{selectedPalette.label}
            {paletteOpen ? <ChevronDown aria-hidden="true" size={20} /> : <ChevronRight aria-hidden="true" size={20} />}
          </span>
        </button>
        {paletteOpen ? <div className="settings-row-details" id="settings-palette-options">
          <div className="theme-palette-grid" role="group" aria-label="配色">
            {THEME_PALETTE_OPTIONS.map(palette => <button key={palette.id} type="button"
              className={themePalette === palette.id ? 'theme-palette-button active' : 'theme-palette-button'}
              aria-pressed={themePalette === palette.id} onClick={() => onChangeThemePalette(palette.id)}>
              <span className="theme-palette-swatches" aria-hidden="true">{palette.swatches.map(color =>
                <span key={color} className="theme-palette-swatch" style={{ backgroundColor: color }} />)}</span>
              <span className="theme-palette-copy"><strong>{palette.label}</strong></span>
            </button>)}
          </div>
        </div> : null}
      </div>
      {themeError ? <p className="settings-inline-error settings-group-note" role="alert">{themeError}</p> : null}
      <div className="settings-row-block">
        <div className="settings-row">
          <span className="settings-field-label" id="settings-motion-label"><Wind aria-hidden="true" size={21} />アニメーション</span>
          <div className="settings-segments" role="group" aria-labelledby="settings-motion-label"
            aria-describedby={motionCappedBySystem ? 'settings-motion-description' : undefined}>
            {MOTION_PREFERENCE_OPTIONS.map(option => <button key={option.id} type="button"
              aria-pressed={motion.preference === option.id} onClick={() => motion.setPreference(option.id)}>
              {option.label}
            </button>)}
          </div>
        </div>
        {motionCappedBySystem ? <p className="settings-group-note" id="settings-motion-description">
          端末で動きを減らす設定が有効なため、控えめで表示しています。
        </p> : null}
        {motion.error ? <p className="settings-inline-error settings-group-note" role="alert">{motion.error}</p> : null}
      </div>
    </SettingsGroup>

    {onChangeHomeSceneStyle && onChangeHomeSceneMotion ? <SettingsGroup title="ホームのイラスト">
      <div className="settings-row-details settings-scene-picker">
        <div className="home-scene-options" role="group" aria-label="ホームのイラスト">
          {HOME_SCENE_STYLE_OPTIONS.map(option => <button className="home-scene-option" key={option.id} type="button"
            aria-label={option.label} aria-pressed={homeScenePreferences.style === option.id}
            onClick={() => onChangeHomeSceneStyle(option.id)}>
            <HomeScene kind="study" preferences={{ style: option.id, animated: false }} preview />
            <span className="home-scene-option-copy"><strong>{option.label}</strong></span>
          </button>)}
        </div>
      </div>
      <label className="settings-row settings-motion-row">
        <span className="settings-row-copy"><span>イラストをゆっくり動かす</span>
          <small id="home-scene-motion-description">アニメーションが「標準」のときだけ動きます。</small>
        </span>
        <input type="checkbox" aria-label="イラストをゆっくり動かす" checked={homeScenePreferences.animated} aria-describedby="home-scene-motion-description"
          disabled={motion.level !== 'standard'}
          onChange={event => onChangeHomeSceneMotion(event.target.checked)} />
      </label>
      {homeSceneError ? <p className="settings-inline-error settings-group-note" role="alert">{homeSceneError}</p> : null}
    </SettingsGroup> : null}

    {onChangeProgressPreferences ? <SettingsGroup title="ホームの学習進捗">
      <p className="settings-group-note">ホームの進捗は学習予定と学習記録を集計します。主要予定・時間割も含めたい場合は選択してください。登録や時間の経過だけでは完了になりません。</p>
      {([
        ['includeGeneralEvents', '月の主要予定を進捗に含める'],
        ['includeTimetable', '時間割を進捗に含める'],
      ] as const).map(([key, label]) => <label className="settings-row settings-motion-row" key={key}>
        <span className="settings-row-copy"><span>{label}</span></span>
        <input type="checkbox" aria-label={label} checked={progressPreferences[key]}
          onChange={event => onChangeProgressPreferences({ ...progressPreferences, [key]: event.target.checked })} />
      </label>)}
      <p className="settings-group-note">主要予定には通常の予定登録から追加した学習以外の予定も含みます。実績を記録できない予定は予定時間のみ集計します。</p>
      {progressPreferencesError ? <p className="settings-inline-error settings-group-note" role="alert">{progressPreferencesError}</p> : null}
    </SettingsGroup> : null}

    <SettingsGroup title="カレンダーと学習">
      {onChangeMonthTimetable ? <div className="settings-row-block">
        <div className="settings-row">
          <span className="settings-field-label" id="month-timetable-label"><CalendarDays aria-hidden="true" size={21} />月カレンダーに時間割を表示</span>
          <div className="settings-segments" role="group" aria-labelledby="month-timetable-label">
            <button type="button" aria-pressed={showMonthTimetable} onClick={() => onChangeMonthTimetable(true)}>表示する</button>
            <button type="button" aria-pressed={!showMonthTimetable} onClick={() => onChangeMonthTimetable(false)}>表示しない</button>
          </div>
        </div>
        {monthTimetableError ? <p className="settings-inline-error settings-group-note" role="alert">{monthTimetableError}</p> : null}
      </div> : null}
      {onChangeDayTimetable ? <div className="settings-row-block">
        <div className="settings-row">
          <span className="settings-field-label" id="day-timetable-label"><CalendarDays aria-hidden="true" size={21} />日カレンダーに時間割を表示</span>
          <div className="settings-segments" role="group" aria-labelledby="day-timetable-label">
            <button type="button" aria-pressed={showDayTimetable} onClick={() => onChangeDayTimetable(true)}>表示する</button>
            <button type="button" aria-pressed={!showDayTimetable} onClick={() => onChangeDayTimetable(false)}>表示しない</button>
          </div>
        </div>
        {dayTimetableError ? <p className="settings-inline-error settings-group-note" role="alert">{dayTimetableError}</p> : null}
      </div> : null}
      <div className="settings-row-block">
        <div className="settings-row">
          <span className="settings-field-label" id="settings-week-label"><CalendarDays aria-hidden="true" size={21} />週の始まり</span>
          <div className="settings-segments" role="group" aria-labelledby="settings-week-label" aria-describedby="settings-week-description">
            {(['monday', 'sunday'] as const).map(day => <button key={day} type="button"
              aria-pressed={weekStartsOn === day} onClick={() => void setWeekStartsOn(day)}>
              {day === 'monday' ? '月曜日' : '日曜日'}
            </button>)}
          </div>
        </div>
        <p className="settings-group-note" id="settings-week-description">「今週」「来週」の解釈と週間計画の保存単位に反映されます。</p>
      </div>
      <button className="settings-row settings-row-button settings-reset-row" type="button" onClick={() => {
        if (window.confirm('学習設定を初期化しますか？')) void resetProfile();
      }}><span className="settings-field-label"><RotateCcw aria-hidden="true" size={20} />学習設定を初期化</span><ChevronRight aria-hidden="true" size={20} /></button>
    </SettingsGroup>

    <SettingsGroup title="AIについて">
      <div className="settings-row">
        <span className="settings-field-label"><Sparkles aria-hidden="true" size={21} />週間計画AI</span>
        <span className="settings-row-value">Stable V5<span className="confidence-badge">固定</span></span>
      </div>
    </SettingsGroup>
  </div>;
}
