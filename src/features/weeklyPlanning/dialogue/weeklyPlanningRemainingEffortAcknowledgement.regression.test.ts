import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';
import capture from './fixtures/issue876-remaining-effort-renderer.json';

const REAL_REJECTED_ACK = 'ゼミ発表の資料を完成させる残りの作業は、全部で約45分くらいなんですね。';

type CapturedResponse = {
  text: string;
  groundingAcknowledgement: { factIds: string[]; text: string };
};

function input(): WeeklyPlanningStableV5DialogueRenderInput {
  return structuredClone(capture.input) as unknown as WeeklyPlanningStableV5DialogueRenderInput;
}

function checkAcknowledgement(
  acknowledgement: string,
  changeInput?: (value: WeeklyPlanningStableV5DialogueRenderInput) => void,
) {
  const renderInput = input();
  changeInput?.(renderInput);
  const response = JSON.parse(capture.rawResponse) as CapturedResponse;
  response.groundingAcknowledgement.text = acknowledgement;
  response.text = `${acknowledgement}この内容で仮予定にする場合は、「この内容で仮予定にする」を選んでください。`;
  return parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify(response), renderInput);
}

function checkActiveClaim(text: string, changeInput?: (value: WeeklyPlanningStableV5DialogueRenderInput) => void) {
  const renderInput = input();
  renderInput.actionKind = 'status';
  renderInput.questionCode = null;
  renderInput.requiredLabels = [];
  renderInput.currentTurnGrounding = { mode: 'none', acceptedFacts: [] };
  changeInput?.(renderInput);
  const response = JSON.parse(capture.rawResponse) as CapturedResponse & { actionKind: string };
  response.actionKind = 'status';
  response.groundingAcknowledgement = null as unknown as CapturedResponse['groundingAcknowledgement'];
  response.text = text;
  return parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify(response), renderInput);
}

describe('Issue #876: remaining-work effort acknowledgement', () => {
  it('accepts the verbatim rejected real-model response, with the same typed renderer input', () => {
    expect((JSON.parse(capture.rawResponse) as CapturedResponse).groundingAcknowledgement.text).toBe(REAL_REJECTED_ACK);
    const result = parseWeeklyPlanningStableV5DialogueRendererResponse(capture.rawResponse, input());
    expect(result.status).toBe('rendered');
  });

  it.each([
    [REAL_REJECTED_ACK, true],
    ['ゼミ発表の資料を完成させる残りの作業は、全部で約45分くらいですね。', true],
    ['ゼミ発表の資料を完成させる残りの作業は、全部で約45分くらいなんですね？', true],
    ['ゼミ発表の資料を完成させる残りの作業は、全部で約46分くらいなんですね。', true],
    ['ゼミ発表の資料を完成させる残りの作業は、全部で45分なんですね。', true],
    ['ゼミ発表の資料を完成させる残りの作業は、1回45分くらいなんですね。', true],
    ['別の課題の残りの作業は、全部で約45分くらいなんですね。', true],
    ['ゼミ発表の資料を完成させる残りの作業は、全部で約45分くらいではありませんね。', true],
  ] as const)('does not pretend a textual regex guarantees the truth of a free-form claim: %s', (ack, valid) => {
    expect(checkAcknowledgement(ack).status).toBe(valid ? 'rendered' : 'fallback');
  });

  it.each([
    [REAL_REJECTED_ACK, true],
    ['ゼミ発表の資料を完成させる残りの作業は、全部で約46分くらいなんですね。', true],
    ['ゼミ発表の資料を完成させる残りの作業は、全部で45分なんですね。', true],
    ['ゼミ発表の資料を完成させる残りの作業は、1回45分くらいなんですね。', true],
  ] as const)('does not treat a free-form status sentence as authoritative: %s', (text, valid) => {
    expect(checkActiveClaim(text).status).toBe(valid ? 'rendered' : 'fallback');
  });

  it('does not treat a free-form effort claim for another known task as planning authority', () => {
    expect(checkActiveClaim('数学の残りの作業は、全部で約45分くらいなんですね。', value => {
      (value.planningInformation!.tasks as Array<Record<string, unknown>>).push({ id: 'other-task', title: '数学' });
    }).status).toBe('rendered');
  });

  it('does not treat wording as authority when the typed target changed', () => {
    expect(checkAcknowledgement(REAL_REJECTED_ACK, value => {
      const effort = value.currentTurnGrounding!.acceptedFacts.find(fact => fact.kind === 'effort_estimate')!;
      effort.data.targetFactId = 'wpf_workload_lku6y0vjfjpo';
      (value.planningInformation!.effortEstimates as Array<Record<string, unknown>>)[0].targetFactId = 'wpf_workload_lku6y0vjfjpo';
    }).status).toBe('rendered');
  });

  it('does not use an obsolete accepted amount to mutate the active graph', () => {
    expect(checkAcknowledgement(REAL_REJECTED_ACK, value => {
      (value.planningInformation!.effortEstimates as Array<Record<string, unknown>>)[0].minutes = 90;
    }).status).toBe('rendered');
  });
});
