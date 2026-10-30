import type { TimetableTerm } from '../types/domain';
import { buildTimetableDisplayModel, WEEKDAY_OPTIONS, type TimetableDisplayInput } from '../lib/timetableDisplayModel';
import { getPeriodTimeStatus } from '../lib/timetableViewModel';
import '../styles/timetable-period-config.css';

export type TimetableSkeletonData = Omit<TimetableDisplayInput, 'activeTermId'> & { activeTerm: TimetableTerm | null };

/** Non-interactive geometry only; data and module readiness remain owned by the route. */
export function TimetableSkeleton({ userId, activeTerm, timetablePeriods, scheduleTemplates }: TimetableSkeletonData) {
  const { displayPeriods } = buildTimetableDisplayModel({
    userId, activeTermId: activeTerm?.id ?? 'default', timetablePeriods, scheduleTemplates,
  });
  return <div className="panel timetable-view timetable-period-based-view">
    <div className="section-header timetable-header">
      <div className="timetable-title-block">
        <div className="timetable-period-trigger">
          <span>{activeTerm?.label ?? '時間割の期間を設定'}</span>
          <small>{!activeTerm?.startDate && !activeTerm?.endDate ? '期間未設定' : `${activeTerm.startDate ?? '開始日未設定'} 〜 ${activeTerm.endDate ?? '終了日未設定'}`}</small>
        </div>
      </div>
      <div className="timetable-term-control">
        <span className="ghost-button timetable-ocr-button">画像/PDF</span>
        <span className="ghost-button timetable-term-switch">期間</span>
      </div>
    </div>
    {activeTerm?.usesAlternatingWeeks === true && <div className="timetable-alternating-control">
      <span>交互週</span><div className="segmented-control"><span className="segment">A週</span><span className="segment">B週</span></div>
    </div>}
    <div className="timetable-grid-shell">
      <div className="timetable-grid" style={{ gridTemplateColumns: `var(--timetable-period-column-width) repeat(${WEEKDAY_OPTIONS.length}, minmax(0, 1fr))` }}>
        <div className="timetable-corner-cell" />
        {WEEKDAY_OPTIONS.map(day => <div className="timetable-weekday-cell" key={day.value}>{day.label}</div>)}
        {displayPeriods.map(period => <div className="timetable-row-contents" key={period.periodNumber}>
          <div className={getPeriodTimeStatus(period) === 'valid' ? 'timetable-period-cell' : 'timetable-period-cell needs-time'}>
            <strong>{period.label}</strong>
            <span className="timetable-period-time-field"><span className="timetable-period-time-text">{period.startTime ?? '--:--'}</span></span>
            <span className="timetable-period-separator" />
            <span className="timetable-period-time-field"><span className="timetable-period-time-text">{period.endTime ?? '--:--'}</span></span>
            {getPeriodTimeStatus(period) === 'valid' ? null : <span className="timetable-period-status">{getPeriodTimeStatus(period) === 'invalid' ? '要修正' : '時刻未設定'}</span>}
          </div>
          {WEEKDAY_OPTIONS.map(day => <div className="timetable-grid-cell" key={day.value}><span className="route-skeleton__line route-skeleton__block" /></div>)}
        </div>)}
      </div>
    </div>
    <div className="row-actions timetable-grid-actions"><span className="ghost-button">－ 時限削除</span><span className="ghost-button">＋ 時限追加</span></div>
  </div>;
}
