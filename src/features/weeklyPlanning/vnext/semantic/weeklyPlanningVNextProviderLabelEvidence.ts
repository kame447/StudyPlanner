import type { WeeklyPlanningVNextInterpretationInput } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextTurnError } from '../weeklyPlanningVNextTypes';
import type { VNextProviderReading } from './weeklyPlanningVNextProviderSchema';
import { filterActiveWeeklyPlanningFactsV5 } from '../../semantic/weeklyPlanningFactLifecycleV5';
import { isVNextPercentUnit } from '../weeklyPlanningVNextWorkIdentity';

/** Turn-only quotation selected by the semantic provider, never persisted as a fact. */
export interface VNextTitleQuotation {
  readonly localId: string;
  readonly quote: string;
}

type LabelInput = Pick<WeeklyPlanningVNextInterpretationInput,
  'state' | 'userText' | 'recentConversation' | 'supplementalContext' | 'selectedStarterTarget'>;

/** Check literal evidence, not language or intent. The provider still chooses the relevant name. */
export function validateVNextProviderLabelEvidence(
  input: LabelInput,
  reading: Pick<VNextProviderReading, 'delta'>,
  titleQuotations: readonly VNextTitleQuotation[] = [],
): VNextTurnError[] {
  const graph = input.state.graph;
  const tasks = filterActiveWeeklyPlanningFactsV5(graph, graph.tasks);
  const workloads = filterActiveWeeklyPlanningFactsV5(graph, graph.workloads);
  const efforts = filterActiveWeeklyPlanningFactsV5(graph, graph.effortEstimates);
  const sources = [input.userText, input.supplementalContext, input.selectedStarterTarget?.label,
    ...(input.recentConversation?.filter(turn => turn.role === 'user').map(turn => turn.content) ?? []),
    ...tasks.map(task => task.title),
    ...workloads.filter(work => work.unitCode === 'custom').map(work => work.unitLabel),
    ...efforts.filter(effort => effort.unitCode === 'custom').map(effort => effort.unitLabel),
  ].filter((source): source is string => typeof source === 'string');
  const supported = (label: string | null) => label !== null && label.trim().length > 0
    && sources.some(source => source.includes(label));
  // Percentage is an existing canonical typed unit (%), rather than a free custom label.
  const supportedCustomUnit = (label: string | null) => isVNextPercentUnit({ unitCode: 'custom', unitLabel: label }) || supported(label);
  const errors: VNextTurnError[] = [];
  // A label translation is semantic, so the existing single semantic reread must
  // repair it together with related labels; a field-only shape splice is insufficient.
  const reject = (localId: string) => errors.push({ code: 'invalid_value', path: 'labelEvidence', localId, factId: null });
  const titles = [...reading.delta.add.filter(fact => fact.kind === 'task').map(fact => ({ localId: fact.localId, title: fact.title })),
    ...reading.delta.patch.flatMap(patch => patch.kind === 'task' && patch.changes.title !== null
      ? [{ localId: patch.localId, title: patch.changes.title }] : [])];
  for (const evidence of titleQuotations) {
    const title = titles.find(task => task.localId === evidence.localId)?.title;
    if (!title || !supported(evidence.quote) || !title.includes(evidence.quote)
      || titleQuotations.filter(other => other.localId === evidence.localId).length !== 1) reject(evidence.localId);
  }
  for (const task of titles) {
    const quote = titleQuotations.find(evidence => evidence.localId === task.localId)?.quote;
    if (!supported(task.title) && !(quote && supported(quote) && task.title.includes(quote))) reject(task.localId);
  }
  for (const fact of reading.delta.add) {
    if ((fact.kind === 'workload' || fact.kind === 'effort_estimate')
      && fact.unitCode === 'custom' && !supportedCustomUnit(fact.unitLabel)) reject(fact.localId);
  }
  for (const patch of reading.delta.patch) {
    if (patch.kind !== 'workload' && patch.kind !== 'effort_estimate') continue;
    if (patch.changes.unitCode === null && patch.changes.unitLabel === null) continue;
    const previous = patch.kind === 'workload'
      ? workloads.find(work => work.id === patch.targetFactId) : efforts.find(effort => effort.id === patch.targetFactId);
    const code = patch.changes.unitCode ?? previous?.unitCode;
    const label = patch.changes.unitLabel ?? previous?.unitLabel ?? null;
    if (code === 'custom' && !supportedCustomUnit(label)) reject(patch.localId);
  }
  return errors;
}
