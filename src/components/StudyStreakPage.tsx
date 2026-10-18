import { useSharedStudyStreak } from './StudyStreakContext';
import { StudyStreakView } from './StudyStreakView';

export function StudyStreakPage({ onClose }: { onClose: () => void }) {
  const shared = useSharedStudyStreak();
  if (!shared) return null;
  const { controller: history, today, displayModel } = shared;
  return <StudyStreakView today={today} model={displayModel} onClose={onClose}
    pending={history.status === 'loading'} refreshing={history.refreshing} error={history.readError ?? history.saveError} onRetry={history.retry} />;
}
