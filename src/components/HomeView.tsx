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
const MAX_SUPPLEMENTAL_MATERIAL_ROWS = 3;

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
  const activeStudyMaterials = useMemo(
    () =>
      studyMaterials
        .filter((material) => material.status !== 'archived')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [studyMaterials],
  );
  const supplementalMaterialCandidates = useMemo(() => {
    if (activeStudyMaterials.length === 0) return [0];
    return Array.from(
      { length: Math.min(MAX_SUPPLEMENTAL_MATERIAL_ROWS, activeStudyMaterials.length) },
      (_, index) => index + 1,
    );
  }, [activeStudyMaterials]);
  const coreSectionsRef = useRef<HTMLDivElement | null>(null);
  const bottomNavRef = useRef<HTMLElement | null>(null);
  const materialProbeRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [supplementalMaterialRows, setSupplementalMaterialRows] = useState<number | null>(null);
  const supplementalStudyMaterials = useMemo(() => {
    if (supplementalMaterialRows === null) return [];
    return activeStudyMaterials.slice(0, supplementalMaterialRows);
  }, [activeStudyMaterials, supplementalMaterialRows]);

  useEffect(() => {
    if (isGettingStarted) {
      setSupplementalMaterialRows(null);
      return undefined;
    }

    let frameId = 0;
    const measure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const core = coreSectionsRef.current;
        const nav = bottomNavRef.current;
        const dashboardElement = core?.closest('.home-dashboard-default');
        if (!core || !nav || !(dashboardElement instanceof HTMLElement)) return;

        const coreBottom = core.getBoundingClientRect().bottom;
        const navTop = nav.getBoundingClientRect().top;
        const rowGap = Number.parseFloat(window.getComputedStyle(dashboardElement).rowGap) || 0;
        const availableHeight = Math.max(0, navTop - coreBottom - rowGap);

        let largestCandidateThatFits: number | null = null;
        for (const rowCount of supplementalMaterialCandidates) {
          const probe = materialProbeRefs.current.get(rowCount);
          if (!probe) continue;
          const measuredHeight = probe.getBoundingClientRect().height;
          if (measuredHeight <= availableHeight + 0.5) {
            largestCandidateThatFits = rowCount;
          }
        }

        setSupplementalMaterialRows((current) =>
          current === largestCandidateThatFits ? current : largestCandidateThatFits,
        );
      });
    };

    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (resizeObserver) {
      if (coreSectionsRef.current) resizeObserver.observe(coreSectionsRef.current);
      if (bottomNavRef.current) resizeObserver.observe(bottomNavRef.current);
      for (const probe of materialProbeRefs.current.values()) {
        resizeObserver.observe(probe);
      }
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      resizeObserver?.disconnect();
    };
  }, [isGettingStarted, supplementalMaterialCandidates]);

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

  const dashboardClassName = isGettingStarted
    ? 'home-dashboard home-dashboard-setup'
    : 'home-dashboard home-dashboard-default';

  return (
    <section className={dashboardClassName} aria-label="ホーム">
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
          {supplementalMaterialRows !== null ? (
            <MaterialProgressSection
              studyMaterials={supplementalStudyMaterials}
              onOpenBookshelf={onOpenBookshelf}
            />
          ) : null}
          <div className="home-material-measurements" aria-hidden="true">
            {supplementalMaterialCandidates.map((rowCount) => (
              <div
                className="home-material-measurement"
                key={rowCount}
                ref={(node) => {
                  if (node) materialProbeRefs.current.set(rowCount, node);
                  else materialProbeRefs.current.delete(rowCount);
                }}
              >
                <MaterialProgressSection
                  studyMaterials={activeStudyMaterials.slice(0, rowCount)}
                  onOpenBookshelf={onOpenBookshelf}
                />
              </div>
            ))}
          </div>
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
