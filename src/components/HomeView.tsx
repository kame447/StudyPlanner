import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Clock,
  Flame,
  House,
  Menu,
  MessageCircle,
  Play,
  Target,
} from 'lucide-react';
import { getWeekdayLabel, minutesBetween } from '../lib/date';
import { buildPlanOccurrenceKey } from '../lib/planRecurrence';
import { buildHomeDashboardModel } from '../lib/homeDashboard';
import type { Actual, Plan, StudyMaterial, TodoTask, User } from '../types/domain';
import { UserAvatar } from './UserAvatar';

interface HomeViewProps {
  user: User;
  plans: Plan[];
  actuals: Actual[];
  todos: TodoTask[];
  studyMaterials: StudyMaterial[];
  onOpenAiPlanning: () => void;
  onOpenSchedule: () => void;
  onOpenDay: (date: string) => void;
  onOpenTodo: () => void;
  onOpenBookshelf: () => void;
  onOpenReport: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
}

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

export function HomeView({
  user,
  plans,
  actuals,
  todos,
  studyMaterials,
  onOpenAiPlanning,
  onOpenSchedule,
  onOpenDay,
  onOpenTodo,
  onOpenBookshelf,
  onOpenReport,
  onOpenProfile,
  onOpenSettings,
}: HomeViewProps) {
  const dashboard = useMemo(
    () => buildHomeDashboardModel({ plans, actuals, todos }),
    [actuals, plans, todos],
  );
  const [year, month, day] = dashboard.today.split('-').map(Number);
  const weekday = getWeekdayLabel(dashboard.today);
  const nextPlan = dashboard.nextPlan;
  const notificationCount = Math.min(
    9,
    dashboard.nearDueTodos.length + dashboard.missingActualPlans.length,
  );
  const maxDayMinutes = Math.max(
    60,
    ...dashboard.weekDays.flatMap((item) => [item.plannedMinutes, item.actualMinutes]),
  );
  const ringProgress = Math.max(0, Math.min(100, dashboard.weekProgressPercent));
  const ringStyle = {
    '--home-progress': `${ringProgress * 3.6}deg`,
  } as CSSProperties;

  return (
    <section className="home-dashboard" aria-label="ホーム">
      <header className="home-topbar">
        <div className="home-streak-card" aria-label={`連続学習 ${dashboard.currentStreak}日`}>
          <Flame className="home-streak-flame" aria-hidden="true" size={30} />
          <div>
            <span>連続学習</span>
            <strong>{dashboard.currentStreak}日</strong>
            <small>最高 {dashboard.bestStreak}日</small>
          </div>
        </div>

        <div className="home-date-strip" aria-label={`${year}年${month}月${day}日 ${weekday}曜日`}>
          <div className="home-date-cell"><span>{year}年</span></div>
          <div className="home-date-cell"><span>{month}月</span></div>
          <div className="home-date-cell"><span>{day}日</span></div>
          <div className="home-date-cell"><span>{weekday}</span></div>
        </div>

        <div className="home-top-actions">
          <button className="home-icon-button" type="button" onClick={onOpenTodo} aria-label="通知とTodoを確認">
            <Bell aria-hidden="true" size={22} />
            {notificationCount > 0 ? <span className="home-notification-badge">{notificationCount}</span> : null}
          </button>
          <button className="home-avatar-button" type="button" onClick={onOpenProfile} aria-label="マイページを開く">
            <UserAvatar user={user} small />
          </button>
          <button className="home-icon-button" type="button" onClick={onOpenSettings} aria-label="メニューを開く">
            <Menu aria-hidden="true" size={24} />
          </button>
        </div>
      </header>

      <section className="home-next-card">
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
          <div className="home-scene-window" />
          <div className="home-scene-plant"><span /><span /><span /><span /></div>
          <div className="home-scene-desk">
            <div className="home-scene-books"><span /><span /><span /></div>
            <div className="home-scene-notebook"><BookOpen size={54} strokeWidth={1.4} /></div>
            <div className="home-scene-cup" />
          </div>
        </div>

        <button
          className="home-start-button"
          type="button"
          onClick={() => nextPlan ? onOpenDay(dashboard.today) : onOpenAiPlanning()}
        >
          <span className="home-start-icon"><Play aria-hidden="true" size={20} fill="currentColor" /></span>
          {nextPlan ? '学習を開始する' : 'AIで予定を作る'}
        </button>
      </section>

      <section className="home-panel home-today-panel">
        <div className="home-section-heading">
          <h2>今日の予定</h2>
          <button type="button" onClick={() => onOpenDay(dashboard.today)}>すべて見る <ChevronRight size={16} aria-hidden="true" /></button>
        </div>
        <div className="home-schedule-list">
          {dashboard.todayPlans.length > 0 ? dashboard.todayPlans.map((plan) => {
            const actual = dashboard.actualByOccurrenceKey.get(buildPlanOccurrenceKey(plan.id, plan.date));
            return (
              <button className="home-schedule-row" type="button" key={`${plan.id}:${plan.date}`} onClick={() => onOpenDay(plan.date)}>
                <span className={actual ? 'home-time-dot completed' : 'home-time-dot'}><Clock size={13} aria-hidden="true" /></span>
                <span className="home-schedule-content">
                  <time>{plan.startTime} - {plan.endTime}</time>
                  <strong>{plan.title}</strong>
                  <small><BookOpen size={13} aria-hidden="true" />教材：{resolveMaterialLabel(plan, studyMaterials)}</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            );
          }) : (
            <div className="home-schedule-empty">今日の予定はまだありません。</div>
          )}
        </div>
        {dashboard.todayPlans.length > 4 ? <p className="home-scroll-hint">下にスクロールして続きを読む ↓</p> : null}
      </section>

      <div className="home-alert-grid">
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

      <section className="home-panel home-progress-panel">
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

      <nav className="home-bottom-nav print-hide" aria-label="主要ナビゲーション">
        <button type="button" onClick={onOpenAiPlanning}><MessageCircle aria-hidden="true" /><span>AI計画</span></button>
        <button type="button" onClick={onOpenSchedule}><CalendarDays aria-hidden="true" /><span>予定</span></button>
        <button className="active" type="button" aria-current="page"><span className="home-nav-active-circle"><House aria-hidden="true" /></span><span>ホーム</span></button>
        <button type="button" onClick={onOpenBookshelf}><BookOpen aria-hidden="true" /><span>教材</span></button>
        <button type="button" onClick={onOpenReport}><BarChart3 aria-hidden="true" /><span>分析</span></button>
      </nav>
    </section>
  );
}
