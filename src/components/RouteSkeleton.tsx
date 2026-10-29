import type { ViewMode } from '../types/domain';
import './RouteSkeleton.css';
import { TimetableSkeleton, type TimetableSkeletonData } from './TimetableSkeleton';

type SkeletonView = ViewMode | 'ai-planning' | 'contact';
const labels: Record<SkeletonView, string> = {
  month: '月の予定', week: '週の予定', day: 'この日の予定', todo: 'Todo',
  bookshelf: '教材', report: '学習レポート', timetable: '時間割',
  'ai-planning': 'AI計画', contact: 'お問い合わせ',
};

/** Presentation only: the owning Suspense boundary controls its lifetime. */
export function RouteSkeleton({ view, timetable }: { view: SkeletonView; timetable?: TimetableSkeletonData }) {
  const calendar = view === 'month' || view === 'week';
  return <>
    <span className="route-skeleton__status" role="status">{labels[view]}を読み込んでいます</span>
    <section className={`route-skeleton route-skeleton--${view}`} aria-busy={true} aria-label={`${labels[view]}を読み込み中`}>
    <div className="route-skeleton__layout" aria-hidden={true}>
      {!['month', 'bookshelf', 'report', 'timetable'].includes(view) && <div className="route-skeleton__heading route-skeleton__block" />}
      {view === 'timetable' ? <TimetableSkeleton {...(timetable ?? { userId: '', activeTerm: null, timetablePeriods: [], scheduleTemplates: [] })} /> : calendar ? <>
        <div className="route-skeleton__weekdays">{Array.from({ length: 7 }, (_, index) => <span className="route-skeleton__block" key={index} />)}</div>
        <div className="route-skeleton__calendar">{Array.from({ length: view === 'month' ? 42 : 28 }, (_, index) => <div className="route-skeleton__cell" key={index}><span className="route-skeleton__block" /></div>)}</div>
      </> : view === 'bookshelf' ? <div className="bookshelf-view">
        <div className="bookshelf-dashboard">
          <header className="bookshelf-page-header">
            <div className="bookshelf-page-title-row"><span /><h1>教材</h1><span className="bookshelf-icon-button" /></div>
            <div className="bookshelf-category-chips">{[0, 1, 2].map(index => <span className="route-skeleton__chip route-skeleton__block" key={index} />)}</div>
            <div className="bookshelf-category-filter-row"><div className="bookshelf-category-chips">{[0, 1, 2].map(index => <span className="route-skeleton__chip route-skeleton__block" key={index} />)}</div><span className="bookshelf-icon-button compact" /></div>
          </header>
          <div className="bookshelf-dashboard-section">
            <div className="bookshelf-section-heading"><h2>よく使う教材</h2><span className="route-skeleton__book-edit">編集</span></div>
            <div className="bookshelf-featured-grid route-skeleton__books">{Array.from({ length: 3 }, (_, index) => <div className="bookshelf-featured-card" key={index}><div className="bookshelf-featured-cover route-skeleton__block" /><div className="bookshelf-featured-copy"><span className="route-skeleton__line route-skeleton__block" /><span className="route-skeleton__detail route-skeleton__block" /></div></div>)}</div>
          </div>
        </div>
      </div> : view === 'report' ? <div className="learning-report-view">
        <header className="learning-report-header"><span className="learning-report-header-spacer" /><h1>学習レポート</h1><span className="learning-report-header-spacer" /></header>
        <div className="learning-report-summary-grid">{Array.from({ length: 4 }, (_, index) => <div className="learning-report-summary-card" key={index}><div className="learning-report-summary-copy"><span className="route-skeleton__detail route-skeleton__block" /><strong className="route-skeleton__line route-skeleton__block" /></div></div>)}</div>
        <div className="learning-report-controls"><div className="learning-report-scope-tabs"><span className="route-skeleton__report-tabs route-skeleton__block" /></div><div className="learning-report-material-filter"><span className="route-skeleton__line route-skeleton__block" /></div></div>
        <div className="learning-report-period-navigation"><span className="learning-report-header-spacer" /><span className="route-skeleton__line route-skeleton__block" /><span className="learning-report-header-spacer" /></div>
        <div className="learning-report-card route-skeleton__chart"><span className="route-skeleton__line route-skeleton__block" /></div>
      </div> : view === 'contact' ? <>
        <div className="route-skeleton__input route-skeleton__block" />
        <div className="route-skeleton__line route-skeleton__block" />
        <div className="route-skeleton__attachment route-skeleton__block" />
      </> : view === 'ai-planning' ? <>
        <div className="route-skeleton__suggestions">{Array.from({ length: 3 }, (_, index) => <div className="route-skeleton__suggestion route-skeleton__block" key={index} />)}</div>
        <div className="route-skeleton__composer route-skeleton__block" />
      </> : <div className="route-skeleton__list">{Array.from({ length: 4 }, (_, index) => <div className="route-skeleton__row" key={index}><span className="route-skeleton__square route-skeleton__block" /><div className="route-skeleton__row-lines"><div className="route-skeleton__line route-skeleton__block" /><div className="route-skeleton__detail route-skeleton__block" /></div></div>)}</div>}
    </div>
    </section>
  </>;
}
