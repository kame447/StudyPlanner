export function normalizeStudyTaskTitle(title: string): string {
  return title.trim().normalize('NFKC').replace(/\s+/g, ' ');
}

export function studyGoalIdentity(title: string, subject?: string): string {
  return `study_goal:${normalizeStudyTaskTitle(title)}:${normalizeStudyTaskTitle(subject ?? '')}`;
}
