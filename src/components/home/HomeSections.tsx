import type { CSSProperties } from 'react';
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Clock,
  MessageCircle,
  Plus,
  Target,
} from 'lucide-react';
import { formatCompactDate, minutesBetween } from '../../lib/date';
import type { HomeDashboardModel } from '../../lib/homeDashboard';
import { resolveHomeNextPlanVisual } from '../../lib/homeNextPlanVisual';
import { buildPlanOccurrenceKey } from '../../lib/planRecurrence';
import type { Actual, Plan, StudyMaterial, TodoTask } from '../../types/domain';

export type HomeSectionId =
  | 'getting-started'
  | 'next-plan'
  | 'today-schedule'
  | 'attention'
  | 'weekly-progress'
  | 'material-progress';

export const DEFAULT_HOME_SECTION_ORDER: HomeSectionId[] = [
  'next-plan',
  'today-schedule',
  'attention',
  'weekly-progress',
  'material-progress',
];

function formatMinutes(minutes: number): string {
  const normalized = Math.max(0, Math.round(minutes));
  if (normalized < 60) return `${normalized}分`;
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  return rest > 0 ? `${hours}時間${rest}分` : `${hours}時間`;
}

function formatDue(todo: TodoTask): string {
  if (!todo.dueDate) return '期限未設定';
  const time = todo.dueTime ? ` ${todo.dueTime}` : '';
  return `${todo.dueDate.slice(5).replace('-', '/')} ${time}`.trim();
}

function resolveMaterialLabel(plan: Plan, materials: StudyMaterial[]): string {
  if (plan.materialName?.trim()) return plan.materialName.trim();
  if (plan.materialId) {
    const material = materials.find((item) => item.id === plan.materialId);
    if (material) return material.name;
  }
  return plan.subject?.trim() || '教材未設定';
}

function progressUnitLabel(material: StudyMaterial): string {
  if (material.progressUnitLabel?.trim()) return material.progressUnitLabel.trim();

  switch (material.progressUnit) {
    case 'page':
      return 'ページ';
    case 'problem':
      return '問';
    case 'section':
      return '章';
    case 'video':
      return '本';
    case 'word':
      return '語';
    default:
      return '単位';
  }
}

