import { expect } from '@playwright/test';
import { requestContextOf, scriptedReading } from './vnext-scripted-readings.mjs';

// The Worker's provider on the isolated emulator target is the synthetic provider (emulator/syntheticProvider.mjs): it
// answers only what a test scripts, so a reply can echo ids from the request the Worker actually sent.
export const SYNTHETIC = 'http://127.0.0.1:18790';
export const VNEXT_READING_SCHEMA = 'weekly_planning_vnext_native_v1';
export const RENDERER_SCHEMA = 'weekly_planning_stable_v5_dialogue_response';
export const PURPOSE_SCHEMA = 'weekly_planning_vnext_turn_purpose_v1';
export const ADVICE_SCHEMA = 'weekly_planning_vnext_advice_v1';

/** The next model call the Worker forwarded, with the structured-output schema it asked for. */
export async function nextCall(request) {
  const response = await request.get(`${SYNTHETIC}/__synthetic/next?route=chat`, { timeout: 30_000 });
  const held = await response.json();
  return { ...held, schema: held.body?.response_format?.json_schema?.name ?? null };
}

export async function answer(request, call, content, status = 200) {
  const body = status === 200
    ? { id: `synthetic-${call.id}`, object: 'chat.completion', model: call.body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
    : { error: { message: 'synthetic provider failure' } };
  await request.post(`${SYNTHETIC}/__synthetic/respond`, { data: { id: call.id, status, body } });
}

/**
 * A renderer reply for the application's decision as the actual request states it: the same action,
 * kind and question, naming every label the request requires (the renderer's own validator checks this).
 */
export function rendererReply(call) {
  const prompt = call.body.messages.map((message) => {
    try { return JSON.parse(message.content); } catch { return null; }
  }).find((content) => content?.applicationDecision);
  expect(prompt, 'renderer request carries the application decision').toBeTruthy();
  const decision = prompt.applicationDecision;
  const labels = [...(decision.relevantLabels ?? []), decision.previewPromotionControlLabel].filter(Boolean);
  return { actionId: prompt.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode ?? null,
    groundingAcknowledgement: null, text: `${labels.join('、')}について確認しました。` };
}

/**
 * The `beforeTurn` hook of the emulator spec: answers this turn's reading, then its renderer call, from what the Worker
 * actually sent. Every scripted kind makes exactly one reading and one renderer call, except a consultation (#246):
 * its reading finds nothing to plan, so the Worker asks the turn purpose and then the advice, and no renderer call follows.
 */
export async function answerScriptedTurn(request, turn) {
  const read = await nextCall(request);
  expect(read.schema).toBe(VNEXT_READING_SCHEMA);
  await answer(request, read, scriptedReading(turn.kind, turn, requestContextOf(read.body.messages)));
  if (turn.kind === 'consultation') {
    const purpose = await nextCall(request);
    expect(purpose.schema).toBe(PURPOSE_SCHEMA);
    await answer(request, purpose, { schemaVersion: 'learning-consultation-turn-purpose.v1', kind: 'learning_consultation' });
    const advice = await nextCall(request);
    expect(advice.schema).toBe(ADVICE_SCHEMA);
    await answer(request, advice, { schemaVersion: 'learning-consultation-answer.v1', kind: 'proposal',
      userFacingAnswer: 'まず文法の基礎問題集を1周しましょう。', assumptions: ['高校レベル'], overallUncertainty: 'medium',
      options: [{ title: '基礎固め', strategySummary: '文法から', tradeoffs: [], recommendations: [{ recommendationKind: 'study_method',
        rationale: '土台が先です。', assumptionRefs: [], evidenceRefs: [], uncertainty: 'medium' }] }] });
    return;
  }
  const render = await nextCall(request);
  expect(render.schema).toBe(RENDERER_SCHEMA);
  await answer(request, render, rendererReply(render));
}
