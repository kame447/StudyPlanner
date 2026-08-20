import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Flame,
  House,
  Menu,
  MessageCircle,
} from 'lucide-react';
import { buildHomeDashboardModel } from '../lib/homeDashboard';
import type { Actual, Plan, StudyMaterial, TodoTask, User } from '../types/domain';
import { HomeDateDisplay } from './HomeDateDisplay';
import {
  AttentionSection,
  DEFAULT_HOME_SECTION_ORDER,
  GettingStartedSection,
  MaterialProgressSection,
  NextPlanSection,
  TodayScheduleSection,
  type HomeSectionId,
} from './home/HomeSections';
import { WeeklyProgressSection } from './home/WeeklyProgressSection';
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

const CORE_HOME_SECTION_ORDER = DEFAULT_HOME_SECTION_ORDER.filter(
  (sectionId) => sectionId !== 'material-progress',
);

function estimateMaterialSectionHeight(studyMaterials: StudyMaterial[]): number {
  const visibleRows = Math.max(
    1,
    Math.min(3, studyMaterials.filter((material) => material.status !== 'archived').length),
  );
  return 52 + visibleRows * 63;
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
  const isGettingStarted =
    plans.length === 0 &&
    actuals.length === 0 &&
    todos.length === 0 &&
    studyMaterials.length === 0;
  const coreSectionsRef = useRef<HTMLDivElement | null>(null);
  const bottomNavRef = useRef<HTMLElement | null>(null);
  const [showSupplementalMaterial, setShowSupplementalMaterial] = useState(false);

  useEffect(() => {
    if (isGettingStarted) {
      setShowSupplementalMaterial(false);
      return undefined;
    }

    let frameId = 0;
    const measure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const core = coreSectionsRef.current;
        const nav = bottomNavRef.current;
        if (!core || !nav) return;

        const coreBottom = core.getBoundingClientRect().bottom;
        const navTop = nav.getBoundingClientRect().top;
        const availableHeight = navTop - coreBottom - 8;
        const requiredHeight = estimateMaterialSectionHeight(studyMaterials);
        setShowSupplementalMaterial(availableHeight >= requiredHeight);
      });
    };

    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (resizeObserver && coreSectionsRef.current) {
      resizeObserver.observe(coreSectionsRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      resizeObserver?.disconnect();
    };
  }, [isGettingStarted, studyMaterials]);

  function renderSection(sectionId: HomeSectionId) {
    switch (sectionId) {
      case 'next-plan':
        return (
          <NextPlanSection
            key={sectionId}
            dashboard={dashboard}
            studyMaterials={studyMaterials}
            onOpenAiPlanning={onOpenAiPlanning}
            onOpenDay={onOpenDay}
          />
        );
      case 'today-schedule':
        return (
          <TodayScheduleSection
            key={sectionId}
            dashboard={dashboard}
            studyMaterials={studyMaterials}
            onOpenDay={onOpenDay}
            onOpenSchedule={onOpenSchedule}
          />
        );
      case 'attention':
        return (
          <AttentionSection
            key={sectionId}
            dashboard={dashboard}
            onOpenTodo={onOpenTodo}
            onOpenDay={onOpenDay}
          />
        );
      case 'weekly-progress':
        return (
          <WeeklyProgressSection
            key={sectionId}
            dashboard={dashboard}
            onOpenReport={onOpenReport}
          />
        );
      case 'material-progress':
        return (
          <MaterialProgressSection
            key={sectionId}
            studyMaterials={studyMaterials}
            onOpenBookshelf={onOpenBookshelf}
          />
        );
      case 'getting-started':
        return (
          <GettingStartedSection
            key={sectionId}
            onOpenAiPlanning={onOpenAiPlanning}
            onOpenSchedule={onOpenSchedule}
            onOpenTodo={onOpenTodo}
            onOpenBookshelf={onOpenBookshelf}
          />
        );
      default:
        return null;
    }
  }

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

        <HomeDateDisplay date={dashboard.today} />

        <div className="home-top-actions">
          <button
            className="home-icon-button"
            type="button"
            aria-label="通知"
            title="通知機能は準備中です"
          >
            <Bell aria-hidden="true" size={22} />
          </button>
          <button className="home-avatar-button" type="button" onClick={onOpenProfile} aria-label="マイページを開く">
            <UserAvatar user={user} small />
          </button>
          <button className="home-icon-button" type="button" onClick={onOpenSettings} aria-label="メニューを開く">
            <Menu aria-hidden="true" size={24} />
          </button>
        </div>
      </header>

      {isGettingStarted ? (
        <GettingStartedSection
          onOpenAiPlanning={onOpenAiPlanning}
          onOpenSchedule={onOpenSchedule}
          onOpenTodo={onOpenTodo}
          onOpenBookshelf={onOpenBookshelf}
        />
      ) : (
        <>
          <div className="home-core-sections" ref={coreSectionsRef}>
            {CORE_HOME_SECTION_ORDER.map(renderSection)}
          </div>
          {showSupplementalMaterial ? renderSection('material-progress') : null}
        </>
      )}

      <nav ref={bottomNavRef} className="home-bottom-nav print-hide" aria-label="主要ナビゲーション">
        <button type="button" onClick={onOpenAiPlanning}><MessageCircle aria-hidden="true" /><span>AI計画</span></button>
        <button type="button" onClick={onOpenSchedule}><CalendarDays aria-hidden="true" /><span>予定</span></button>
        <button className="active" type="button" aria-current="page"><span className="home-nav-active-circle"><House aria-hidden="true" /></span><span>ホーム</span></button>
        <button type="button" onClick={onOpenBookshelf}><BookOpen aria-hidden="true" /><span>教材</span></button>
        <button type="button" onClick={onOpenReport}><BarChart3 aria-hidden="true" /><span>分析</span></button>
      </nav>
    </section>
  );
}