function HomeScheduleRow({
  plan,
  actual,
  studyMaterials,
  future = false,
  onOpenDay,
}: {
  plan: Plan;
  actual?: Actual;
  studyMaterials: StudyMaterial[];
  future?: boolean;
  onOpenDay: (date: string) => void;
}) {
  return (
    <button
      className={future ? 'home-schedule-row future' : 'home-schedule-row'}
      type="button"
      onClick={() => onOpenDay(plan.date)}
    >
      <span className={actual ? 'home-time-dot completed' : 'home-time-dot'}>
        <Clock size={13} aria-hidden="true" />
      </span>
      <span className="home-schedule-content">
        <time>
          {future ? `${formatCompactDate(plan.date)} ` : ''}
          {plan.startTime} - {plan.endTime}
        </time>
        <strong>{plan.title}</strong>
        <small>
          <BookOpen size={13} aria-hidden="true" />
          教材：{resolveMaterialLabel(plan, studyMaterials)}
        </small>
      </span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
}

export function GettingStartedSection({
  onOpenAiPlanning,
  onOpenSchedule,
  onOpenTodo,
  onOpenBookshelf,
}: {
  onOpenAiPlanning: () => void;
  onOpenSchedule: () => void;
  onOpenTodo: () => void;
  onOpenBookshelf: () => void;
}) {
  const actions = [
    {
      id: 'ai',
      title: 'AIで学習計画を作る',
      detail: '目標や教材から予定を組み立てる',
      icon: MessageCircle,
      onClick: onOpenAiPlanning,
      primary: true,
    },
    {
      id: 'material',
      title: '教材を登録',
      detail: '進捗を記録する教材を追加する',
      icon: BookOpen,
      onClick: onOpenBookshelf,
      primary: false,
    },
    {
      id: 'schedule',
      title: '予定を追加',
      detail: '学習やその他の予定を登録する',
      icon: CalendarDays,
      onClick: onOpenSchedule,
      primary: false,
    },
    {
      id: 'todo',
      title: 'Todoを追加',
      detail: '締切のある課題を登録する',
      icon: CircleAlert,
      onClick: onOpenTodo,
      primary: false,
    },
  ] as const;

  return (
    <section className="home-setup-card" aria-labelledby="home-getting-started-title">
      <div className="home-setup-heading">
        <span className="home-setup-mark"><BookOpen size={22} aria-hidden="true" /></span>
        <div>
          <p>はじめに</p>
          <h1 id="home-getting-started-title">StudyPlannerを準備する</h1>
        </div>
      </div>
      <p className="home-setup-copy">
        まず1つ登録すると、予定・進捗・要対応などがホームに自動で表示されます。
      </p>
      <div className="home-setup-actions">
        {actions.map(({ id, title, detail, icon: Icon, onClick, primary }) => (
          <button
            className={primary ? 'home-setup-action primary' : 'home-setup-action'}
            type="button"
            onClick={onClick}
            key={id}
          >
            <span className="home-setup-action-icon"><Icon size={20} aria-hidden="true" /></span>
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

export function NextPlanSection({
  dashboard,
  studyMaterials,
  onOpenAiPlanning,
  onOpenDay,
}: {
  dashboard: HomeDashboardModel;
  studyMaterials: StudyMaterial[];
  onOpenAiPlanning: () => void;
  onOpenDay: (date: string) => void;
}) {
  const nextPlan = dashboard.nextPlan;
  const nextPlanVisual = resolveHomeNextPlanVisual(nextPlan);

  return (
    <section
      className="home-next-card"
      data-home-section="next-plan"
      data-next-plan-visual={nextPlanVisual.kind}
    >
      <div className="home-next-copy">
        <p className="home-eyebrow">次の予定</p>
        {nextPlan ? (
          <>
            <h1>{nextPlan.title}</h1>
            <div className="home-next-meta">
              <span><Clock aria-hidden="true" size={18} />{nextPlan.startTime} - {nextPlan.endTime}</span>
              <span><BookOpen aria-hidden="true" size={18} />教材：{resolveMaterialLabel(nextPlan, studyMaterials)}</span>
              <span><Target aria-hidden="true" size={18} />予定学習時間 {formatMinutes(minutesBetween(nextPlan.startTime, nextPlan.endTime))}</span>
            </div>
          </>
        ) : (
          <>
            <h1>次の予定はありません</h1>
            <p className="home-empty-copy">予定を追加するか、AI計画から今日の学習内容を組み立てられます。</p>
          </>
        )}
      </div>

      <div className="home-study-scene" aria-hidden="true">
        <img
          className="home-study-scene-image"
          src={nextPlanVisual.src}
          alt=""
          decoding="async"
        />
      </div>

      <button
        className="home-start-button"
        type="button"
        onClick={() => nextPlan ? onOpenDay(dashboard.today) : onOpenAiPlanning()}
      >
        <span className="home-start-icon">▶</span>
        {nextPlan ? '学習を開始する' : 'AIで予定を作る'}
      </button>
    </section>
  );
}

export function TodayScheduleSection({
  dashboard,
  studyMaterials,
  onOpenDay,
  onOpenSchedule,
}: {
  dashboard: HomeDashboardModel;
  studyMaterials: StudyMaterial[];
  onOpenDay: (date: string) => void;
  onOpenSchedule: () => void;
}) {
  const futureSlots = Math.max(0, 4 - Math.min(4, dashboard.todayPlans.length));
  const visibleUpcomingPlans = dashboard.upcomingPlans.slice(0, futureSlots);
  const showFuturePlaceholder =
    dashboard.todayPlans.length > 0 &&
    dashboard.todayPlans.length < 4 &&
    visibleUpcomingPlans.length === 0;

  return (
    <section className="home-panel home-today-panel" data-home-section="today-schedule">
      <div className="home-section-heading">
        <h2>今日の予定</h2>
        <button type="button" onClick={() => onOpenDay(dashboard.today)}>すべて見る <ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      <div className="home-schedule-list">
        {dashboard.todayPlans.length > 0 ? (
          <>
            {dashboard.todayPlans.map((plan) => {
              const actual = dashboard.actualByOccurrenceKey.get(
                buildPlanOccurrenceKey(plan.id, plan.date),
              );
              return (
                <HomeScheduleRow
                  key={`${plan.id}:${plan.date}`}
                  plan={plan}
                  actual={actual}
                  studyMaterials={studyMaterials}
                  onOpenDay={onOpenDay}
                />
              );
            })}
            {dashboard.todayPlans.length < 4
              ? visibleUpcomingPlans.map((plan) => (
                  <HomeScheduleRow
                    key={`future:${plan.id}:${plan.date}`}
                    plan={plan}
                    future
                    studyMaterials={studyMaterials}
                    onOpenDay={onOpenDay}
                  />
                ))
              : null}
            {showFuturePlaceholder ? (
              <button className="home-schedule-add-row" type="button" onClick={onOpenSchedule}>
                <span><Plus size={15} aria-hidden="true" /></span>
                <strong>この先の予定を追加</strong>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            ) : null}
          </>
        ) : (
          <button className="home-schedule-empty" type="button" onClick={onOpenSchedule}>
            <span><Plus size={16} aria-hidden="true" /></span>
            今日の予定はまだありません。予定を追加する
          </button>
        )}
      </div>
      {dashboard.todayPlans.length > 4 ? <p className="home-scroll-hint">下にスクロールして続きを読む ↓</p> : null}
    </section>
  );
}

export function AttentionSection({
  dashboard,
  onOpenTodo,
  onOpenDay,
}: {
  dashboard: HomeDashboardModel;
  onOpenTodo: () => void;
  onOpenDay: (date: string) => void;
}) {
  return (
    <div className="home-alert-grid" data-home-section="attention">
      <button className="home-alert-card danger" type="button" onClick={onOpenTodo}>
        <div className="home-alert-heading"><span>締切が近い Todo</span><b>{dashboard.nearDueTodos.length}件</b></div>
        <div className="home-alert-body">
          <CalendarDays aria-hidden="true" size={24} />
          <span>
            {dashboard.primaryDueTodo ? (
              <><small>{formatDue(dashboard.primaryDueTodo)}まで</small><strong>{dashboard.primaryDueTodo.title}</strong></>
            ) : (
              <><small>現在</small><strong>期限の近いTodoはありません</strong></>
            )}
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </div>
      </button>

      <button className="home-alert-card warning" type="button" onClick={() => onOpenDay(dashboard.today)}>
        <div className="home-alert-heading"><span>要対応</span><b>{dashboard.missingActualPlans.length}件</b></div>
        <div className="home-alert-body">
          <CircleAlert aria-hidden="true" size={24} />
          <span>
            {dashboard.missingActualPlans[0] ? (
              <><small>実績未入力</small><strong>{dashboard.missingActualPlans[0].title}</strong></>
            ) : (
              <><small>実績入力</small><strong>未入力の実績はありません</strong></>
            )}
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </div>
      </button>
    </div>
  );
}

export function WeeklyProgressSection({
  dashboard,
  onOpenReport,
}: {
  dashboard: HomeDashboardModel;
  onOpenReport: () => void;
}) {
  const maxDayMinutes = Math.max(
    60,
    ...dashboard.weekDays.flatMap((item) => [item.plannedMinutes, item.actualMinutes]),
  );
  const ringProgress = Math.max(0, Math.min(100, dashboard.weekProgressPercent));
  const ringStyle = {
    '--home-progress': `${ringProgress * 3.6}deg`,
  } as CSSProperties;

  return (
    <section className="home-panel home-progress-panel" data-home-section="weekly-progress">
      <div className="home-section-heading">
        <h2>今週の進捗</h2>
        <button type="button" onClick={onOpenReport}>詳細を見る <ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      <div className="home-progress-body">
        <div className="home-progress-ring" style={ringStyle}>
          <div><strong>{dashboard.weekProgressPercent}%</strong></div>
        </div>
        <div className="home-progress-copy">
          <span>予定 <strong>{formatMinutes(dashboard.weekPlannedMinutes)}</strong></span>
          <span>実績 <strong>{formatMinutes(dashboard.weekActualMinutes)}</strong></span>
          <span className={dashboard.weekActualMinutes >= dashboard.weekPlannedMinutes ? 'positive' : 'negative'}>
            {dashboard.weekActualMinutes >= dashboard.weekPlannedMinutes ? '+' : '-'}{formatMinutes(Math.abs(dashboard.weekActualMinutes - dashboard.weekPlannedMinutes))}
          </span>
        </div>
        <div className="home-week-chart" aria-label="曜日別の予定と実績">
          <div className="home-chart-legend"><span className="actual">実績</span><span className="planned">予定</span></div>
          <div className="home-chart-bars">
            {dashboard.weekDays.map((item) => {
              const plannedHeight = Math.max(4, Math.round((item.plannedMinutes / maxDayMinutes) * 100));
              const actualHeight = Math.max(4, Math.round((item.actualMinutes / maxDayMinutes) * 100));
              return (
                <div className="home-chart-day" key={item.date} title={`${item.label}: 予定 ${formatMinutes(item.plannedMinutes)} / 実績 ${formatMinutes(item.actualMinutes)}`}>
                  <div className="home-chart-columns">
                    <span className="home-chart-plan" style={{ height: `${plannedHeight}%` }} />
                    <span className="home-chart-actual" style={{ height: `${actualHeight}%` }} />
                  </div>
                  <small>{item.label}</small>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function MaterialProgressSection({
  studyMaterials,
  onOpenBookshelf,
}: {
  studyMaterials: StudyMaterial[];
  onOpenBookshelf: () => void;
}) {
  const activeMaterials = studyMaterials
    .filter((material) => material.status !== 'archived')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3);

  return (
    <section className="home-panel home-material-panel" data-home-section="material-progress">
      <div className="home-section-heading">
        <h2>教材の進捗</h2>
        <button type="button" onClick={onOpenBookshelf}>すべて見る <ChevronRight size={16} aria-hidden="true" /></button>
      </div>

      {activeMaterials.length > 0 ? (
        <div className="home-material-list">
          {activeMaterials.map((material) => {
            const hasProgress =
              typeof material.totalUnits === 'number' &&
              material.totalUnits > 0 &&
              typeof material.currentUnit === 'number';
            const progress = hasProgress
              ? Math.max(0, Math.min(100, Math.round(((material.currentUnit ?? 0) / (material.totalUnits ?? 1)) * 100)))
              : null;

            return (
              <button className="home-material-row" type="button" onClick={onOpenBookshelf} key={material.id}>
                <span className="home-material-icon"><BookOpen size={18} aria-hidden="true" /></span>
                <span className="home-material-copy">
                  <span className="home-material-title-line">
                    <strong>{material.name}</strong>
                    <b>{progress === null ? '進捗設定' : `${progress}%`}</b>
                  </span>
                  {progress === null ? (
                    <small>{material.subjectName || '教材'} ・ 進捗の単位と総量を設定できます</small>
                  ) : (
                    <>
                      <span className="home-material-track" aria-hidden="true">
                        <span style={{ width: `${progress}%` }} />
                      </span>
                      <small>
                        {material.currentUnit} / {material.totalUnits} {progressUnitLabel(material)}
                      </small>
                    </>
                  )}
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : (
        <button className="home-material-empty" type="button" onClick={onOpenBookshelf}>
          <span className="home-material-icon"><Plus size={18} aria-hidden="true" /></span>
          <span><strong>教材を登録する</strong><small>教材を追加すると、ここに個別の進捗が表示されます。</small></span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
