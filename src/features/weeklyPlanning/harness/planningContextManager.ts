import { approximateTokenCount, assertByteBudget, utf8ByteLength } from './codexUtf8Budget';
import { snapshotContextValue } from './planningContextSnapshot';

export interface PlanningHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface PlanningHistoryWindow {
  version: 1;
  policy: 'recent_complete_turns';
  budgetBytes: number;
  originalMessageCount: number;
  includedMessageCount: number;
  omittedMessageCount: number;
  selectedBytes: number;
  approximateTokens: number;
}

export const PLANNING_HISTORY_BUDGET_BYTES = 8 * 1024;

/**
 * Model-window projection, following Codex ContextManager's separation of
 * saved history and retained host facts. The existing chat store remains the
 * sole transcript owner. No summary becomes a fact, consent or approval.
 */
export class PlanningContextManager {
  private readonly items: PlanningHistoryMessage[];

  constructor(history: readonly PlanningHistoryMessage[]) {
    this.items = snapshotContextValue(history.map(({ role, content }) => ({ role, content })));
  }

  /** Keep a chronological suffix of whole exchanges, never a dangling answer. */
  forModel(budgetBytes = PLANNING_HISTORY_BUDGET_BYTES): {
    messages: PlanningHistoryMessage[];
    window: PlanningHistoryWindow;
  } {
    assertByteBudget(budgetBytes);
    if (budgetBytes < 2) throw new RangeError('History budget must fit a JSON array');
    const starts = [0];
    for (let i = 1; i < this.items.length; i += 1) {
      if (this.items[i].role === 'user') starts.push(i);
    }
    let firstIncluded = this.items.length;
    let selectedBytes = 2; // JSON array brackets; count escaped strings, not JS code units.
    let includedCount = 0;
    for (let group = starts.length - 1; group >= 0; group -= 1) {
      const start = starts[group];
      const end = starts[group + 1] ?? this.items.length;
      const entries = this.items.slice(start, end);
      const cost = entries.reduce((sum, entry) => sum + utf8ByteLength(JSON.stringify(entry)), 0)
        + Math.max(0, entries.length - 1) + (includedCount > 0 && entries.length > 0 ? 1 : 0);
      if (selectedBytes + cost > budgetBytes) break;
      selectedBytes += cost;
      includedCount += entries.length;
      firstIncluded = start;
    }
    const messages = this.items.slice(firstIncluded).map(item => ({ ...item }));
    const window: PlanningHistoryWindow = {
      version: 1,
      policy: 'recent_complete_turns',
      budgetBytes,
      originalMessageCount: this.items.length,
      includedMessageCount: messages.length,
      omittedMessageCount: this.items.length - messages.length,
      selectedBytes,
      approximateTokens: messages.reduce((sum, message) => sum + approximateTokenCount(message.content), 0),
    };
    // Consumers may build their provider DTOs without mutating this snapshot.
    return snapshotContextValue({ messages, window });
  }
}
