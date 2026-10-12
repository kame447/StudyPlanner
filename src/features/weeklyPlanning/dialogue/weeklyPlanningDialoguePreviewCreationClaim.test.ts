import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';

const control = 'この内容で仮予定にする';
function input(overrides: Partial<WeeklyPlanningStableV5DialogueRenderInput> = {}): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'preview-synthetic', actionKind: 'preview_ready', questionCode: null,
    currentUserMessage: '1ページ3分くらい', recentConversation: [], planningInformation: { tasks: [{ title: '教材A' }] },
    requiredLabels: ['教材A'], previewCount: 1, previewPromotionControlLabel: control,
    fallbackText: `内容を確認して「${control}」を押してください。`,
    currentTurnGrounding: { mode: 'recommended', acceptedFacts: [{ factId: 'rate-synthetic', kind: 'effort_estimate',
      sourceText: '1ページ3分くらい', data: { kind: 'duration_per_unit', minutes: 3, unit: 'page' } }] },
    ...overrides,
  };
}
function render(text: string, original = input()) {
  return parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify({ actionId: original.actionId,
    actionKind: original.actionKind, questionCode: original.questionCode, groundingAcknowledgement: null,
    text: `${text}「${control}」を押してください。` }), original);
}

// Original ebdb4a57's candidate-versus-persistence controls, adapted to the
// current single dialogue contract. No conversation mode or new authority.
describe('evidenced candidate creation is separate from application mutations', () => {
  it.each([
    '候補1件を作成しました。', '候補を1件作成しました。', '候補を作成しました。',
    '仮予定の候補を作成しました。', '予定候補を作成しました。', '計画の候補1件を作成しました。',
    // The actual draft plus promotion control evidences creation, not storage.
    '候補1件を作成しました。予定を作成しました。',
    '候補として予定を作成しました。',
    '計画案を作成しました。保存はまだ行いません。',
    '予定案を作成しました。',
    '仮予定案を作成しました。',
    '候補1件を作成しましたが、予定を作成しました。',
    '予定として候補1件を作成しました。',
    'プレビューを作成しました。', '計画プレビューを作成しました。',
    '計画のプレビューを作成しました。',
  ])('accepts creation of the actual preview candidate: %s', text => {
    expect(render(`1ページ3分くらいですね。${text}`)).toMatchObject({ status: 'rendered' });
  });
  it.each([
    '候補1件を作成しました。予定を保存しました。',
    '候補1件を作成しました。承認しました。',
    '候補1件を作成しました。予定を登録しました。',
    '候補を保存して作成しました。',
    '候補1件を作成しました、予定を保存しました。',
    '仮予定の候補を保存しました。',
    '教材を作成しました。',
    '計画案を作成しました。予定を保存しました。',
    '計画案を承認しました。',
    '外部カレンダーに計画案を作成しました。',
    '外部カレンダーに候補を作成しました。',
    '外部カレンダーに計画のプレビューを作成しました。',
    '教材のプレビューを作成しました。',
    '計画のプレビューを作成しました。予定を登録しました。',
    '仮予定の候補を作成しました。日付を確定しました。',
  ])('still rejects an unevidenced mutation: %s', text => {
    expect(render(text)).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
  it('distinguishes two scheduled blocks from two unsupported alternative plans', () => {
    const twoBlocks = input({ previewCount: 2 });
    expect(render('候補2件を作成しました。', twoBlocks)).toMatchObject({ status: 'rendered' });
    // Captured case2 wording denotes two alternatives, not two blocks in one plan.
    expect(render('計画のプレビューを2案作成しました。', twoBlocks))
      .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    expect(render('候補3件を作成しました。', twoBlocks))
      .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    expect(render('候補2件を保存しました。', twoBlocks))
      .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
  it('rejects an invented count and an empty preview', () => {
    expect(render('候補2件を作成しました。')).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    expect(render('仮予定の候補を作成しました。', input({ previewCount: 0 })))
      .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
  it.each(['question', 'status'] as const)('does not grant candidate creation for %s', actionKind => {
    expect(render('仮予定の候補を作成しました。', input({ actionKind })))
      .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
  it('does not grant an unsupported date in an otherwise valid candidate sentence', () => {
    expect(render('明日の仮予定の候補を作成しました。'))
      .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
  it('keeps proposal-noun creation gated by actual candidates and the promotion control', () => {
    for (const overrides of [{ previewCount: 0 }, { actionKind: 'question' as const }, { previewPromotionControlLabel: undefined }]) {
      for (const claim of ['計画案を作成しました。', '計画のプレビューを作成しました。']) {
        expect(render(claim, input(overrides)))
          .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
      }
    }
  });
  it('grounds an existing-schedule reference without claiming the new candidate is saved', () => {
    const evidenced = input({ existingScheduleGrounding: {
      graphRevision: 1, sourceId: 'studyplanner-existing-plans', requestFactId: 'request-existing',
      occupiedEventIds: ['saved-event'],
    } });
    const actualClaim = '保存済みの予定と重ならない候補を作成しました。';
    expect(render(actualClaim, evidenced)).toMatchObject({ status: 'rendered' });
    expect(render(actualClaim)).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    expect(render(actualClaim, input({ existingScheduleGrounding: { ...evidenced.existingScheduleGrounding!, occupiedEventIds: [] } })))
      .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    for (const falseSave of [
      'この候補は保存済みの予定です。', '候補は保存済みの予定になりました。',
      '保存済みの予定を作成しました。', '保存済みの予定としました。',
      '保存済みの予定としましたが、候補を作成しました。',
      '保存済みの予定と重ならない候補を作成しました。予定を保存しました。',
    ]) expect(render(falseSave, evidenced)).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });

});
