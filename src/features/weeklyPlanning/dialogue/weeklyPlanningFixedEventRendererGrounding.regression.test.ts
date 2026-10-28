import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { evaluateWeeklyPlanningLegacyDialogueTextGuard as parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';

const events = [
  ['バンドAの合わせ', '09:00', '10:30', 90],
  ['バンドBの合わせ', '16:00', '17:30', 90],
  ['全体ゼミ', '13:00', '15:00', 120],
  ['領域ゼミ', '15:00', '16:00', 60],
  ['カンファレンス', '17:00', '21:00', 240],
] as const;
// Exact anonymous provider replies from the 2026-10-27 live reproduction.
const recordedReplies = [
  '明日の予定として、バンドAの合わせは9〜10:30、全体ゼミは13〜15時、領域ゼミは15〜16時、バンドBの合わせは16〜17:30、カンファレンスは17〜21時ごろですね。\n5件の予定候補をプレビューにしました。2026年10月27日17:00〜17:30は、バンドBの合わせとカンファレンスが重なっています。まだ保存されていません。登録するには「この内容で仮予定にする」を選んでください。',
  '明日の予定は、バンドAの合わせが9〜10時30分、全体ゼミが13〜15時、領域ゼミが15〜16時、バンドBの合わせが16〜17時30分、カンファレンスが17〜21時になりそう、という内容ですね。\n候補を確認すると、2026年10月27日17〜17時30分に「バンドBの合わせ」と「カンファレンス」が重なっています。予定はまだ保存されていません。問題なければ「この内容で仮予定にする」を選んでください。',
];

function input(): WeeklyPlanningStableV5DialogueRenderInput {
  const temporalConstraints = events.map(([, startTime, endTime], index) => ({
    id: `time-${index}`, kind: 'fixed_interval', startTime, endTime, dateExpression: 'tomorrow',
  }));
  return {
    actionId: 'fixed-event-preview', actionKind: 'preview_ready', questionCode: null,
    currentUserMessage: '明日の予定に入れてほしいです。', recentConversation: [],
    planningInformation: { temporalConstraints },
    currentTurnGrounding: { mode: 'recommended', acceptedFacts: temporalConstraints.map(time => ({
      factId: time.id, kind: 'temporal_constraint', sourceText: `${time.startTime}〜${time.endTime}`,
      data: time,
    })) },
    communication: { goal: 'present_preview', askQuestion: false, statusReason: 'fixed_event_registration_preview',
      eventRegistration: { eventCreatedByTurn: false,
        candidates: events.map(([title, startTime, endTime, durationMinutes], index) => ({
          stableKey: `candidate-${index}`, workItemKey: `event-${index}`, date: '2026-10-27',
          title, startTime, endTime, durationMinutes, source: 'fixed_event_registration', approvalStatus: 'unapproved',
        })),
        overlaps: [{ date: '2026-10-27', startTime: '17:00', endTime: '17:30', titles: ['バンドBの合わせ', 'カンファレンス'] }],
      } },
    previewCount: 5, previewPromotionControlLabel: 'この内容で仮予定にする',
    requiredLabels: ['この内容で仮予定にする'], fallbackText: '返信を作れませんでした。',
  };
}

function parse(renderInput: WeeklyPlanningStableV5DialogueRenderInput, text: string, acknowledgement = text.split('\n')[0]) {
  return parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify({
    actionId: renderInput.actionId, actionKind: renderInput.actionKind, questionCode: renderInput.questionCode,
    groundingAcknowledgement: { factIds: renderInput.currentTurnGrounding!.acceptedFacts.map(fact => fact.factId), text: acknowledgement },
    text,
  }), renderInput);
}

function clockInput(startTime: string, endTime: string): WeeklyPlanningStableV5DialogueRenderInput {
  const renderInput = input();
  const time = { startTime, endTime };
  renderInput.actionKind = 'status'; renderInput.previewCount = 0;
  renderInput.planningInformation = { temporalConstraints: [time] };
  renderInput.currentTurnGrounding = { mode: 'required_before_resume', acceptedFacts: [{
    factId: 'time', kind: 'temporal_constraint', sourceText: `${startTime}〜${endTime}`, data: time,
  }] };
  return renderInput;
}

describe('Fixed-event renderer display grounding regression', () => {
  it.each(recordedReplies)('renders the exact recorded reply without rewriting its acknowledgement or date: %s', text => {
    const renderInput = input();
    const before = structuredClone(renderInput);
    expect(parse(renderInput, text)).toMatchObject({ status: 'rendered', text });
    expect(renderInput).toEqual(before);
  });

  it.each(['〜', '~', '～', '-', '－', '–'])('acknowledges the whole-hour start only in a clock range separated by %s', separator => {
    expect(parse(clockInput('09:00', '10:30'), `予定は9${separator}10:30ですね。`)).toMatchObject({ status: 'rendered' });
  });

  it.each([
    ['13:00', '15:00', '13〜15時'], ['17:00', '21:00', '17〜21時ごろ'],
    ['16:00', '17:30', '16〜17時30分'], ['00:00', '01:00', '0〜1時'],
  ])('retains both typed clock values %s–%s in %s', (start, end, range) => {
    expect(parse(clockInput(start, end), `予定は${range}ですね。`)).toMatchObject({ status: 'rendered' });
  });

  it.each(['9、10:30', '9件〜10:30', '9.5〜10:30', '109〜10:30', '-9〜10:30', '9〜10'])(
    'does not acknowledge a bare number or malformed range start as a clock: %s', display => {
      expect(parse(clockInput('09:00', '10:30'), `予定は${display}ですね。`))
        .toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });
    },
  );

  it('does not use a duration range to acknowledge clock bounds', () => {
    expect(parse(clockInput('02:00', '03:00'), '予定は2〜3時間ですね。'))
      .toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });
  });

  it.each(['candidates', 'overlaps'] as const)('grounds only registration %s dates, without requiring an absolute planning fact', source => {
    const renderInput = input();
    const registration = renderInput.communication!.eventRegistration!;
    if (source === 'candidates') registration.overlaps = [];
    else registration.candidates = [];
    renderInput.currentTurnGrounding = { mode: 'none', acceptedFacts: [] };
    expect(parse(renderInput, recordedReplies[0])).toMatchObject({ status: 'rendered' });
  });

  it.each(recordedReplies)('keeps invented dates and clock claims rejected for the recorded reply: %s', text => {
    for (const unsupported of ['10月28日の予定もあります。', '18:00からです。']) {
      expect(parse(input(), `${text}\n${unsupported}`)).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    }
  });

  it('does not ground an absolute date from unrelated communication fields', () => {
    const renderInput = input();
    delete renderInput.communication!.eventRegistration;
    Object.assign(renderInput.communication!, { other: { date: '2026-10-27' } });
    // Use full clock spellings to isolate the missing date authority.
    const text = '2026年10月27日17:00〜17:30の候補です。この内容で仮予定にする';
    renderInput.currentTurnGrounding = { mode: 'none', acceptedFacts: [] };
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify({
      actionId: renderInput.actionId, actionKind: renderInput.actionKind, questionCode: null, text,
    }), renderInput)).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
});
