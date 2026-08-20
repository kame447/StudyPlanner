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

interface HomeLayoutRelaxation {
  hero: number;
  row: number;
  scheduleSide: number;
  todaySide: number;
  alertSide: number;
  progressSide: number;
  topbar: number;
  materialSide: number;
  gap: number;
}

const CORE_HOME_SECTION_ORDER = DEFAULT_HOME_SECTION_ORDER.filter(
  (sectionId) => sectionId !== 'material-progress',
);
const MAX_SUPPLEMENTAL_MATERIAL_ROWS = 3;
const MAX_VISIBLE_TODAY_ROWS = 4;
const MIN_SCROLLABLE_SCHEDULE_HEIGHT = 40;
const TARGET_BOTTOM_GAP = 8;
const MATERIAL_FIT_HYSTERESIS_PX = 4;
const DEFAULT_MAX_NEXT_CARD_HEIGHT = 226;
const TALL_MAX_NEXT_CARD_HEIGHT = 286;
const WIDE_TALL_MAX_NEXT_CARD_HEIGHT = 320;
const DEFAULT_MAX_SCHEDULE_ROW_HEIGHT = 50;
const WIDE_TALL_MAX_SCHEDULE_ROW_HEIGHT = 70;
const DEFAULT_MAX_TOPBAR_HEIGHT = 62;
const WIDE_TALL_MAX_TOPBAR_HEIGHT = 94;
const TALL_VIEWPORT_MIN_HEIGHT = 1000;
const WIDE_VIEWPORT_MIN_WIDTH = 700;
const SHORT_VIEWPORT_MAX_HEIGHT = 700;

function emptyLayoutRelaxation(): HomeLayoutRelaxation {
  return {
    hero: 0,
    row: 0,
    scheduleSide: 0,
    todaySide: 0,
    alertSide: 0,
    progressSide: 0,
    topbar: 0,
    materialSide: 0,
    gap: 0,
  };
}

function hasLayoutRelaxation(relaxation: HomeLayoutRelaxation): boolean {
  return Object.values(relaxation).some((value) => value > 0.25);
}

