import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import {
  parseWeeklyPlanningStableV5DialogueRendererResponse,
} from './weeklyPlanningStableV5DialogueValidation';

function input(
  overrides: Partial<WeeklyPlanningStableV5DialogueRenderInput> = {},
): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:quantity_role_unresolved',
    currentUserMessage: 'どういうこと？',
    recentConversation: [],
    planningInformation: {
      tasks: [{ title: '院試', category: 'study' }],
    },
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    requiredLabels: ['院試'],
    fallbackText: '今回進めたい量ですか？',
    previewCount: 0,
    ...overrides,
  };
}

function response(
  renderInput: WeeklyPlanningStableV5DialogueRenderInput,
  text: string,
  overrides: Partial<{
    actionId: string;
    actionKind: string;
    questionCode: string | null;
    groundingAcknowledgement: null | {
      factIds: string[];
      text: string;
    };
  }> = {},
): string {
  return JSON.stringify({
    actionId: overrides.actionId ?? renderInput.actionId,
    actionKind: overrides.actionKind ?? renderInput.actionKind,
    questionCode: overrides.questionCode === undefined
      ? renderInput.questionCode
      : overrides.questionCode,
    ...(overrides.groundingAcknowledgement === undefined
      ? {}
      : { groundingAcknowledgement: overrides.groundingAcknowledgement }),
    text,
  });
}

