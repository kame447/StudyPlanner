import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Run the actual browser reader without importing an E2E runner or duplicating its key selection.
const source = ts.createSourceFile('vnext-chat-storage.mjs', readFileSync(
  new URL('../e2e/support/vnext-chat-storage.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let initializer = '';
function find(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'readVNextChatStorage') initializer = node.initializer!.getText(source);
  ts.forEachChild(node, find);
}
find(source);
if (!initializer) throw new Error('Missing production-smoke storage reader');

const owner = 'emulator-owner', chat = 'ai-chat-current';
const oldWeek = '2026-11-02', targetWeek = '2026-11-09';
const text = '11月11日の10:30から12:00まで部活があります。その予定を登録したいです。';
const key = (week: string, suffix = 'ui') => `studyplanner.weeklyPlanning.vnext.${owner}.${week}.${chat}.${suffix}`;
const messages = [{ role: 'user', content: text }, { role: 'assistant', content: '登録候補を確認できます。' }];
const ui = (week: string, rows = messages, preview = false) => JSON.stringify({ ownerId: owner, conversationId: 'conversation',
  payload: { version: 2, state: { weekStartDate: week, messages: rows,
    previewCandidates: preview ? [{ source: 'fixed_event_registration' }] : [], draftBlocks: [] } } });
type Snapshot = { messages: number; userTextPersisted: boolean; vnextCoreKeys: number; vnextUiKeys: number; previewSources: string[] };
async function read(entries: [string, string][], week?: string): Promise<Snapshot> {
  const storage = { ...Object.fromEntries(entries) };
  Object.defineProperty(storage, 'getItem', { value: (name: string) => storage[name] ?? null });
  const reader = runInNewContext(`(${initializer})`, { localStorage: storage });
  return reader({ evaluate: async (callback: (arg: unknown) => unknown, arg: unknown) => callback(arg) }, text, week);
}
const index: [string, string] = [`studyplanner.aiPlanning.chats.v1.${owner}`, JSON.stringify({ activeChatId: chat, chats: [{ id: chat }] })];

describe('VNext persisted-turn oracle follows the named planning week', () => {
  it.each([false, true])('counts the target turn with two weeks regardless of key order (targetFirst=%s)', async targetFirst => {
    const before = await read([index, [key(oldWeek), ui(oldWeek, [])]], targetWeek);
    const weeks: [string, string][] = [[key(oldWeek), ui(oldWeek, [])], [key(targetWeek), ui(targetWeek, messages, true)]];
    if (targetFirst) weeks.reverse();
    const after = await read([index, ...weeks, [key(targetWeek, 'core'), '{}']], targetWeek);
    expect(before.messages).toBe(0); expect(after.messages).toBe(before.messages + 2);
    expect(after.userTextPersisted).toBe(true); expect(after.vnextCoreKeys).toBe(1);
    expect(after.vnextUiKeys).toBe(2); expect(after.previewSources).toEqual(['fixed_event_registration']);
  });
  it('keeps the ordinary unambiguous single-week reader', async () => {
    expect(await read([index, [key(oldWeek), ui(oldWeek)]])).toMatchObject({ messages: 2, userTextPersisted: true });
  });
  it('requires a named week when the same chat has multiple slots', async () => {
    await expect(read([index, [key(oldWeek), ui(oldWeek)], [key(targetWeek), ui(targetWeek, [])]]))
      .rejects.toThrow('planning week');
  });
  it('does not pass using another week when the target turn was never persisted', async () => {
    expect(await read([index, [key(oldWeek), ui(oldWeek)]], targetWeek))
      .toMatchObject({ messages: 0, userTextPersisted: false });
  });
});
