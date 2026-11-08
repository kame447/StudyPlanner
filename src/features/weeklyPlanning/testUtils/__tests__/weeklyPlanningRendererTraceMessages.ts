import { WEEKLY_PLANNING_STABLE_V5_DIALOGUE_INSTRUCTION_PROMPT } from '../../dialogue/weeklyPlanningStableV5DialoguePrompt';

/**
 * #977: the renderer sends its fixed instructions as the tail of the system message, but a trace
 * records only the per-turn part (the short system text and the user JSON) plus the instruction
 * version. This maps the messages actually sent to the messages a trace must hold, and fails when
 * the fixed instructions are not exactly where the sender is supposed to put them.
 */
export function rendererTraceMessages<T extends { role: string; content: string }>(sent: readonly T[]): T[] {
  const [system, ...rest] = sent;
  const suffix = `\n${WEEKLY_PLANNING_STABLE_V5_DIALOGUE_INSTRUCTION_PROMPT}`;
  if (system?.role !== 'system' || !system.content.endsWith(suffix)) {
    throw new Error('renderer system message does not end with the fixed instructions');
  }
  return [{ ...system, content: system.content.slice(0, -suffix.length) }, ...rest];
}
