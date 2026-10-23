import { useHomeDisplayClock } from './home/HomeDisplayClockContext';
import { useMemo } from 'react';
import { Menu } from 'lucide-react';
import { collectStudyDates } from '../lib/studyStreak';
import { StudyStreakFlame } from './StudyStreakFlame';
import { useSharedStudyStreak } from './StudyStreakContext';
import { toIsoDate } from '../lib/date';
import type { Actual, MonthEvent, Plan, TodoTask, User } from '../types/domain';
import { AnnouncementsButton } from './AnnouncementsButton';
import { HomeDateDisplay } from './HomeDateDisplay';
import { UserAvatar } from './UserAvatar';

interface HomeTopbarProps {
  user: User;
  plans: Plan[];
  actuals: Actual[];
  monthEvents?: MonthEvent[];
  todos: TodoTask[];
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenStudyStreak?: () => void;
}

export function HomeTopbar({
  user,
  plans,
  actuals,
  monthEvents,
  onOpenProfile,
  onOpenSettings,
  onOpenStudyStreak,
}: HomeTopbarProps) {
  const today = toIsoDate(useHomeDisplayClock());
  const shared = useSharedStudyStreak();
  const snapshot = shared?.userId === user.id && shared.today === today
    && shared.plans === plans && shared.actuals === actuals && shared.monthEvents === monthEvents ? shared : null;
  // The shared calendar has already normalized these records. Standalone
  // headers use the same predicate without constructing a full dashboard.
  const studiedToday = useMemo(() => snapshot
    ? snapshot.displayModel.studyDates.includes(today)
    : collectStudyDates({ userId: user.id, plans, actuals, monthEvents, today }).includes(today),
  [snapshot, user.id, plans, actuals, monthEvents, today]);
  const verifiedModel = snapshot?.controller.model?.historyComplete && snapshot.controller.model.today === today
    ? snapshot.controller.model : null;
  const currentStreak = verifiedModel?.currentStreak ?? null;
  const bestStreak = verifiedModel?.bestStreak ?? null;

  return (
    <header className="home-topbar">
      <button className="home-streak-card" type="button" aria-busy={shared?.userId === user.id && shared.controller.refreshing} aria-label={`連続学習 ${currentStreak === null ? '未確認' : `${currentStreak}日`}、学習記録を開く`} onClick={event => {
        event.currentTarget.focus({ preventScroll: true });
        onOpenStudyStreak?.();
      }}>
        <StudyStreakFlame className="home-streak-flame" studiedToday={studiedToday} size={30} />
        <div>
          <span>連続学習</span>
          <strong>{currentStreak ?? '—'}日</strong>
          <small>最高 {bestStreak ?? '—'}日</small>
        </div>
      </button>

      <HomeDateDisplay date={today} />

      <div className="home-top-actions">
        <AnnouncementsButton userId={user.id} />
        <button
          className="home-avatar-button"
          type="button"
          onClick={onOpenProfile}
          aria-label="マイページを開く"
        >
          <UserAvatar user={user} small />
        </button>
        <button
          className="home-icon-button"
          type="button"
          onClick={(event) => {
            // Safari does not focus a button on pointer activation by default.
            event.currentTarget.focus({ preventScroll: true });
            onOpenSettings();
          }}
          aria-label="メニューを開く"
        >
          <Menu aria-hidden="true" size={24} />
        </button>
      </div>
    </header>
  );
}
