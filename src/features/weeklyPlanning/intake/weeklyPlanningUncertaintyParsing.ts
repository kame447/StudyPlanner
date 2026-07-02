import type { NoteUncertaintyCommand } from './weeklyPlanningCommandTypes';
import { normalizeIntakeText } from './weeklyPlanningTextParsing';

const UNKNOWN_FIELD_DURATION_PATTERN = /知らない分野.*時間かかる|細かく見る.*時間かかる/;

export function parseNoteUncertaintyCommand(text: string): NoteUncertaintyCommand | undefined {
  const match = normalizeIntakeText(text).match(UNKNOWN_FIELD_DURATION_PATTERN);

  return match
    ? {
        type: 'note_uncertainty',
        uncertainty: 'unknown_fields_may_take_longer',
        sourceText: text,
        sourceSegment: match[0],
        confidence: 'medium',
      }
    : undefined;
}