function preferredScheduleListHeight(scheduleList: HTMLElement): number {
  const rows = Array.from(scheduleList.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  if (rows.length <= MAX_VISIBLE_TODAY_ROWS) return scheduleList.scrollHeight;

  return rows
    .slice(0, MAX_VISIBLE_TODAY_ROWS)
    .reduce((height, row) => height + row.getBoundingClientRect().height, 0);
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
  const layoutRelaxationRef = useRef<HomeLayoutRelaxation>(emptyLayoutRelaxation());
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
        const todayPanel = core?.querySelector<HTMLElement>('[data-home-section="today-schedule"]');
        const scheduleList = todayPanel?.querySelector<HTMLElement>('.home-schedule-list');
        const nextCard = core?.querySelector<HTMLElement>('[data-home-section="next-plan"]');
        const alertGrid = core?.querySelector<HTMLElement>('[data-home-section="attention"]');
        const topbar = dashboardElement?.querySelector<HTMLElement>('.home-topbar');
        if (
          !core ||
          !nav ||
          !(dashboardElement instanceof HTMLElement) ||
          !todayPanel ||
          !scheduleList ||
          !nextCard ||
          !alertGrid ||
          !topbar
        ) {
          return;
        }

        const isTallViewport = window.innerHeight >= TALL_VIEWPORT_MIN_HEIGHT;
        const isWideViewport = window.innerWidth >= WIDE_VIEWPORT_MIN_WIDTH;
        const isWideTallViewport = isTallViewport && isWideViewport;
        const allowSupplementalMaterial = window.innerHeight > SHORT_VIEWPORT_MAX_HEIGHT;
        const maxNextCardHeight = isWideTallViewport
          ? WIDE_TALL_MAX_NEXT_CARD_HEIGHT
          : isTallViewport
            ? TALL_MAX_NEXT_CARD_HEIGHT
            : DEFAULT_MAX_NEXT_CARD_HEIGHT;
        const maxScheduleRowHeight = isWideTallViewport
          ? WIDE_TALL_MAX_SCHEDULE_ROW_HEIGHT
          : DEFAULT_MAX_SCHEDULE_ROW_HEIGHT;
        const maxTopbarHeight = isWideTallViewport
          ? WIDE_TALL_MAX_TOPBAR_HEIGHT
          : DEFAULT_MAX_TOPBAR_HEIGHT;
        const maxScheduleSideRelaxation = isWideTallViewport ? 12 : isTallViewport ? 11 : 2;
        const maxTodaySideRelaxation = isWideTallViewport ? 14 : isTallViewport ? 12 : 5;
        const maxAlertSideRelaxation = isWideTallViewport ? 8 : isTallViewport ? 6 : 2;
        const maxProgressSideRelaxation = isWideTallViewport ? 22 : 0;
        const maxMaterialSideRelaxation = isWideTallViewport ? 14 : isTallViewport ? 14 : 6;
        const maxSectionGap = isWideTallViewport ? 20 : isTallViewport ? 18 : 12;

        const setRelaxationProperty = (name: string, value: number) => {
          if (value <= 0.05) {
            dashboardElement.style.removeProperty(name);
          } else {
            dashboardElement.style.setProperty(name, `${value.toFixed(2)}px`);
          }
        };
        const applyLayoutRelaxation = (next: HomeLayoutRelaxation) => {
          const current = layoutRelaxationRef.current;
          const changed = (Object.keys(next) as Array<keyof HomeLayoutRelaxation>).some(
            (key) => Math.abs(next[key] - current[key]) > 0.1,
          );
          if (!changed) return false;

          layoutRelaxationRef.current = next;
          setRelaxationProperty('--home-relax-hero', next.hero);
          setRelaxationProperty('--home-relax-row', next.row);
          setRelaxationProperty('--home-relax-schedule-side', next.scheduleSide);
          setRelaxationProperty('--home-relax-today-side', next.todaySide);
          setRelaxationProperty('--home-relax-alert-side', next.alertSide);
          setRelaxationProperty('--home-relax-progress-side', next.progressSide);
          setRelaxationProperty('--home-relax-topbar', next.topbar);
          setRelaxationProperty('--home-relax-material-side', next.materialSide);
          setRelaxationProperty('--home-relax-gap', next.gap);
          return true;
        };
        const resetLayoutRelaxation = () =>
          applyLayoutRelaxation(emptyLayoutRelaxation());

        const coreRect = core.getBoundingClientRect();
        const todayRect = todayPanel.getBoundingClientRect();
        const navTop = nav.getBoundingClientRect().top;
        const rowGap = Number.parseFloat(window.getComputedStyle(dashboardElement).rowGap) || 0;
        const visibleScheduleChildren = Array.from(scheduleList.children)
          .filter((element): element is HTMLElement => element instanceof HTMLElement)
          .slice(0, MAX_VISIBLE_TODAY_ROWS);
        const scheduleRows = Array.from(
          scheduleList.querySelectorAll<HTMLElement>('.home-schedule-row'),
        ).slice(0, MAX_VISIBLE_TODAY_ROWS);
        const availableCoreHeight = Math.max(0, navTop - coreRect.top);
        const preferredListHeight = preferredScheduleListHeight(scheduleList);
        const todayChromeHeight = Math.max(0, todayRect.height - scheduleList.clientHeight);
        const preferredTodayHeight = todayChromeHeight + preferredListHeight;
        const preferredCoreHeight = coreRect.height - todayRect.height + preferredTodayHeight;
        const needsFourRowCap = scheduleList.children.length > MAX_VISIBLE_TODAY_ROWS;
        const currentRelaxation = layoutRelaxationRef.current;
        const internalCoreGapCount = Math.max(0, core.children.length - 1);
        const compactCoreRelaxationImpact =
          currentRelaxation.hero +
          currentRelaxation.row * scheduleRows.length +
          currentRelaxation.scheduleSide * 2 * visibleScheduleChildren.length +
          currentRelaxation.todaySide * 2 +
          currentRelaxation.alertSide * 2 +
          currentRelaxation.progressSide * 2 +
          currentRelaxation.gap * internalCoreGapCount;
        const compactPreferredCoreHeight = Math.max(
          0,
          preferredCoreHeight - compactCoreRelaxationImpact,
        );
        const compactAvailableCoreHeight =
          availableCoreHeight + currentRelaxation.topbar + currentRelaxation.gap;
        const compactOuterGap = Math.max(0, rowGap - currentRelaxation.gap);

        const setScheduleMaxHeight = (maxHeight: number | null) => {
          const propertyName = '--home-dynamic-schedule-max';
          if (maxHeight === null) {
            if (dashboardElement.style.getPropertyValue(propertyName)) {
              dashboardElement.style.removeProperty(propertyName);
            }
            return;
          }
          const nextValue = `${Math.max(0, Math.floor(maxHeight))}px`;
          if (dashboardElement.style.getPropertyValue(propertyName) !== nextValue) {
            dashboardElement.style.setProperty(propertyName, nextValue);
          }
        };

        let largestCandidateThatFits: number | null = null;
        if (allowSupplementalMaterial) {
          for (const rowCount of supplementalMaterialCandidates) {
            const probe = materialProbeRefs.current.get(rowCount);
            if (!probe) continue;
            const measuredHeight = probe.getBoundingClientRect().height;
            const compactMeasuredHeight = Math.max(
              0,
              measuredHeight - currentRelaxation.materialSide * 2,
            );
            const fitSlack =
              compactAvailableCoreHeight -
              (compactPreferredCoreHeight + compactOuterGap + compactMeasuredHeight);
            const requiredSlack =
              rowCount === supplementalMaterialRows ? -0.5 : MATERIAL_FIT_HYSTERESIS_PX;
            if (fitSlack >= requiredSlack) {
              largestCandidateThatFits = rowCount;
            }
          }
        }

        if (largestCandidateThatFits !== supplementalMaterialRows) {
          if (hasLayoutRelaxation(currentRelaxation)) {
            if (resetLayoutRelaxation()) measure();
            return;
          }
          setScheduleMaxHeight(needsFourRowCap ? preferredListHeight : null);
          setSupplementalMaterialRows(largestCandidateThatFits);
          return;
        }

        if (compactPreferredCoreHeight > compactAvailableCoreHeight + 0.5) {
          if (hasLayoutRelaxation(currentRelaxation)) {
            if (resetLayoutRelaxation()) measure();
            return;
          }

          const coreHeightWithoutPreferredList = preferredCoreHeight - preferredListHeight;
          const emergencyScheduleHeight = Math.min(
            preferredListHeight,
            Math.max(
              MIN_SCROLLABLE_SCHEDULE_HEIGHT,
              availableCoreHeight - coreHeightWithoutPreferredList,
            ),
          );
          setScheduleMaxHeight(emergencyScheduleHeight);
          setSupplementalMaterialRows((current) => (current === null ? current : null));
          return;
        }

        setScheduleMaxHeight(needsFourRowCap ? preferredListHeight : null);

        const selectedMaterialProbe =
          supplementalMaterialRows === null
            ? null
            : materialProbeRefs.current.get(supplementalMaterialRows) ?? null;
        const selectedMaterialHeight =
          selectedMaterialProbe?.getBoundingClientRect().height ?? 0;
        const currentUsedHeight =
          preferredCoreHeight +
          (supplementalMaterialRows === null ? 0 : rowGap + selectedMaterialHeight);
        const currentSlack = availableCoreHeight - currentUsedHeight;

        if (currentSlack < -0.5 && hasLayoutRelaxation(currentRelaxation)) {
          if (resetLayoutRelaxation()) measure();
          return;
        }

        let remaining = currentSlack - TARGET_BOTTOM_GAP;
        if (remaining <= 0.5) return;

        const nextRelaxation = { ...currentRelaxation };

        const heroCapacity = Math.max(
          0,
          maxNextCardHeight - nextCard.getBoundingClientRect().height,
        );
        const heroAddition = Math.min(heroCapacity, remaining);
        nextRelaxation.hero += heroAddition;
        remaining -= heroAddition;

        if (remaining > 0.5 && scheduleRows.length > 0) {
          const rowCapacity = Math.max(
            0,
            Math.min(
              ...scheduleRows.map((row) =>
                maxScheduleRowHeight - row.getBoundingClientRect().height,
              ),
            ),
          );
          const rowAddition = Math.min(rowCapacity, remaining / scheduleRows.length);
          nextRelaxation.row += rowAddition;
          remaining -= rowAddition * scheduleRows.length;
          if (rowAddition > 0.05 && needsFourRowCap) {
            setScheduleMaxHeight(
              preferredListHeight + rowAddition * scheduleRows.length,
            );
          }
        }

        if (remaining > 0.5 && visibleScheduleChildren.length > 0) {
          const sideCapacity = Math.max(
            0,
            maxScheduleSideRelaxation - nextRelaxation.scheduleSide,
          );
          const sideAddition = Math.min(
            sideCapacity,
            remaining / (2 * visibleScheduleChildren.length),
          );
          nextRelaxation.scheduleSide += sideAddition;
          const scheduleImpact = sideAddition * 2 * visibleScheduleChildren.length;
          remaining -= scheduleImpact;
          if (sideAddition > 0.05 && needsFourRowCap) {
            setScheduleMaxHeight(preferredListHeight + scheduleImpact);
          }
        }

        if (remaining > 0.5) {
          const sideCapacity = Math.max(
            0,
            maxTodaySideRelaxation - nextRelaxation.todaySide,
          );
          const sideAddition = Math.min(sideCapacity, remaining / 2);
          nextRelaxation.todaySide += sideAddition;
          remaining -= sideAddition * 2;
        }

        if (remaining > 0.5) {
          const sideCapacity = Math.max(
            0,
            maxAlertSideRelaxation - nextRelaxation.alertSide,
          );
          const sideAddition = Math.min(sideCapacity, remaining / 2);
          nextRelaxation.alertSide += sideAddition;
          remaining -= sideAddition * 2;
        }

        if (remaining > 0.5 && maxProgressSideRelaxation > 0) {
          const sideCapacity = Math.max(
            0,
            maxProgressSideRelaxation - nextRelaxation.progressSide,
          );
          const sideAddition = Math.min(sideCapacity, remaining / 2);
          nextRelaxation.progressSide += sideAddition;
          remaining -= sideAddition * 2;
        }

        if (remaining > 0.5) {
          const topbarCapacity = Math.max(
            0,
            maxTopbarHeight - topbar.getBoundingClientRect().height,
          );
          const topbarAddition = Math.min(topbarCapacity, remaining);
          nextRelaxation.topbar += topbarAddition;
          remaining -= topbarAddition;
        }

        if (remaining > 0.5 && supplementalMaterialRows !== null) {
          const sideCapacity = Math.max(
            0,
            maxMaterialSideRelaxation - nextRelaxation.materialSide,
          );
          const sideAddition = Math.min(sideCapacity, remaining / 2);
          nextRelaxation.materialSide += sideAddition;
          remaining -= sideAddition * 2;
        }

        if (remaining > 0.5) {
          const gapCapacity = Math.max(0, maxSectionGap - rowGap);
          const activeGapCount =
            internalCoreGapCount + 1 + (supplementalMaterialRows === null ? 0 : 1);
          if (gapCapacity > 0 && activeGapCount > 0) {
            const gapAddition = Math.min(gapCapacity, remaining / activeGapCount);
            nextRelaxation.gap += gapAddition;
            remaining -= gapAddition * activeGapCount;
          }
        }

        // One external trigger gets one expansion pass. A reset may schedule one
        // compact re-measure above, but expansion itself must not recursively
        // measure its own size changes; that was the remaining feedback path.
        applyLayoutRelaxation(nextRelaxation);
      });
    };

    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);

    // Do not observe the fitted dashboard elements themselves. measure()
    // changes their dimensions, which would turn ResizeObserver into a
    // self-triggering loop near fit thresholds.
    void document.fonts.ready.then(measure, () => undefined);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [
    dashboard.todayPlans.length,
    dashboard.upcomingPlans.length,
    isGettingStarted,
    supplementalMaterialCandidates,
    supplementalMaterialRows,
  ]);

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
