import type { Plan } from '../../../types/domain';
import {
  installScriptedWeeklyPlanningProvider, scriptedRendererReply, type ScriptedProviderCall,
} from './weeklyPlanningScriptedConversationHarness';

// Synthetic exam-student overload scenario (copy of the B1 test's fixture so other tests can reuse it;
// no real data). Bulk request, decline of the strategy proposal, then +120 problems of physics.
type Json = Record<string, unknown>;

const empty = (o: Json = {}): Json => ({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
  tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
  corrections: [], decisions: [], conversationActs: [], ...o });
const nextWeek = { localId: 'week', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週' };
const workload = (id: string, amount: number, unitCode: string, unitLabel: string, sourceText: string): Json => ({ localId: `${id}-amount`,
  quantityRole: 'target', amount, unitCode, unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText });
const effort = (id: string, kind: string, minutes: number, unitCode: string, sourceText: string): Json => ({ localId: `${id}-${kind}`,
  targetLocalId: id, kind, minutes, unitCode, precision: 'approximate', sourceText });
const deadline = (id: string, date: string, sourceText: string): Json => ({ localId: `${id}-deadline`, targetLocalId: id, kind: 'deadline',
  constraintLevel: 'hard', dateExpression: date, namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText });
const task = (o: { id: string; title: string; kind: string; workloads: Json[]; efforts?: Json[]; deadlines: Json[]; sourceText: string }): Json => ({
  localId: o.id, existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: o.title,
  study: { purpose: 'exam', activityKind: o.kind, contextLabel: null, components: [] }, workloads: o.workloads, effortEstimates: o.efforts ?? [],
  temporalConstraints: o.deadlines, recurrence: [], durableContextSignals: [], sourceText: o.sourceText });

export const BULK = '来週の受験勉強をまとめて計画して。数学は微積の問題を30問（1問6分くらい）、英語は長文を4本（1本35分）と英単語を140個（25個で30分くらい）、物理の力学を20問（1問6分）、化学の有機を2章（1章60分）、現代文の記述を3題（1題40分）、古文の敬語を60分、日本史の文化史を90分、小論文を1本90分で進めたい。数学は金曜まで、それ以外は日曜まで。分けられる勉強は1回30〜60分にして、塾・部活・授業とか既存の予定を避けて、無理のないところへいい感じに分散して。';
export const DECLINE = '英単語は暗記向きの提案はいらないです。そのまま予定を作ってください';
export const COMBINED = '数学は20問に減らして、英語長文は土日にまとめたい。ほかの科目はそのままで。';
export const OVERLOAD = '物理をさらに120問（1問6分）増やす。来週中に全部やりたい。';
export const DOWN = '数学は20問に減らして。ほかの科目はそのままで。';

function bulk(mathProblems: number, mathLast = false, mathSecond = false): Json {
  const sun = (d: string) => [deadline(d, '2026-10-18', 'それ以外は日曜まで')];
  const split = (d: string) => effort(d, 'session_duration', 60, 'session', '1回30〜60分');
  const perUnit = (d: string, m: number, t: string) => [effort(d, 'session_duration', m, 'session', t)];
  const doc = empty({ planningIntent: 'create_plan', planningWindow: nextWeek, tasks: [
    task({ id: 'math-calculus', title: '数学・微積', kind: 'problem_solving', sourceText: '数学は微積の問題を30問（1問6分くらい）',
      workloads: [workload('math-calculus', mathProblems, 'problem', '問', '30問')],
      efforts: [effort('math-calculus', 'duration_per_unit', 6, 'problem', '1問6分くらい'), split('math-calculus')],
      deadlines: [deadline('math-calculus', '2026-10-16', '数学は金曜まで')] }),
    task({ id: 'english-reading', title: '英語・長文', kind: 'reading', sourceText: '英語は長文を4本（1本35分）',
      workloads: [workload('english-reading', 4, 'custom', '本', '4本')],
      efforts: [effort('english-reading', 'duration_per_unit', 35, 'custom', '1本35分'), ...perUnit('english-reading', 35, '1本35分')], deadlines: sun('english-reading') }),
    task({ id: 'english-vocab', title: '英単語', kind: 'memorization_retrieval', sourceText: '英単語を140個（25個で30分くらい）',
      workloads: [workload('english-vocab', 140, 'word', '個', '140個')],
      efforts: [effort('english-vocab', 'duration_per_unit', 1.2, 'word', '25個で30分くらい'), split('english-vocab')], deadlines: sun('english-vocab') }),
    task({ id: 'physics', title: '物理・力学', kind: 'problem_solving', sourceText: '物理の力学を20問（1問6分）',
      workloads: [workload('physics', 20, 'problem', '問', '20問')],
      efforts: [effort('physics', 'duration_per_unit', 6, 'problem', '1問6分'), split('physics')], deadlines: sun('physics') }),
    task({ id: 'chemistry', title: '化学・有機', kind: 'reading', sourceText: '化学の有機を2章（1章60分）',
      workloads: [workload('chemistry', 2, 'chapter', '章', '2章')],
      efforts: [effort('chemistry', 'duration_per_unit', 60, 'chapter', '1章60分'), ...perUnit('chemistry', 60, '1章60分')], deadlines: sun('chemistry') }),
    task({ id: 'japanese-reading', title: '現代文・記述', kind: 'writing', sourceText: '現代文の記述を3題（1題40分）',
      workloads: [workload('japanese-reading', 3, 'custom', '題', '3題')],
      efforts: [effort('japanese-reading', 'duration_per_unit', 40, 'custom', '1題40分'), ...perUnit('japanese-reading', 40, '1題40分')], deadlines: sun('japanese-reading') }),
    task({ id: 'japanese-classics', title: '古文・敬語', kind: 'reading', sourceText: '古文の敬語を60分',
      workloads: [workload('japanese-classics', 60, 'minute', '分', '60分')], deadlines: sun('japanese-classics') }),
    task({ id: 'japanese-history', title: '日本史・文化史', kind: 'memorization_retrieval', sourceText: '日本史の文化史を90分',
      workloads: [workload('japanese-history', 90, 'minute', '分', '90分')], efforts: [split('japanese-history')], deadlines: sun('japanese-history') }),
    task({ id: 'essay', title: '小論文', kind: 'writing', sourceText: '小論文を1本90分',
      workloads: [workload('essay', 1, 'custom', '本', '1本')],
      efforts: [effort('essay', 'duration_per_unit', 90, 'custom', '1本90分')], deadlines: sun('essay') }),
  ] });
  if (mathSecond) {
    const [math, english, ...rest] = doc.tasks as Json[];
    return { ...doc, tasks: [english, math, ...rest] };
  }
  if (!mathLast) return doc;
  const [math, ...others] = doc.tasks as Json[];
  return { ...doc, tasks: [...others, math] };
}

function down(summary: Json): Json {
  const tasks = (summary.tasks as Json[]) ?? [];
  const bound = tasks.find(t => t.title === '数学・微積')!;
  const old = ((summary.workloads as Json[]) ?? []).find(w => w.taskPublicId === bound.publicId)!;
  return empty({ tasks: [{ localId: `follow-${bound.publicId}`, existingPublicId: bound.publicId, decompositionStatus: 'atomic', category: 'study',
    title: '数学・微積', study: null, workloads: [workload('math-new', 20, 'problem', '問', '20問に減らして')], effortEstimates: [], temporalConstraints: [],
    recurrence: [], durableContextSignals: [], sourceText: '数学は20問に減らして' }],
  corrections: [{ localId: 'math-down', target: { kind: 'workload', publicId: old.publicId, localId: null, mention: null }, operation: 'replace',
    replacementLocalId: 'math-new-amount', sourceText: '数学は20問に減らして' }] });
}

function decline(summary: Json): Json {
  const proposal = (((summary.learningStrategyProposals as Json[]) ?? []).find(p => p.status === 'pending'))!;
  return empty({ decisions: [{ localId: 'decline', target: { kind: 'proposal', publicId: proposal.publicId, localId: null, mention: null },
    decision: 'reject', sourceText: '提案はいらない' }] });
}

function combined(summary: Json): Json {
  const base = down(summary);
  const english = ((summary.tasks as Json[]) ?? []).find(t => t.title === '英語・長文')!;
  const localId = `follow-${english.publicId}`;
  return { ...base, tasks: [...(base.tasks as Json[]), { localId, existingPublicId: english.publicId, decompositionStatus: 'atomic', category: 'study',
    title: '英語・長文', study: null, workloads: [], effortEstimates: [], recurrence: [], durableContextSignals: [], sourceText: '英語長文は土日にまとめたい',
    temporalConstraints: [{ localId: 'english-weekend', targetLocalId: localId, kind: 'allowed_date', constraintLevel: 'hard',
      dateExpression: '2026-10-17/2026-10-18', namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText: '英語長文は土日にまとめたい' }] }] };
}

function overload(summary: Json): Json {
  const physics = ((summary.tasks as Json[]) ?? []).find(t => t.title === '物理・力学')!;
  return empty({ tasks: [{ localId: `follow-${physics.publicId}`, existingPublicId: physics.publicId, decompositionStatus: 'atomic', category: 'study',
    title: '物理・力学', study: null, workloads: [workload('physics-extra', 120, 'problem', '問', '120問増やす')], effortEstimates: [], temporalConstraints: [],
    recurrence: [], durableContextSignals: [], sourceText: '物理をさらに120問増やす' }] });
}

export function installExamOverloadProvider(initialMath: number, mathLast = false, mathSecond = false) {
  return installScriptedWeeklyPlanningProvider((call: ScriptedProviderCall) => {
    if (call.kind === 'renderer') return scriptedRendererReply(call, 'わかりました。');
    if (call.kind === 'semantic_focused_authorization') return JSON.stringify({ decision: 'fallback' });
    if (call.kind === 'semantic_focused_contextual') return JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null, minutes: null, precision: null, quantityRole: null });
    if (call.schemaName === 'weekly_planning_focused_material_answer_v5') return JSON.stringify({ decision: 'fallback', label: null, registeredChoice: null, workloadChoice: null, effortKind: null, minutes: null, precision: null, sourceText: null, effortSourceText: null });
    const text = String(call.payload?.userText ?? '');
    if (text === BULK) return JSON.stringify(bulk(initialMath, mathLast, mathSecond));
    if (text === DECLINE) return JSON.stringify(decline((call.payload?.publicStateSummary ?? {}) as Json));
    if (text === COMBINED) return JSON.stringify(combined((call.payload?.publicStateSummary ?? {}) as Json));
    if (text === OVERLOAD) return JSON.stringify(overload((call.payload?.publicStateSummary ?? {}) as Json));
    if (text === DOWN) return JSON.stringify(down((call.payload?.publicStateSummary ?? {}) as Json));
    throw new Error(`unscripted: ${text}`);
  });
}
// Synthetic busy time of the exam-student persona (school, club, cram school, mock exam, meals and travel buffers).
const BUSY: Array<[string, string, string, string]> = [["2026-10-12","08:20","15:40","学校"],["2026-10-13","08:20","15:40","学校"],["2026-10-14","08:20","15:40","学校"],["2026-10-15","08:20","15:40","学校"],["2026-10-16","08:20","15:40","学校"],["2026-10-12","16:00","18:00","部活動"],["2026-10-14","16:00","18:00","部活動"],["2026-10-13","16:00","17:30","補講"],["2026-10-13","19:00","21:30","塾"],["2026-10-14","18:30","19:30","補講"],["2026-10-15","19:00","21:30","塾"],["2026-10-16","16:30","17:30","面談"],["2026-10-17","09:00","12:30","模試"],["2026-10-17","13:30","14:30","振り返り"],["2026-10-18","13:00","15:00","家庭行事"],["2026-10-12","19:00","19:30","夕食"],["2026-10-14","19:00","19:30","夕食"],["2026-10-16","19:00","19:30","夕食"],["2026-10-17","19:00","19:30","夕食"],["2026-10-18","19:00","19:30","夕食"],["2026-10-12","18:00","18:20","帰宅"],["2026-10-14","18:00","18:20","帰宅"],["2026-10-13","18:30","19:00","移動"],["2026-10-13","21:30","21:50","帰宅"],["2026-10-15","18:30","19:00","移動"],["2026-10-15","21:30","21:50","帰宅"],["2026-10-16","17:30","17:50","帰宅"],["2026-10-17","08:30","09:00","移動"],["2026-10-17","12:30","13:00","移動"]];
export const examBusyPlans: Plan[] = BUSY.map(([date, startTime, endTime, title], index) => ({ id: `busy-${index}`, seriesId: `busy-${index}`, userId: 'issue488-owner',
  title, subject: '', date, startTime, endTime, repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'other', memo: '',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }));