describe('Stable V5 dialogue renderer validation', () => {
  // Literal titles/target references from the live-23 renderer request, without
  // unrelated material/private provenance. No semantic-provider interpretation.
  function live23Input(precision: 'exact' | 'approximate' | null = null) {
    const math = 'wpf_task_198s5jy1qp1dpm', english = 'wpf_task_1w10sw018cjxms';
    const mathWork = 'wpf_workload_15mzxq21n0vopi', englishWork = 'wpf_workload_pgy14kwqgnbc';
    return input({ actionKind: 'question', questionCode: 'missing_effort_estimate', requiredLabels: ['数学の問題演習'],
      currentUserMessage: '15分。あと英語の締切を金曜にして',
      planningInformation: {
        revision: 1, planningWindows: [{ id: 'wpf_window_1d16a4x1h8vjvp', kind: 'absolute',
          value: '2026-08-20/2026-08-26', start: '2026-08-20', end: '2026-08-26' }],
        tasks: [{ id: math, title: '数学の問題演習', category: 'study' }, { id: english, title: '英語のページ学習', category: 'study' }],
        components: [], workloads: [
          { id: mathWork, taskId: math, componentId: null, quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問' },
          { id: englishWork, taskId: english, componentId: null, quantityRole: 'target', amount: 15, unitCode: 'page', unitLabel: 'ページ' },
        ], effortEstimates: [
          { id: 'wpf_effort_1eby39m1mbrtxq', taskId: english, targetFactId: englishWork,
            kind: 'total_duration', minutes: 45, unitCode: 'page', precision: 'exact' },
          ...(precision ? [{ id: 'math-effort', taskId: math, targetFactId: mathWork,
            kind: 'duration_per_unit', minutes: 15, unitCode: 'problem', precision }] : []),
        ], temporalConstraints: [], taskDateRules: [],
      }, currentTurnGrounding: { mode: 'none', acceptedFacts: [] } });
  }
  const live23Text = '数学は1問15分くらいですね。英語の締切は金曜にしたいとのこと、受け取りました。数学の見積もりは1問15分として考えてよさそうですか？';
  it.each([null, 'exact', 'approximate'] as const)('binds the exact live-23 shortened subject before comparing precision=%s', precision => {
    const renderInput = live23Input(precision);
    const before = structuredClone(renderInput);
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, live23Text,
      { groundingAcknowledgement: null }), renderInput).status).toBe(precision === 'approximate' ? 'rendered' : 'fallback');
    expect(renderInput).toEqual(before);
  });
  it('keeps the exact live-21 clarification valid with the live-23 canonical titles and no math estimate', () => {
    const renderInput = live23Input();
    const text = '今回は「15分」という内容も、英語の締切を金曜にする内容も計画に反映されていません。数学は1問あたり15分、という理解でよいですか？';
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput).status).toBe('rendered');
  });
  it('accepts the shortened exact claim only with its matching exact active effort', () => {
    const renderInput = live23Input('exact');
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput,
      live23Text.replace('くらい', '')), renderInput).status).toBe('rendered');
  });
  it.each([
    ['数学は1問15分ですね。', false],
    ['数学の問題演習は1問15分ですね。', false],
    ['英語15ページ（全部で45分）をもとに確認してください。', true],
    ['英語15ページ（全部で15分）をもとに確認してください。', false],
    ['数は1問15分ですね。', true], // Not a literal prefix at a の boundary.
  ] as const)('checks only full or uniquely shortened task subjects: %s', (text, valid) => {
    const renderInput = live23Input();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([
    ['数学', false, true],
    ['数学の問題演習', false, false],
    ['数学の小テスト', false, false],
    ['数学', true, false],
    ['数学の問題演習', true, true],
    ['数学の小テスト', true, false],
  ] as const)('abstains on ambiguous shortened subjects without hiding full titles: %s required=%s', (title, required, valid) => {
    const renderInput = live23Input(required ? 'exact' : null);
    (renderInput.planningInformation!.tasks as unknown[]).push({ id: 'other-math', title: '数学の小テスト' });
    if (required) renderInput.currentTurnGrounding = { mode: 'required_before_resume', acceptedFacts: [{
      factId: 'math-effort', kind: 'effort_estimate', sourceText: '15分', data: { taskId: 'wpf_task_198s5jy1qp1dpm',
        targetFactId: 'wpf_workload_15mzxq21n0vopi', targetLabels: ['数学の問題演習'], kind: 'duration_per_unit',
        minutes: 15, unitCode: 'problem', unitLabel: '問', precision: 'exact' },
    }] };
    // An ambiguous body abstains; a mandatory ACK must bind its actual fact.
    const text = `${title}は1問15分ですね。`;
    const result = parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      required ? { groundingAcknowledgement: { factIds: ['math-effort'], text } } : {}), renderInput);
    expect(result.status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each(['数学の問題演習', '数学の小テスト'])('does not use a duplicate/shared task title to license a shortened ACK: %s', otherTitle => {
    const renderInput = naturalEffortInput('math', 'duration_per_unit', 15);
    const tasks = renderInput.planningInformation!.tasks as Record<string, unknown>[];
    tasks[0].title = '数学の問題演習'; tasks.push({ id: 'other-math', title: otherTitle });
    renderInput.currentTurnGrounding!.acceptedFacts.find(fact => fact.kind === 'effort_estimate')!.data.targetLabels = ['数学の問題演習'];
    const text = '数学は1問15分ですね。';
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['effort'], text } }), renderInput).status).toBe('fallback');
    renderInput.currentTurnGrounding = { mode: 'none', acceptedFacts: [] };
    renderInput.planningInformation!.effortEstimates = [];
    // Keep the duration allowlist independent of the ambiguous subject check.
    renderInput.currentUserMessage = '15分';
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput).status).toBe('rendered');
  });
  it.each([
    ['数学の第1章は1問15分ですね。', true],
    ['数学は1問15分ですね。', false],
    ['数学の第2章は1問15分ですね。', false],
  ] as const)('keeps component binding after shortening the task title: %s', (text, valid) => {
    const renderInput = naturalEffortInput('math', 'duration_per_unit', 15);
    (renderInput.planningInformation!.tasks as Record<string, unknown>[])[0].title = '数学の問題演習';
    renderInput.currentTurnGrounding!.acceptedFacts.find(fact => fact.kind === 'effort_estimate')!.data.targetLabels = ['数学の問題演習', '第1章'];
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['effort'], text } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([
    ['数学の問題演習', '数学', true],
    ['数学の問題演習', '数', false],
    ['数学問題演習', '数学', false],
    ['数学の問題演習の復習', '数学の問題演習', true],
    ['数学の問題演習', '数学の問題演習', true],
  ] as const)('uses the same literal-boundary subject in mandatory ACKs: %s → %s', (title, subject, valid) => {
    const renderInput = naturalEffortInput('math', 'duration_per_unit', 15);
    (renderInput.planningInformation!.tasks as Record<string, unknown>[])[0].title = title;
    renderInput.currentTurnGrounding!.acceptedFacts.find(fact => fact.kind === 'effort_estimate')!.data.targetLabels = [title];
    const text = `${subject}は1問15分ですね。`;
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['effort'], text } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([
    ['今回は「15分」という内容も、英語の締切を金曜にする内容も計画に反映されていません。数学は1問あたり15分、という理解でよいですか？', true],
    ['数学は1問あたり15分ですね。', false],
    ['数学は1問あたり15分ですか？', true],
    ['数学は1問あたり15分でよいですか？', true],
    ['数学は1問あたり15分でしょうか?', true],
    ['数学は1問あたり15分、計画に反映されていません。', true],
    ['数学は1問あたり15分、反映していません。', true],
    ['数学20問（全部で15分）は計画に反映していません。', true],
    ['数学は1問あたり15分ですね、どうしますか？', false],
    ['数学20問（全部で15分）でよいですか？', false],
  ] as const)('distinguishes clarification/nonreflection from positive claims without an active math estimate: %s', (text, valid) => {
    const renderInput = input({ actionKind: 'question', questionCode: 'missing_effort_estimate', requiredLabels: [],
      currentUserMessage: '15分。あと英語の締切を金曜にして',
      planningInformation: { tasks: [{ id: 'math', title: '数学' }, { id: 'english', title: '英語' }],
        workloads: [{ id: 'math-work', taskId: 'math', amount: 20, unitLabel: '問' }], effortEstimates: [] },
      currentTurnGrounding: { mode: 'none', acceptedFacts: [] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each(['数学は1問あたり15分、という理解でよいですか？', '数学は1問あたり15分ですか？',
    '数学は1問あたり15分でしょうか?', '数学は1問あたり15分、反映していません。'])('keeps the mandatory ACK strict for nonassertions: %s', text => {
    const renderInput = naturalEffortInput('math', 'duration_per_unit', 15);
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['effort'], text } }), renderInput).status).toBe('fallback');
  });
  it.each([
    '数学は1問あたり15分ですね。8月20日から26日の数学20問と英語15ページ（全部で45分）をもとに、仮予定の候補を6件用意しました。「この内容で仮予定にする」を選ぶと、仮予定として進められます。',
    '数学は1問あたり15分ですね。8月20日から26日に数学20問、英語15ページ（全部で45分）の仮予定候補を6件用意しました。内容を確認して「この内容で仮予定にする」を選べます。',
  ].flatMap(text => [45, 60].map(minutes => [text.replace('全部で45分', `全部で${minutes}分`), minutes === 45] as const)))('checks the live-14 mandatory ACK and contextual preview body: %s', (text, valid) => {
    const renderInput = naturalEffortInput('math', 'duration_per_unit', 15);
    Object.assign(renderInput, { actionKind: 'preview_ready', questionCode: null, previewCount: 6, requiredLabels: [],
      currentUserMessage: '15。数学は全部で60分。', recentConversation: [{ role: 'user', content: '英語60分' }], fallbackText: '仮予定の候補を6件用意しました。' });
    const projection = renderInput.planningInformation!;
    projection.effortEstimates = [{ ...renderInput.currentTurnGrounding!.acceptedFacts.find(fact => fact.kind === 'effort_estimate')!.data },
      { id: 'english-effort', taskId: 'english', targetFactId: 'english-work', kind: 'total_duration', minutes: 45, unitCode: 'minute', precision: 'exact' }];
    (projection.effortEstimates as Record<string, unknown>[])[0].id = 'effort';
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['effort'], text: '数学は1問あたり15分ですね。' } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([
    ['数学は全部で60分です。', false],
    ['数学20問（全部で60分）を確認してください。', false],
    ['数学は全部で60分ならどうしますか？', true],
    ['数学は全部で60分ではなく、1問15分ですね。', false],
  ] as const)('only rejects positively parsed contradictory body claims: %s', (text, valid) => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [], currentUserMessage: '数学20問、全部で60分、1問15分',
      planningInformation: { tasks: [{ id: 'math', title: '数学' }], workloads: [{ id: 'work', taskId: 'math', amount: 20, unitLabel: '問' }], effortEstimates: [] },
      currentTurnGrounding: { mode: 'none', acceptedFacts: [] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([
    ['英語15ページ（全部で45分）をもとに確認してください。', true],
    ['英語15ページ（全部で60分）をもとに確認してください。', false],
    ['英語20ページ（全部で45分）をもとに確認してください。', false],
    ['英語15問（全部で45分）をもとに確認してください。', false],
    ['英語は1ページ45分です。', false],
    ['数学は1ページ15分です。', false],
    ['英語は全部で45分くらいです。', false],
    ['英語は全部で45分です。', true],
    ['数学の案には60分という選択肢もあります。', true],
    ['英語15ページ（全部で45分）、英語15ページ（全部で60分）です。', false],
  ] as const)('compares recognized contextual tuples independently of expected values: %s', (text, valid) => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [], currentUserMessage: '数学20問、英語15ページ、20ページ、15問、45分、60分、15分',
      planningInformation: { tasks: [{ id: 'math', title: '数学' }, { id: 'english', title: '英語' }], workloads: [
        { id: 'math-work', taskId: 'math', amount: 20, unitLabel: '問' }, { id: 'english-work', taskId: 'english', amount: 15, unitLabel: 'ページ' },
      ], effortEstimates: [
        { id: 'math-effort', taskId: 'math', targetFactId: 'math-work', kind: 'duration_per_unit', minutes: 15, precision: 'exact' },
        { id: 'english-effort', taskId: 'english', targetFactId: 'english-work', kind: 'total_duration', minutes: 45, precision: 'exact' },
      ] }, currentTurnGrounding: { mode: 'none', acceptedFacts: [] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([false, true])('grounds the live correction recap in active facts, corrected=%s', corrected => {
    const graph = { tasks: [{ id: 'math', title: '数学' }], workloads: [{ id: 'math-work', taskId: 'math', amount: 20, unitCode: 'problem', unitLabel: '問' }],
      effortEstimates: [{ id: 'active-effort', taskId: 'math', targetFactId: 'math-work', kind: corrected ? 'total_duration' : 'duration_per_unit',
        minutes: corrected ? 60 : 15, unitCode: corrected ? null : 'problem', precision: 'exact' }] };
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [], planningInformation: graph,
      currentUserMessage: 'いや、数学は全部で60分です。', recentConversation: [{ role: 'assistant', content: '数学は1問あたり15分ですね。' }],
      currentTurnGrounding: { mode: 'none', acceptedFacts: [] } });
    const text = '失礼しました。数学は1問あたり15分ではなく、全部で60分ですね。';
    const before = structuredClone(graph);
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['active-effort'], text } }), renderInput).status).toBe(corrected ? 'rendered' : 'fallback');
    expect(graph).toEqual(before);
  });
  it.each([
    ['数学は1問あたり15分ですね。', 'duration_per_unit', 15, 'exact', true],
    ['数学は全部で60分ですね。', 'duration_per_unit', 15, 'exact', false],
    ['数学は1問あたり15分ではなく、全部で60分ですね。', 'total_duration', 60, 'exact', true],
    ['数学は1問あたり15分くらいではなく、全部で60分ですね。', 'total_duration', 60, 'exact', true],
    // Outside the mandatory ACK, an unrecognized measurement replacement abstains.
    // The unchanged mandatory-ACK probes below still reject these exact shapes.
    ['数学は1問ではなく1ページ5分です。', 'duration_per_unit', 5, 'exact', true],
    ['数学は1問あたりではなく5分です。', 'duration_per_unit', 5, 'exact', true],
    ['数学は1問あたり50分ですね。', 'duration_per_unit', 15, 'exact', false],
    ['数学は1問5分ですね。', 'duration_per_unit', 15, 'exact', false],
    ['数学は1 問5分ですね。', 'duration_per_unit', 15, 'exact', false],
    ['数学は全部で60分くらいですね。', 'total_duration', 60, 'exact', false],
    ['数学は全部で60分ですね。', 'total_duration', 60, 'approximate', false],
    ['数学は全部で60分くらいですね。', 'total_duration', 60, 'approximate', true],
    ['数学は全部で60分ですね、どうしますか？', 'duration_per_unit', 15, 'exact', false],
  ] as const)('validates every active-fact display assertion without current effort: %s', (text, kind, minutes, precision, valid) => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [], currentUserMessage: '数学は全部で60分。1問5分。15分。50分。',
      planningInformation: { tasks: [{ id: 'math', title: '数学' }], workloads: [{ id: 'work', taskId: 'math', amount: 20, unitLabel: '問' }],
        effortEstimates: [{ id: 'active', taskId: 'math', targetFactId: 'work', kind, minutes, precision }] },
      currentTurnGrounding: { mode: 'none', acceptedFacts: [] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it('does not borrow another task, historical values or stale accepted metadata for active claims', () => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [], currentUserMessage: '数学60分、英語45分',
      planningInformation: { tasks: [{ id: 'math', title: '数学' }, { id: 'english', title: '英語' }], workloads: [],
        effortEstimates: [{ id: 'math-effort', taskId: 'math', targetFactId: 'math', kind: 'total_duration', minutes: 60, precision: 'exact' },
          { id: 'english-effort', taskId: 'english', targetFactId: 'english', kind: 'total_duration', minutes: 45, precision: 'exact' }] },
      recentConversation: [{ role: 'user', content: '英語60分、数学45分' }], currentTurnGrounding: { mode: 'none', acceptedFacts: [] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, '数学は全部で45分、英語は全部で60分です。'), renderInput).status).toBe('fallback');
    renderInput.currentTurnGrounding!.acceptedFacts.push({ factId: 'stale', kind: 'effort_estimate', sourceText: '英語60分',
      data: { targetLabels: ['英語'], kind: 'total_duration', minutes: 60, precision: 'exact' } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, '英語は全部で60分ですね。'), renderInput).status).toBe('fallback');
  });
  it('checks a truthful correction recap in the mandatory ACK as well as the visible body', () => {
    const renderInput = naturalEffortInput('math', 'total_duration', 60);
    const text = '数学は1問あたり15分ではなく、全部で60分ですね。';
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['effort'], text } }), renderInput).status).toBe('rendered');
  });
  it.each([
    ['数学の問題集の第1章は全部で60分です。', false, true],
    ['第1章は全部で60分です。', false, true],
    ['第1章は全部で999分です。', false, false],
    ['問題集は全部で60分です。', false, false],
    ['第1章は全部で60分です。', true, true], // Duplicate labels cannot positively bind a body claim.
  ] as const)('binds component status to the exact active scope: %s duplicate=%s', (text, duplicate, valid) => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [], currentUserMessage: '60分、999分',
      planningInformation: { tasks: [{ id: 'math', title: '数学' }], components: [
        { id: 'book', taskId: 'math', parentComponentId: null, label: '問題集' },
        { id: 'chapter', taskId: 'math', parentComponentId: 'book', label: '第1章' },
        ...(duplicate ? [{ id: 'other-chapter', taskId: 'math', parentComponentId: 'book', label: '第1章' }] : []),
      ], workloads: [{ id: 'work', taskId: 'math', componentId: 'chapter', amount: 20, unitLabel: '問' }],
      effortEstimates: [{ id: 'effort', taskId: 'math', targetFactId: 'work', kind: 'total_duration', minutes: 60, precision: 'exact' }] },
      currentTurnGrounding: { mode: 'none', acceptedFacts: [] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each(['work', 'chapter'])('keeps contextual workload evidence within its exact %s scope', targetFactId => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [], currentUserMessage: '数学20問は60分か999分',
      planningInformation: { tasks: [{ id: 'math', title: '数学' }], components: [{ id: 'chapter', taskId: 'math', parentComponentId: null, label: '第1章' }],
        workloads: [{ id: 'work', taskId: 'math', componentId: 'chapter', amount: 20, unitLabel: '問' }],
        effortEstimates: [{ id: 'effort', taskId: 'math', targetFactId, kind: 'total_duration', minutes: 60, precision: 'exact' }] },
      currentTurnGrounding: { mode: 'none', acceptedFacts: [] } });
    for (const minutes of [60, 999]) expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput,
      `数学の第1章20問（全部で${minutes}分）をもとに確認してください。`), renderInput).status).toBe(minutes === 60 ? 'rendered' : 'fallback');
  });
  function naturalEffortInput(task = 'english', kind = 'total_duration', minutes = 45) {
    const workloads = [
      { id: 'math-work', taskId: 'math', amount: 20, unitCode: 'problem', unitLabel: '問' },
      { id: 'english-work', taskId: 'english', amount: 15, unitCode: 'page', unitLabel: 'ページ' },
    ];
    const target = workloads.find(workload => workload.taskId === task)!;
    const window = { id: 'window', kind: 'absolute', value: '2026-08-20/2026-08-26', start: '2026-08-20', end: '2026-08-26' };
    return input({ actionKind: 'question', questionCode: 'missing_effort_estimate', requiredLabels: [],
      planningInformation: { planningWindows: [window], tasks: [{ id: 'math', title: '数学' }, { id: 'english', title: '英語' }], workloads },
      currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
        { factId: window.id, kind: 'planning_window', sourceText: '8月20日から26日', data: window },
        ...workloads.map(workload => ({ factId: workload.id, kind: 'workload' as const,
          sourceText: `${workload.amount}${workload.unitLabel}`, data: workload })),
        { factId: 'effort', kind: 'effort_estimate', sourceText: `${minutes}分`, data: {
          taskId: task, targetFactId: target.id, targetLabels: [task === 'math' ? '数学' : '英語'],
          kind, minutes, precision: 'exact', unitCode: kind === 'total_duration' ? null : target.unitCode, unitLabel: target.unitLabel,
        } },
      ] } });
  }
  it.each([
    '8月20日から26日に数学20問と英語15ページを進めたいんですね。英語15ページは全部で45分ですね。',
    '英語15ページは全部で45分ですね。',
    '英語の15ページを、合計で45分とします。',
    '英語は15ページで、全体で45分です。',
    '英語１５ページは全部で４５分ですね！',
    '8/20〜8/26に数学20問と英語15ページを進めたいんですね。英語15ページは全部で45分ね。',
  ])('accepts real Luna-style truthful ACK with the exact target workload: %s', ack => {
    const renderInput = naturalEffortInput();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack + '数学20問は1問あたり何分かかりますか？',
      { groundingAcknowledgement: { factIds: ['window', 'math-work', 'english-work', 'effort'], text: ack } }), renderInput).status).toBe('rendered');
  });
  it.each([
    '8月20日から26日に、数学20問と英語15ページを進める予定で、英語15ページは全部で45分ですね。',
    '8月20日から26日に数学20問と英語15ページを進めたいんですね。英語15ページは全部で45分ですね。',
    '英語の15ページを、合計で45分とします。',
  ])('accepts truthful task-total ACK with minute unitCode and its own workload context: %s', ack => {
    const renderInput = naturalEffortInput();
    const fact = renderInput.currentTurnGrounding!.acceptedFacts.find(fact => fact.kind === 'effort_estimate')!;
    Object.assign(fact.data, { targetFactId: 'english', unitCode: 'minute', unitLabel: null });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack + '数学20問は1問あたり何分かかりますか？',
      { groundingAcknowledgement: { factIds: ['window', 'math-work', 'english-work', 'effort'], text: ack } }), renderInput).status).toBe('rendered');
  });
  it.each([
    ['英語15ページは全部で45分ですね。', '15問', true],
    ['英語20問は全部で45分ですね。', '20問', true],
    ['英語20ページは全部で45分ですね。', '20問', false],
    ['英語99ページは全部で45分ですね。', 'foreign', false],
    ['英語15ページは全部で45分ですね。', 'duplicate', false],
    ['英語15ページは全部で45分ですね。', 'unit-prefix', true],
  ] as const)('binds task-total display to exactly one matching same-task workload: %s (%s)', (ack, shape, valid) => {
    const renderInput = naturalEffortInput();
    const fact = renderInput.currentTurnGrounding!.acceptedFacts.find(fact => fact.kind === 'effort_estimate')!;
    Object.assign(fact.data, { targetFactId: 'english', unitCode: 'minute', unitLabel: null });
    const workloads = renderInput.planningInformation!.workloads as Array<Record<string, unknown>>;
    workloads.push({ id: 'additional', taskId: shape === 'foreign' ? 'math' : 'english',
      amount: shape === '20問' ? 20 : shape === 'foreign' ? 99 : 15,
      unitLabel: shape === '15問' || shape === '20問' ? '問' : shape === 'unit-prefix' ? 'ペ' : 'ページ' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack,
      { groundingAcknowledgement: { factIds: ['effort'], text: ack } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each(['duration_per_unit', 'session_duration'])('never borrows task workload context for %s effort', kind => {
    const renderInput = naturalEffortInput('english', kind, 45);
    const fact = renderInput.currentTurnGrounding!.acceptedFacts.find(fact => fact.kind === 'effort_estimate')!;
    Object.assign(fact.data, { targetFactId: 'english', unitCode: 'page', unitLabel: 'ページ' });
    const ack = `英語15ページは1${kind === 'duration_per_unit' ? 'ページ' : '回'}45分ですね。`;
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack,
      { groundingAcknowledgement: { factIds: ['effort'], text: ack } }), renderInput).status).toBe('fallback');
  });
  it.each([null, '分'])('treats minute unitCode as total duration with unitLabel %s', unitLabel => {
    const renderInput = naturalEffortInput();
    const fact = renderInput.currentTurnGrounding!.acceptedFacts.find(fact => fact.kind === 'effort_estimate')!;
    Object.assign(fact.data, { targetFactId: 'english', unitCode: 'minute', unitLabel });
    for (const [ack, valid] of [['英語15ページは全部で45分ですね。', true],
      ['英語15ページは1ページ45分ですね。', false]] as const) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack,
        { groundingAcknowledgement: { factIds: ['effort'], text: ack } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
    }
  });
  it.each([
    ['数学20問は1問5分ですね！', true],
    ['数学の20問を1問5分で見積もりますね。', true],
    ['数学は20問で、1問あたり5分です。', true],
    ['数学20問は問あたり5分ね。', true],
    ['数学21問は1問5分ですね。', false],
    ['数学15問は1問5分ですね。', false],
    ['数学20ページは1問5分ですね。', false],
    ['数学20問は11問5分ですね。', false],
    ['数学20問は2問あたり5分ですね。', false],
    ['数学20問は1問ではなく1ページ5分ですね。', false],
    ['数学20問は1問あたりではなく5分ですね。', false],
    ['数学20問ではなく1問5分ですね。', false],
    ['数学20問は全部で5分ですね。', false],
    ['数学20問は1問50分ですね。', false],
    ['数学20問は1問5分ですね？', false],
    ['数学20問は1問5分ですか。', false],
    ['数学20問は1問5分でよいですか。', false],
    ['数学20問は1問5分ではありませんね。', false],
    ['数学20問は1問5分なら進めます。', false],
  ] as const)('keeps workload quantity distinct from per-unit denominator and predicate: %s', (ack, valid) => {
    const renderInput = naturalEffortInput('math', 'duration_per_unit', 5);
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack,
      { groundingAcknowledgement: { factIds: ['effort'], text: ack } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([
    '英語20ページは全部で45分ですね。', '英語15問は全部で45分ですね。',
    '数学15ページは全部で45分ですね。', '英語15ページは1ページ45分ですね。',
    '英語15ページは全部で450分ですね。', '英語15〜20ページは全部で45分ですね。',
  ])('rejects another quantity, unit, target or measurement despite a natural ending: %s', ack => {
    const renderInput = naturalEffortInput();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack,
      { groundingAcknowledgement: { factIds: ['effort'], text: ack } }), renderInput).status).toBe('fallback');
  });
  it('keeps exact workload binding tied to both target id and task id', () => {
    for (const shape of ['missing', 'other-target', 'other-task'] as const) {
      const renderInput = naturalEffortInput();
      const information = renderInput.planningInformation!;
      information.workloads = shape === 'missing' ? [] : [{ id: shape === 'other-target' ? 'sibling-work' : 'english-work',
        taskId: shape === 'other-task' ? 'math' : 'english', amount: 15, unitLabel: 'ページ' }];
      const ack = '英語15ページは全部で45分ですね。';
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack,
        { groundingAcknowledgement: { factIds: ['effort'], text: ack } }), renderInput).status).toBe('fallback');
    }
  });
  it('accepts decimal-hour effort and refuses malformed extra duration assertions', () => {
    const renderInput = naturalEffortInput('math', 'total_duration', 90);
    const ack = '数学20問は全部で1.5時間ですね。';
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack,
      { groundingAcknowledgement: { factIds: ['effort'], text: ack } }), renderInput).status).toBe('rendered');
    for (const extra of ['英語は一千分です。', '英語は0分です。', '英語は5〜10分です。']) {
      const combined = ack + extra;
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, combined,
        { groundingAcknowledgement: { factIds: ['effort'], text: combined } }), renderInput).status).toBe('fallback');
    }
  });
  it.each(['数学は1問5分ですね。', '数学1問は1問5分ですね。'])('keeps a one-unit target distinct from its rate denominator: %s', ack => {
    const renderInput = naturalEffortInput('math', 'duration_per_unit', 5);
    const workloads = renderInput.planningInformation!.workloads as Array<Record<string, unknown>>;
    workloads.find(workload => workload.id === 'math-work')!.amount = 1;
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack,
      { groundingAcknowledgement: { factIds: ['effort'], text: ack } }), renderInput).status).toBe('rendered');
  });
  it.each([
    ['数学は1問5分くらいで見積もります。', 'duration_per_unit', 'approximate', true],
    ['数学は1問5分で見積もります。', 'duration_per_unit', 'exact', true],
    ['数学は、1問5分で見積もります。', 'duration_per_unit', 'exact', true],
    ['数学は11問5分です。', 'duration_per_unit', 'exact', false],
    ['数学は21問5分です。', 'duration_per_unit', 'exact', false],
    ['数学の代わりに英語は1問5分で見積もります。', 'duration_per_unit', 'exact', false],
    ['数学は2問あたり5分です。', 'duration_per_unit', 'exact', false],
    ['数学です。1問5分です。', 'duration_per_unit', 'exact', false],
    ['数学は1問5分、1問50分です。', 'duration_per_unit', 'exact', false],
    ['数学は全部で5分くらいで見積もります。', 'total_duration', 'approximate', true],
    ['英語は全部で999分です。', 'duration_per_unit', 'approximate', false],
    ['数学は全部で5分くらいです。', 'duration_per_unit', 'approximate', false],
    ['数学は1問5分です。', 'duration_per_unit', 'approximate', false],
    ['数学は1問5分くらいです。', 'total_duration', 'approximate', false],
    ['数学は1問999分くらいです。', 'duration_per_unit', 'approximate', false],
  ] as const)('validates visible effort ACK: %s', (text, kind, precision, valid) => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [],
      currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [{ factId: 'effort',
        kind: 'effort_estimate', sourceText: '5分', data: { targetFactId: 'math-work', taskId: 'math',
          targetLabels: ['数学'], minutes: 5, kind, precision, unitCode: kind === 'total_duration' ? null : 'problem', unitLabel: '問' } }] } });
    const result = parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['effort'], text } }), renderInput);
    expect(result.status).toBe(valid ? 'rendered' : 'fallback');
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: null }), renderInput).status).toBe('fallback');
  });
  it.each([
    ['数学は1問5分で見積もります。数学は全部で50分として扱います。', true],
    ['数学は全部で50分です。数学は1問5分で計算します。', true],
    ['数学は全部で5分です。数学は1問50分です。', false],
    ['数学は1問5分です。数学は1問5分です。', false],
  ] as const)('binds multiple measurements on the same target by the complete assertion: %s', (text, valid) => {
    const renderInput = input({ actionKind: 'status', questionCode: null, currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
      { factId: 'rate', kind: 'effort_estimate', sourceText: '1問5分', data: { targetLabels: ['数学'], minutes: 5, kind: 'duration_per_unit', precision: 'exact', unitLabel: '問' } },
      { factId: 'total', kind: 'effort_estimate', sourceText: '全部50分', data: { targetLabels: ['数学'], minutes: 50, kind: 'total_duration', precision: 'exact', unitLabel: null } },
    ] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['rate', 'total'], text } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([
    ['で見積もります。', true], ['です。', true], ['として扱います。', true], ['を目安にします。', true],
    ['ではありません。', false], ['ではないです。', false], ['と見積もりません。', false],
    ['でよいですか？', false], ['でいいでしょうか。', false], ['で計算しますか', false],
    ['なら計画できます。', false], ['という見積もりを取り消します。', false],
  ] as const)('requires an affirmative effort assertion ending: %s', (ending, valid) => {
    const ack = `数学は1問5分${ending}`;
    const renderInput = input({ requiredLabels: [], currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
      { factId: 'rate', kind: 'effort_estimate', sourceText: '1問5分', data: { targetLabels: ['数学'], minutes: 5, kind: 'duration_per_unit', precision: 'exact', unitLabel: '問' } },
    ] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack + 'いつ勉強できますか？',
      { groundingAcknowledgement: { factIds: ['rate'], text: ack } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([['なぜ？どうして？理科', '例題！演習。'], ['ではありません？数学', '確認ですか？演習']])(
    'preserves sentence punctuation and predicate-like words inside opaque labels: %s', (task, component) => {
      const ack = `「${task}」の「${component}」は1問5分で見積もります。`;
      const renderInput = input({ requiredLabels: [], currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
        { factId: 'rate', kind: 'effort_estimate', sourceText: '1問5分', data: { targetLabels: [task, component], minutes: 5, kind: 'duration_per_unit', precision: 'exact', unitLabel: '問' } },
      ] } });
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack,
        { groundingAcknowledgement: { factIds: ['rate'], text: ack } }), renderInput).status).toBe('rendered');
    },
  );
  it.each([
    ['数学は1問ではなく1ページ5分です。', 'duration_per_unit', 'exact', false],
    ['数学は1問あたりではなく5分です。', 'duration_per_unit', 'exact', false],
    ['数学は1問の代わりに1ページ5分です。', 'duration_per_unit', 'exact', false],
    ['数学は1問と2ページで5分です。', 'duration_per_unit', 'exact', false],
    ['数学は1問あたり英語では5分です。', 'duration_per_unit', 'exact', false],
    ['数学は全部ではなく5分です。', 'total_duration', 'exact', false],
    ['数学は合計の別の値は5分です。', 'total_duration', 'exact', false],
    ['数学は1問あたり、5分です。', 'duration_per_unit', 'exact', true],
    ['数学は1問につき5分で計算します。', 'duration_per_unit', 'exact', true],
    ['数学は1問で5分とします。', 'duration_per_unit', 'exact', true],
    ['数学は合計で5分です。', 'total_duration', 'exact', true],
    ['数学は1問あたり約5分とします。', 'duration_per_unit', 'approximate', true],
  ] as const)('consumes every connector between measurement and value: %s', (text, kind, precision, valid) => {
    const renderInput = input({ actionKind: 'status', questionCode: null, currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
      { factId: 'effort', kind: 'effort_estimate', sourceText: '5分', data: { targetLabels: ['数学'], minutes: 5, kind, precision, unitLabel: kind === 'total_duration' ? null : '問' } },
    ] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['effort'], text } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([
    ['数学は合計10分、英語は1問5分くらいで見積もります。', true],
    ['数学は合計5分、英語は1問10分くらいです。', false],
    ['数学は1問10分、英語は合計5分くらいです。', false],
    ['数学は合計10分くらい、英語は1問5分です。', false],
    ['数学は合計10分、英語は1問5分くらい。理科は全部で20分。', false],
  ] as const)('binds each compound ACK claim one-to-one: %s', (text, valid) => {
    const facts = [
      { factId: 'math', kind: 'effort_estimate' as const, sourceText: '10分', data: { targetLabels: ['数学'], minutes: 10, kind: 'total_duration', precision: 'exact', unitLabel: '問' } },
      { factId: 'english', kind: 'effort_estimate' as const, sourceText: '5分くらい', data: { targetLabels: ['英語'], minutes: 5, kind: 'duration_per_unit', precision: 'approximate', unitLabel: '問' } },
    ];
    const renderInput = input({ actionKind: 'status', questionCode: null, currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: facts } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['math', 'english'], text } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it.each([
    ['数学は合計10分、数学IIは1問5分くらいです。', true],
    ['数学IIは合計10分、数学は1問5分くらいです。', false],
    ['数学は合計10分、数学IIは1問5分くらい、1問50分です。', false],
  ] as const)('keeps overlapping canonical task labels distinct: %s', (text, valid) => {
    const renderInput = input({ actionKind: 'status', questionCode: null, currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
      { factId: 'math', kind: 'effort_estimate', sourceText: '10分', data: { targetLabels: ['数学'], minutes: 10, kind: 'total_duration', precision: 'exact', unitLabel: '問' } },
      { factId: 'advanced', kind: 'effort_estimate', sourceText: '5分くらい', data: { targetLabels: ['数学II'], minutes: 5, kind: 'duration_per_unit', precision: 'approximate', unitLabel: '問' } },
    ] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['math', 'advanced'], text } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
  });
  it('rejects a wrong target in the same sentence and preserves punctuation inside a component label', () => {
    const renderInput = input({ actionKind: 'status', questionCode: null, planningInformation: { tasks: [{ title: '数学' }, { title: '英語' }] },
      currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
        { factId: 'math', kind: 'effort_estimate', sourceText: '5分', data: { targetLabels: ['数学', '例題・演習'], minutes: 5, kind: 'duration_per_unit', precision: 'exact', unitLabel: '問' } },
      ] } });
    for (const [text, valid] of [['数学の例題・演習は1問5分です。', true], ['数学の例題・演習ではなく英語は1問5分です。', false]] as const) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
        { groundingAcknowledgement: { factIds: ['math'], text } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
    }
  });
  it.each(['数学は1問50分で見積もります。', '英語は全部で999分で見積もります。'])('rejects effort assertions outside the checked ACK prefix: %s', tail => {
    const ack = '数学は1問5分で見積もります。';
    const renderInput = input({ actionKind: 'status', questionCode: null, currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
      { factId: 'math', kind: 'effort_estimate', sourceText: '5分', data: { targetLabels: ['数学'], minutes: 5, kind: 'duration_per_unit', precision: 'exact', unitLabel: '問' } },
    ] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, ack + tail,
      { groundingAcknowledgement: { factIds: ['math'], text: ack } }), renderInput).status).toBe('fallback');
  });
  it('treats numbers inside canonical target labels as opaque display data', () => {
    const text = '0からの数学の第0章は1問5分です。';
    const renderInput = input({ actionKind: 'status', questionCode: null, currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
      { factId: 'math', kind: 'effort_estimate', sourceText: '5分', data: { targetLabels: ['0からの数学', '第0章'], minutes: 5, kind: 'duration_per_unit', precision: 'exact', unitLabel: '問' } },
    ] } });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['math'], text } }), renderInput).status).toBe('rendered');
  });
  it.each([[0.5, '0.5', true], [0.75, '0.75', true], [0.5, '0.75', false], [0.5, '5', false]] as const)(
    'compares fractional Luna effort (%s minutes) to visible %s', (minutes, shown, valid) => {
      const text = `数学は1語${shown}分で見積もります。`;
      const renderInput = input({ actionKind: 'status', questionCode: null, currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
        { factId: 'math', kind: 'effort_estimate', sourceText: `${minutes}分`, data: { targetLabels: ['数学'], minutes, kind: 'duration_per_unit', precision: 'exact', unitLabel: '語' } },
      ] } });
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
        { groundingAcknowledgement: { factIds: ['math'], text } }), renderInput).status).toBe(valid ? 'rendered' : 'fallback');
    },
  );
  it.each(['問(大)', '+', '.', '['])('treats custom unit label as literal data: %s', unitLabel => {
    const text = `数学は${unitLabel}あたり15分で見積もります。`;
    const renderInput = input({ actionKind: 'status', questionCode: null, currentTurnGrounding: { mode: 'required_before_resume', acceptedFacts: [
      { factId: 'math', kind: 'effort_estimate', sourceText: '15分', data: { targetLabels: ['数学'], minutes: 15, kind: 'duration_per_unit', precision: 'exact', unitLabel } },
    ] } });
    expect(() => parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text,
      { groundingAcknowledgement: { factIds: ['math'], text } }), renderInput)).not.toThrow();
  });
  it('accepts grounded explanation wording without requiring deterministic labels', () => {
    const renderInput = input();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '今回の週間計画に何時間分を入れるべきか確認したい、ということです。'),
      renderInput,
    )).toMatchObject({ status: 'rendered' });
  });

  it.each(['9:00', '09:00', '9：00', '9時', '09時', '午前9時'])(
    'accepts only equivalent clock display grounded by canonical 09:00 (%s)', (clock) => {
      const renderInput = input({ planningInformation: {
        availabilityDeclarations: [{ kind: 'available', startTime: '09:00', endTime: '12:00' }],
      } });
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${clock}から12:00の間に何を進めたいですか？`), renderInput,
      )).toMatchObject({ status: 'rendered' });
    },
  );

  it('grounds a reference to an actual commitment but rejects a fabricated time', () => {
    const renderInput = input({
      questionCode: 'missing_schedulable_work',
      actionId: 'stable-v5:request-1:missing_schedulable_work',
      currentUserMessage: '今日の予定を立てたい',
      planningInformation: null,
      referenceContext: {
        referenceDate: '2026-10-15',
        pastActivities: [{ source: 'completed', label: '数学の復習', date: '2026-10-12' }],
        targetDateCommitments: [{
          source: 'existing_commitment', label: '塾バイト', category: 'other',
          startTime: '19:00', endTime: '21:00',
        }],
      },
    });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '以前は数学の復習をしていたようですね。今日は19:00から塾バイトの予定がありますが、何を進めたいですか？'),
      renderInput,
    )).toMatchObject({ status: 'rendered' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '今日は18:45から塾バイトがあるので、何を進めたいですか？'),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    const noReference = { ...renderInput, referenceContext: undefined };
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(noReference, '今日は19:00から塾バイトがあるので、何を進めたいですか？'),
      noReference,
    )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });

  it('compares supported clock spellings by minutes symmetrically across the day', () => {
    for (const hour of [0, 1, 9, 12, 13, 21, 23]) for (const minute of [0, 5, 30, 59]) {
      const mm = String(minute).padStart(2, '0');
      const meridiem = hour < 12 ? '午前' : '午後';
      const hour12 = hour % 12 || 12;
      const forms = [`${String(hour).padStart(2, '0')}:${mm}`, `${hour}:${mm}`, `${hour}時${minute}分`,
        `${meridiem}${hour12}:${mm}`, `${meridiem}${hour12}時${minute}分`,
        ...(minute === 30 ? [`${meridiem}${hour12}時半`] : []),
      ];
      for (const source of forms) for (const target of forms) {
        const renderInput = input({ currentUserMessage: `基準は${source}です`, planningInformation: null });
        expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
          response(renderInput, `${target}から何を進めたいですか？`), renderInput,
        )).toMatchObject({ status: 'rendered' });
        const other = `${hour}:${String((minute + 1) % 60).padStart(2, '0')}`;
        expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
          response(renderInput, `${other}から何を進めたいですか？`), renderInput,
        )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
      }
    }
  });

  it.each(['08:00', '午後9時', '25:00', '29:00', '09:60', '109:00', '9時60分', '29時'])(
    'rejects different or invalid whole clock tokens without suffix matching (%s)', (clock) => {
      const renderInput = input({ planningInformation: {
        availabilityDeclarations: [{ kind: 'available', startTime: '09:00', endTime: '12:00' }],
      } });
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${clock}から何を進めたいですか？`), renderInput,
      )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    },
  );

  it('keeps sentence punctuation and time ranges outside valid clock tokens', () => {
    const renderInput = input({ planningInformation: {
      availabilityDeclarations: [{ kind: 'available', startTime: '09:00', endTime: '12:00' }],
    } });
    for (const text of ['9:00.', '9時.', '9:00．', '9:00。', '9:00,', '「9:00」',
      '09:00〜12:00', '09:00-12:00', '9時から12時まで']) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${text} 何を進めたいですか？`), renderInput,
      ), text).toMatchObject({ status: 'rendered' });
    }
  });

  it('rejects complete malformed or unsupported-precision tokens instead of valid fragments', () => {
    const renderInput = input({ planningInformation: {
      availabilityDeclarations: [{ kind: 'available', startTime: '09:00', endTime: '09:30' },
        { kind: 'available', startTime: '05:00' }],
    } });
    for (const clock of ['9:00:59', '9:00：59', '9::00', '9：：00', '9:00:', '9:00.5',
      '9時00分30秒', '9時30分半', '9時30.5分', '9:00秒', '9.5:00', '9.5時', '9..5:00']) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${clock}から何を進めたいですか？`), renderInput,
      ), clock).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    }
  });

  it('keeps meridiem in the clock meaning and rejects invalid meridiem combinations', () => {
    for (const [source, target] of [['09:00', '午後9:00'], ['21:00', '午前9:00'],
      ['13:00', '午後13時'], ['13:00', '午前13:00'], ['00:00', '午後12時'], ['12:00', '午前12:00']]) {
      const renderInput = input({ currentUserMessage: `基準は${source}です`, planningInformation: null });
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${target}から何を進めたいですか？`), renderInput,
      )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    }
  });

  it('retains grounded 24:00 day-end without treating it as same-day 00:00', () => {
    for (const [source, target, status] of [
      ['24:00', '24時', 'rendered'], ['24時', '24:00', 'rendered'],
      ['00:00', '24:00', 'fallback'], ['24:00', '0:00', 'fallback'],
      ['24:00', '24:01', 'fallback'], ['24:00', '午後12:00', 'fallback'],
    ]) {
      const renderInput = input({ currentUserMessage: `終了は${source}です`, planningInformation: null });
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(renderInput, `${target}までの予定について、どの作業ですか？`), renderInput,
      )).toMatchObject({ status });
    }
  });

  it('does not turn quantity ratios into clock tokens or weaken preview-count and save claims', () => {
    const ordinary = input();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(ordinary, '演習と復習を1:2に分けますか？'), ordinary,
    )).toMatchObject({ status: 'rendered' });
    const preview = input({ actionKind: 'preview_ready', questionCode: null, previewCount: 1,
      previewPromotionControlLabel: 'この内容で仮予定にする',
      planningInformation: { availabilityDeclarations: [{ kind: 'available', startTime: '09:00' }] },
    });
    for (const text of ['9:00から2件の候補があります。', '9:00からの予定を保存しました。']) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
        response(preview, `${text}この内容で仮予定にする`), preview,
      )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    }
  });

  it('grounds registration noun modifiers by current material identity and exact display names', () => {
    for (const actionKind of ['status', 'question'] as const) {
      const renderInput = input({ actionKind, questionCode: actionKind === 'question' ? 'quantity_role_unresolved' : null,
        currentUserMessage: '教材を使いたいです。', requiredLabels: [],
        planningInformation: { registeredMaterials: [
          { materialId: 'registered-b', name: '教材B', catalogTitle: '正式教材名', aliases: ['英語演習'] },
        ] },
      });
      for (const noun of ['教材B', '正式教材名', '英語演習', '「教材B」', '『英語演習』', '"正式教材名"']) {
        const text = `登録済みの${noun}で演習を進めたいのですね。`;
        expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput), text)
          .toMatchObject({ status: 'rendered' });
      }
    }
  });

  it('requires a current registered identity rather than user wording or another fact label', () => {
    for (const registeredMaterials of [undefined, [], [{ materialId: 'other', name: '教材C' }],
      [{ name: '教材B' }], [{ materialId: '', name: '教材B' }],
      [{ materialId: 'registered-b', name: '\u200b', aliases: ['\u200d'] }]]) {
      const renderInput = input({ actionKind: 'status', questionCode: null,
        currentUserMessage: '登録済みの教材Bを使いたいです。', requiredLabels: ['教材B'],
        planningInformation: { tasks: [{ title: '教材B' }], components: [{ label: '教材B' }], registeredMaterials },
      });
      for (const text of ['登録済みの教材Bで演習を進めたいのですね。', '登録済みのはじめての英語で進めたいのですね。']) {
        expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
          response(renderInput, text), renderInput,
        )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
      }
    }
  });

  it('retains ungrounded names, finite mutations, other attributes, and mixed-sentence operations', () => {
    const renderInput = input({ actionKind: 'status', questionCode: null, requiredLabels: [],
      planningInformation: { registeredMaterials: [{ materialId: 'registered-b', name: '教材B',
        aliases: ['危険な保存しました教材'] }] },
    });
    for (const text of ['登録済みの教材Cで進めます。', '登録済みの教材B改訂で進めます。',
      '登録済みの教材B2で進めます。', '教材Bを登録しました。', '教材Bは登録済みです。',
      '保存済みの教材Bで進めます。', '登録済みの教材Bを保存しました。',
      '登録済みの教材Bで進めます。予定を保存しました。',
      '登録済みの教材Bで進め、予定を登録しました。',
      '登録済みの危険な保存しました教材で進めます。']) {
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(renderInput, text), renderInput), text)
        .toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    }
  });

  it('rejects an identical repeat of the most recent assistant question', () => {
    const previousQuestion = '院試の第2分野について、今回進めたい量ですか？';
    const renderInput = input({
      currentUserMessage: 'その質問は何を確認したいの？',
      recentConversation: [
        { role: 'user', content: '院試を進めたい' },
        { role: 'assistant', content: previousQuestion },
      ],
    });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `  ${previousQuestion}\n`),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'repeated_question_text' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '予定に入れる量を決めるための確認です。今回はどれくらい進めたいですか？'),
      renderInput,
    )).toMatchObject({ status: 'rendered' });
  });

  it('rejects action identity and question contract changes', () => {
    const renderInput = input();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '今回進める量ですか？', { actionId: 'other-action' }),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'action_mismatch' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, 'いつからいつまでですか？', { questionCode: 'invalid_planning_horizon' }),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'action_contract_mismatch' });
  });

  it('requires an observable accepted-fact acknowledgement before resuming a pending question', () => {
    const renderInput = input({
      actionId: 'stable-v5:request-complete:missing_schedulable_work',
      currentUserMessage: 'もう100%終わっています',
      currentTurnGrounding: {
        mode: 'required_before_resume',
        acceptedFacts: [{
          factId: 'workload-completed-100',
          kind: 'workload',
          sourceText: 'もう100%終わっています',
          data: {
            taskId: 'task-slides',
            quantityRole: 'completed',
            amount: 100,
            unitCode: 'custom',
            unitLabel: '%',
          },
        }],
      },
      planningInformation: {
        tasks: [{ id: 'task-slides', title: '夏合宿の発表スライド', category: 'non_study' }],
        workloads: [{
          id: 'workload-completed-100',
          taskId: 'task-slides',
          quantityRole: 'completed',
          amount: 100,
          unitCode: 'custom',
          unitLabel: '%',
        }],
      },
      questionCode: 'missing_schedulable_work',
      questionIntent: {
        kind: 'schedulable_work_detail',
        mode: 'all_requested_work_complete',
        targetFactId: null,
        progressBasis: null,
        knownUnitCode: null,
        knownUnitLabel: null,
        requestedInformation: ['additional_task_or_constraint'],
      },
      requiredLabels: [],
      fallbackText: '指定された作業は完了済みです。ほかに予定へ加えたい作業や、考慮したい予定・制約があれば教えてください。',
    });
    const acknowledgement = 'スライドは100%まで完了しているんですね。';
    const continuation = 'ほかに予定へ加えたい作業や、考慮したい予定・制約はありますか？';

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, continuation),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `${acknowledgement}${continuation}`, {
        groundingAcknowledgement: {
          factIds: ['other-fact'],
          text: acknowledgement,
        },
      }),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `${continuation}${acknowledgement}`, {
        groundingAcknowledgement: {
          factIds: ['workload-completed-100'],
          text: acknowledgement,
        },
      }),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `${acknowledgement}${continuation}`, {
        groundingAcknowledgement: {
          factIds: ['workload-completed-100'],
          text: acknowledgement,
        },
      }),
      renderInput,
    )).toMatchObject({ status: 'rendered' });
  });

  it('requires a resumed-question ACK to preserve the accepted concrete clock value', () => {
    const renderInput = input({
      actionId: 'stable-v5:request-deadline:missing_schedulable_work',
      currentUserMessage: '締切は明日の13時です',
      currentTurnGrounding: {
        mode: 'required_before_resume',
        acceptedFacts: [{
          factId: 'deadline-13',
          kind: 'temporal_constraint',
          sourceText: '締切は明日の13時です',
          data: {
            taskId: 'task-report',
            targetFactId: 'task-report',
            kind: 'deadline',
            constraintLevel: 'hard',
            dateExpression: 'tomorrow',
            namedTimePeriod: null,
            startTime: null,
            endTime: '13:00',
            precision: 'exact',
          },
        }],
      },
      planningInformation: {
        tasks: [{ id: 'task-report', title: '研究室のレポート', category: 'study' }],
        temporalConstraints: [{
          id: 'deadline-13',
          taskId: 'task-report',
          kind: 'deadline',
          dateExpression: 'tomorrow',
          endTime: '13:00',
        }],
      },
      questionCode: 'missing_schedulable_work',
      requiredLabels: ['研究室のレポート'],
      fallbackText: '完成を100%とすると、今はだいたい何%くらいまで進んでいますか？',
    });
    const continuation = '研究室のレポートは、完成を100%とすると現在どのくらい進んでいますか？';
    const genericAck = '締切の情報を受け取りました。';
    const groundedAck = '締切は明日の13時ですね。';

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `${genericAck}${continuation}`, {
        groundingAcknowledgement: {
          factIds: ['deadline-13'],
          text: genericAck,
        },
      }),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'grounding_contract_mismatch' });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, `${groundedAck}${continuation}`, {
        groundingAcknowledgement: {
          factIds: ['deadline-13'],
          text: groundedAck,
        },
      }),
      renderInput,
    )).toMatchObject({ status: 'rendered' });
  });

  it('rejects ungrounded dates, clock times, unsafe content, and malformed JSON', () => {
    const renderInput = input();
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '明日の20時から3時間進める予定として扱います。'),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, 'https://example.test を開いてください。'),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'unsafe_text' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      'not-json',
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'invalid_json' });
  });

  it('rejects premature claims that a task was already put into a plan before preview', () => {
    const renderInput = input({
      currentUserMessage: '研究室のレポートを仕上げたいです',
      questionCode: 'missing_schedulable_work',
    });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '明日の予定に、研究室のレポートを仕上げる作業を入れます。全体量を教えてください。'),
      renderInput,
    )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(renderInput, '研究室のレポートを仕上げたいのですね。全体量を教えてください。'),
      renderInput,
    )).toMatchObject({ status: 'rendered' });
  });

  it('keeps preview prose dynamic while requiring the typed promotion control', () => {
    const previewInput = input({
      actionId: 'stable-v5:request-preview:preview_ready',
      currentUserMessage: 'それで作って',
      actionKind: 'preview_ready',
      questionCode: null,
      previewPromotionControlLabel: 'この内容で仮予定にする',
      requiredLabels: ['この内容で仮予定にする'],
      fallbackText: '2件の仮予定候補を作りました。',
      previewCount: 2,
    });

    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(previewInput, '候補を確認して、よければ「この内容で仮予定にする」を押してください。'),
      previewInput,
    )).toMatchObject({ status: 'rendered' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(previewInput, '仮予定候補を確認してください。'),
      previewInput,
    )).toMatchObject({ status: 'fallback', reason: 'action_contract_mismatch' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(
      response(previewInput, '3件の候補です。「この内容で仮予定にする」を押してください。'),
      previewInput,
    )).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
});
