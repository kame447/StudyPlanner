import type { ViewMode } from '../types/domain';
import './RouteSkeleton.css';

type SkeletonView = ViewMode | 'ai-planning' | 'contact';
const labels: Record<SkeletonView, string> = {
  month: '月の予定', week: '週の予定', day: 'この日の予定', todo: 'Todo',
  bookshelf: '教材', report: '学習レポート', timetable: '時間割',
  'ai-planning': 'AI計画', contact: 'お問い合わせ',
};

/** Presentation only: the owning Suspense boundary controls its lifetime. */
export function RouteSkeleton({ view }: { view: SkeletonView }) {
  const calendar = view === 'month' || view === 'week' || view === 'timetable';
  return <>
    <span className="route-skeleton__status" role="status">{labels[view]}を読み込んでいます</span>
    <section className={`route-skeleton route-skeleton--${view}`} aria-busy={true} aria-label={`${labels[view]}を読み込み中`}>
    <div className="route-skeleton__layout" aria-hidden={true}>
      {view !== 'month' && <div className="route-skeleton__heading route-skeleton__block" />}
      {calendar ? <>
        <div className="route-skeleton__weekdays">{Array.from({ length: 7 }, (_, index) => <span className="route-skeleton__block" key={index} />)}</div>
        <div className="route-skeleton__calendar">{Array.from({ length: view === 'month' ? 42 : 28 }, (_, index) => <div className="route-skeleton__cell" key={index}><span className="route-skeleton__block" /></div>)}</div>
      </> : view === 'bookshelf' ? <>
        <div className="route-skeleton__filters route-skeleton__block" />
        <div className="route-skeleton__books">{Array.from({ length: 4 }, (_, index) => <div className="route-skeleton__book" key={index}><div className="route-skeleton__cover route-skeleton__block" /><div className="route-skeleton__line route-skeleton__block" /></div>)}</div>
      </> : view === 'report' ? <>
        <div className="route-skeleton__summary">{Array.from({ length: 3 }, (_, index) => <div className="route-skeleton__metric route-skeleton__block" key={index} />)}</div>
        <div className="route-skeleton__chart route-skeleton__block" />
      </> : view === 'contact' ? <>
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
