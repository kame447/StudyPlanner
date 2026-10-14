import type { ChatMessage } from '../../../services/ai/openAiCompatibleClientTypes';
import { utf8ByteLength } from './codexUtf8Budget';
import { snapshotContextValue } from './planningContextSnapshot';

/** A captured model request, not a persisted source of planning truth. */
export class PlanningModelPrompt {
  private readonly items: ChatMessage[];
  readonly requestBytes: number;

  constructor(messages: readonly ChatMessage[]) {
    this.items = snapshotContextValue([...messages]);
    this.requestBytes = utf8ByteLength(JSON.stringify(this.items));
  }

  /** A fresh transport copy keeps clients/instrumentation from altering retries. */
  messages(): ChatMessage[] {
    return this.items.map(item => ({ ...item }));
  }

  withMessage(message: ChatMessage): PlanningModelPrompt {
    return new PlanningModelPrompt([...this.items, message]);
  }

  trace(): { messages: ChatMessage[]; requestBytes: number } {
    return { messages: this.messages(), requestBytes: this.requestBytes };
  }
}

/**
 * Adaptation of Codex StepContext: every sampling attempt uses the same captured
 * input for prompt generation AND validation, even if callers change later.
 * Live cancellation capabilities remain in the caller's originating turn.
 */
export class PlanningModelStep<T> {
  readonly input: T;

  constructor(input: T) {
    this.input = snapshotContextValue(input);
  }

  prompt(build: (input: T) => readonly ChatMessage[]): PlanningModelPrompt {
    return new PlanningModelPrompt(build(this.input));
  }
}
