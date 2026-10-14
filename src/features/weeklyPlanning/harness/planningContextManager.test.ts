import { describe, expect, it } from 'vitest';
import { PlanningContextManager, type PlanningHistoryMessage } from './planningContextManager';
import { utf8ByteLength } from './codexUtf8Budget';

function exchanges(count: number): PlanningHistoryMessage[] {
  return Array.from({ length: count }, (_, index) => [
    { role: 'user' as const, content: `研究${index}は今日は入れない` },
    { role: 'assistant' as const, content: `研究${index}以外について相談しましょう` },
  ]).flat();
}

describe('shared model context window', () => {
  it('retains the beginning of a short consultation instead of always forgetting after four messages', () => {
    const history = exchanges(7);
    const manager = new PlanningContextManager(history);
    const result = manager.forModel();
    expect(result.messages).toEqual(history);
    expect(result.messages.length).toBeGreaterThan(4);
    expect(result.window).toMatchObject({ includedMessageCount: 14, omittedMessageCount: 0 });
    expect(result.window.selectedBytes).toBe(utf8ByteLength(JSON.stringify(result.messages)));
    history[0].content = 'later mutation';
    expect(manager.forModel().messages[0].content).toBe('研究0は今日は入れない');
  });

  it('drops only complete old exchanges while leaving the canonical transcript untouched', () => {
    const history = exchanges(4);
    const before = structuredClone(history);
    const latestExchange = history.slice(-2);
    const budget = utf8ByteLength(JSON.stringify(latestExchange));
    const selected = new PlanningContextManager(history).forModel(budget);
    expect(selected.messages).toEqual(latestExchange);
    expect(selected.messages[0].role).toBe('user');
    expect(selected.window).toMatchObject({
      policy: 'recent_complete_turns', originalMessageCount: 8,
      includedMessageCount: 2, omittedMessageCount: 6,
      selectedBytes: budget, budgetBytes: budget,
    });
    expect(history).toEqual(before);
  });

  it('does not reinterpret a long negation by truncating only part of a user exchange', () => {
    const history = [...exchanges(2),
      { role: 'user' as const, content: '実行するという意味ではない。'.repeat(2000) },
      { role: 'assistant' as const, content: '確認しました。' },
    ];
    const selected = new PlanningContextManager(history).forModel(512);
    expect(selected.messages).toEqual([]);
    expect(selected.window.omittedMessageCount).toBe(history.length);
    expect(history[4].content.endsWith('という意味ではない。')).toBe(true);
  });

  it('counts escaped JSON and Unicode bytes, not a fixed message or character count', () => {
    const history = exchanges(10).map(message => ({ ...message, content: message.content + '\n"😀\\' }));
    for (let budget = 2; budget < 1500; budget += 23) {
      const selected = new PlanningContextManager(history).forModel(budget);
      expect(utf8ByteLength(JSON.stringify(selected.messages))).toBeLessThanOrEqual(budget);
      expect(selected.window.selectedBytes).toBe(utf8ByteLength(JSON.stringify(selected.messages)));
      if (selected.messages.length > 0) expect(selected.messages[0].role).toBe('user');
      expect(selected.messages.length % 2).toBe(0);
    }
  });

  it('keeps independent immutable views for simultaneous sessions and sampling budgets', () => {
    const a = new PlanningContextManager(exchanges(6));
    const b = new PlanningContextManager([{ role: 'user', content: '英語の相談' }]);
    const first = a.forModel();
    a.forModel(128);
    expect(a.forModel()).toEqual(first);
    expect(b.forModel().messages).toEqual([{ role: 'user', content: '英語の相談' }]);
    expect(() => first.messages.push({ role: 'assistant', content: 'injected' })).toThrow();
    expect(new PlanningContextManager([]).forModel(2).window.selectedBytes).toBe(2);
    expect(() => a.forModel(1)).toThrow(RangeError);
  });
});
