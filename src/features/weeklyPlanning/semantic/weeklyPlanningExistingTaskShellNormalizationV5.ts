export interface ExistingTaskShellNormalizationV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicTaskById(
  publicStateSummary: Record<string, unknown> | undefined,
  publicId: string,
): Record<string, unknown> | null {
  if (!publicStateSummary || !Array.isArray(publicStateSummary.tasks)) return null;
  const candidate = publicStateSummary.tasks.find(
    (task) => isRecord(task) && task.publicId === publicId,
  );
  return isRecord(candidate) ? candidate : null;
}

/**
 * Provider responses are current-turn deltas. An existing study task therefore
 * does not need to repeat its durable study metadata just to attach a new fact
 * such as a deadline. The strict JSON schema permits study=null, while the base
 * semantic validator requires study metadata for a newly created study task.
 *
 * When an existingPublicId is present and is verified by the public state as a
 * study task, fill only a transient unknown study shell so structural parsing
 * can proceed. Existing-entity binding removes the transient task/study context
 * before commit, so no new study meaning is invented or persisted.
 */
export function normalizeWeeklyPlanningExistingTaskShellV5(params: {
  rawResponse: string;
  publicStateSummary?: Record<string, unknown>;
}): ExistingTaskShellNormalizationV5 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(params.rawResponse);
  } catch {
    return { rawResponse: params.rawResponse, repairs: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
    return { rawResponse: params.rawResponse, repairs: [] };
  }

  const repairs: string[] = [];
  parsed.tasks.forEach((task, index) => {
    if (
      !isRecord(task)
      || task.study !== null
      || task.category !== 'study'
      || typeof task.existingPublicId !== 'string'
      || !task.existingPublicId
    ) return;

    const publicTask = publicTaskById(params.publicStateSummary, task.existingPublicId);
    if (!publicTask || publicTask.category !== 'study') return;

    task.study = {
      purpose: 'unknown',
      activityKind: 'unknown',
      contextLabel: null,
      components: [],
    };
    const localId = typeof task.localId === 'string' && task.localId
      ? task.localId
      : String(index);
    repairs.push(`existing-study-task-shell-filled:${localId}:${task.existingPublicId}`);
  });

  return repairs.length === 0
    ? { rawResponse: params.rawResponse, repairs: [] }
    : { rawResponse: JSON.stringify(parsed), repairs };
}
