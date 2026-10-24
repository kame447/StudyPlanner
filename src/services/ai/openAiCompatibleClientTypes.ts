import type { SemanticCensusJoin, SemanticCensusRequestObserver } from '../../../shared/semanticTurnCensus';
import type { SemanticDispatchStage } from '../../../shared/semanticDispatchLedger';
import type { FocusedDecisionContext } from '../../../shared/focusedContextualDecision';
import type { AiChatPurpose } from '../../lib/aiModelPolicy';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}


export interface JsonSchemaResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}


export interface OpenAiCompatibleClient {
  /** Invocation-local capability, present only on a census-wrapped client. */
  semanticCensusEnabled?: boolean;
  semanticCensusObserver?: SemanticCensusRequestObserver;
  createChatCompletion(input: {
    /** Telemetry only; injected after semantic trace capture and sent only to our proxy. */
    semanticCensus?: SemanticCensusJoin;
    semanticCensusStage?: SemanticDispatchStage;
    decisionContext?: FocusedDecisionContext;
    messages: ChatMessage[];
    temperature?: number;
    responseFormat?: JsonSchemaResponseFormat;
    purpose?: AiChatPurpose;
    maxCompletionTokens?: number;
  }): Promise<string>;
}
