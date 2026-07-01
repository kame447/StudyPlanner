export type ParsedWeeklyPlanningCommand = AddUnavailableCommand;

export interface AddUnavailableCommand {
  type: 'add_unavailable';
  range: {
    date?: string;
    start: string;
    end: string;
    hardness: 'hard' | 'soft';
    reason?: string;
  };
  sourceText: string;
  sourceSegment?: string;
  confidence: 'high' | 'medium' | 'low';
}