import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import type {
  WeeklyPlanningStableV5DialogueRenderInput,
  WeeklyPlanningStableV5DialogueRenderResult,
} from './weeklyPlanningStableV5DialogueContracts';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';

/** Reorder presentation only; the complete composed reply must pass the same validator. */
export function parseWeeklyPlanningDialogueWithAcknowledgement(
  rawResponse: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): WeeklyPlanningStableV5DialogueRenderResult {
  const initial = parseWeeklyPlanningStableV5DialogueRendererResponse(rawResponse, input);
  if (!conversationArchitecturePolicy(input.conversationArchitecture).interactionOutcome
    || initial.status !== 'fallback' || initial.reason !== 'grounding_contract_mismatch') return initial;

  // A grounding mismatch comes only after successful JSON/shape/action validation.
  const parsed = JSON.parse(rawResponse) as {
    text: string;
    groundingAcknowledgement?: { text?: unknown } | null;
  };
  const acknowledgement = parsed.groundingAcknowledgement?.text;
  if (typeof acknowledgement !== 'string' || !acknowledgement.trim()) return initial;
  const prefix = acknowledgement.replace(/\r\n/g, '\n').trim();
  const body = parsed.text.replace(/\r\n/g, '\n').trim();
  if (body.startsWith(prefix)) return initial;

  // An exact ACK already present later in the reply is moved, never duplicated.
  const remainder = body.split(prefix).join('').trim();
  const text = remainder ? `${prefix}\n\n${remainder}` : prefix;
  const composed = parseWeeklyPlanningStableV5DialogueRendererResponse(
    JSON.stringify({ ...parsed, text }), input,
  );
  // Keep the original provider bytes as evidence, including when composition is rejected.
  return { ...composed, rawResponse };
}
