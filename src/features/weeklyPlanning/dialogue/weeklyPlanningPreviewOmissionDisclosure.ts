import type { WeeklyPlanningPreviewOmittedWork } from '../application/weeklyPlanningInteractionOutcome';

/**
 * Application-owned disclosure of work the scheduler left out of a preview (Issue #488).
 *
 * Which work did not fit is a scheduling decision, not wording. In the interaction architecture
 * the renderer writes the preview reply but never states whether this work is included; the
 * application states it with this sentence next to the reply (and in the emergency wording), so
 * no reply can claim that omitted work is in the preview.
 */
const SOME_WORK_OMITTED = '空き時間に入りきらなかった作業は、今回の候補には入れていません。';

export function weeklyPlanningPreviewOmissionDisclosureText(
  omittedWork: readonly WeeklyPlanningPreviewOmittedWork[],
): string {
  const all = omittedWork.filter((work) => work.extent === 'all').map((work) => work.label);
  const part = omittedWork.filter((work) => work.extent === 'part').map((work) => work.label);
  if (all.length === 0 && part.length === 0) return SOME_WORK_OMITTED;
  return [
    all.length > 0 ? `${all.join('・')}は空き時間に入りきらなかったので、今回の候補には入れていません。` : '',
    part.length > 0 ? `${part.join('・')}は、空き時間に入りきらなかった分を今回の候補から外しています。` : '',
  ].join('');
}
