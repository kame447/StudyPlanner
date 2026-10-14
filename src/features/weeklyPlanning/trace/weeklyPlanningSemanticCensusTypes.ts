import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';

/** Invocation-local observation port, independent of browser configuration/telemetry. */
export interface WeeklyPlanningSemanticTurnObservation {
  client: OpenAiCompatibleClient;
  finish(resolution: 'success' | 'failure' | 'unknown'): void;
}
