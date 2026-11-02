import { expect } from '@playwright/test';

// Shared by the production smoke (weekly-planning-vnext-production.live.mjs) and the CI emulator spec
// (emulator/vnext-conversation.emulator.mjs) so one contract runs before and after every deploy.
//
// What a VNext turn persists, per chat (weeklyPlanningVNextLocalSession.ts):
//   <prefix>.ui   the chat's UI snapshot. It is written when the chat opens and rewritten by every turn,
//                 so its key COUNT never grows on a first turn; the contract is its message count.
//   <prefix>.core the accepted-fact checkpoint, written by every accepted turn, consultation included.
// Only counts and booleans leave the page: never message bodies, ids or tokens.
export const readVNextChatStorage = (page, userText = null) => page.evaluate(text => {
  // Chats of the signed-out screen live under the owner 'anonymous' next to the signed-in owner's; their order in
  // localStorage is not stable, so only the signed-in owner's keys are read.
  const keys = Object.keys(localStorage).filter(key => !key.includes('.anonymous'));
  const vnext = suffix => keys.filter(key => key.startsWith('studyplanner.weeklyPlanning.vnext.') && key.endsWith(suffix));
  const readJson = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const indexKey = keys.find(key => key.startsWith('studyplanner.aiPlanning.chats.v1.'));
  const index = indexKey ? readJson(indexKey) : null;
  const activeChatId = index?.activeChatId ?? null;
  const ui = vnext('.ui');
  const states = ui.map(key => readJson(key)?.payload?.state ?? null);
  const activeKey = activeChatId ? ui.find(key => key.endsWith(`.${activeChatId}.ui`)) : undefined;
  const activeMessages = (activeKey ? readJson(activeKey)?.payload?.state?.messages : null) ?? [];
  return {
    vnextUiKeys: ui.length,
    vnextCoreKeys: vnext('.core').length,
    stableV5Keys: keys.filter(key => key.includes('.weeklyPlanning.stableV5.')).length,
    chats: Array.isArray(index?.chats) ? index.chats.length : null,
    // The active chat's persisted messages (what a reload restores).
    messages: activeMessages.length,
    userTextPersisted: text === null ? null
      : activeMessages.some(message => message?.role === 'user' && typeof message.content === 'string' && message.content.includes(text)),
    previewSources: states.flatMap(state => state?.previewCandidates?.map(candidate => candidate.source) ?? []),
    draftBlocks: states.reduce((sum, state) => sum + (state?.draftBlocks?.length ?? 0), 0),
  };
}, userText);

// A turn adds exactly the user's message and the assistant's reply to the active chat, persists its text, and writes the checkpoint.
export function expectTurnPersisted(before, after) {
  expect(after.messages, 'a turn adds exactly one user message and one reply to the active chat').toBe(before.messages + 2);
  expect(after.userTextPersisted, 'the user text is among the persisted messages').toBe(true);
  expect(after.vnextCoreKeys, 'an accepted turn writes the VNext checkpoint').toBeGreaterThan(0);
}

export const previewDialog = page => page.getByRole('dialog', { name: '計画プレビュー' });

// The preview dialog (AiPlanningPreviewDialog.tsx) always renders both actions. Before promotion the save button is
// disabled and the promote button reads 'この内容で仮予定にする'; promotion enables save and relabels the promote button
// ('仮予定にしました', disabled). Both states are asserted so a missing transition fails at the step that broke.
export async function promoteThenSave(dialog) {
  const promote = dialog.getByRole('button', { name: 'この内容で仮予定にする' });
  const save = dialog.getByRole('button', { name: 'この内容で保存' });
  await expect(promote).toBeEnabled();
  await expect(save).toBeDisabled();
  await promote.click();
  await expect(promote).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '仮予定にしました' })).toBeDisabled();
  await expect(save).toBeEnabled();
  await save.click();
}
