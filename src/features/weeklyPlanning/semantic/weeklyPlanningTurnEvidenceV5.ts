/** A UI-selected reference is context, never text authored by the user. */
export interface WeeklyPlanningSelectedStarterTargetV5 {
  kind: 'plan' | 'todo' | 'material';
  id: string;
  label: string;
  targetDate: string | null;
}

export interface WeeklyPlanningTurnEvidenceV5 {
  userText: string;
  supplementalContext?: string;
  selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5;
}
