import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { weeklyPlanningLabelEvidencedBySourceV5 } from './weeklyPlanningCurrentTurnProvenanceV5';

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    : [];
}

function materialLabels(material: Record<string, unknown>): unknown[] {
  return [material.name, material.catalogTitle,
    ...(Array.isArray(material.aliases) ? material.aliases : [])];
}

/**
 * A bookshelf identity is context for a new material component, not an existing
 * Fact Graph component. Project only an exact, owner-scoped material reference
 * with a matching structured label into the ordinary component-creation path.
 * Before any task is accepted, a task cannot continue one either, so the same exact
 * reference on the task itself names a new task. A new material component of an
 * accepted task that has no material yet may cite it too. All evidence,
 * existing-entity and correction validators still run afterwards.
 */
export function projectWeeklyPlanningRegisteredMaterialReferencesV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  publicStateSummary?: Record<string, unknown>;
}): { document: WeeklyPlanningSemanticDocumentV5; repairs: string[] } {
  const { document, publicStateSummary: state } = params;
  const materials = records(state?.registeredMaterials);
  if (materials.length === 0) return { document, repairs: [] };

  const activeComponents = records(state?.components);
  const acceptedTasks = records(state?.tasks);
  const noAcceptedTask = acceptedTasks.length === 0;
  const repairs: string[] = [];
  const tasks = document.tasks.map(original => {
    let task = original;
    const taskReference = task.existingPublicId;
    // The reference must name one task in this response: two tasks citing the same
    // bookshelf id are an ambiguity for the provider repair, not two new tasks.
    if (taskReference && noAcceptedTask
      && document.tasks.filter(entry => entry.existingPublicId === taskReference).length === 1) {
      const matches = materials.filter(entry => entry.materialId === taskReference);
      if (matches.length === 1 && materialLabels(matches[0]).some(label => label === task.title)) {
        repairs.push(`registered-material-task-reference-projected:${task.localId}:${taskReference}`);
        task = { ...task, existingPublicId: null };
      }
    }
    // Other existing task/component mutations retain their ordinary binding contract.
    const acceptedTaskId = task.existingPublicId;
    if (!task.study || (acceptedTaskId && !acceptedTasks.some(entry => entry.publicId === acceptedTaskId))) return task;
    const components = task.study.components.map(component => {
      const reference = component.existingPublicId;
      if (!reference || component.role !== 'material'
        || activeComponents.some(entry => entry.publicId === reference)) return component;
      // As for tasks: two components citing one bookshelf id are an ambiguity for the
      // provider repair, not two new materials with duplicated work.
      if (document.tasks.flatMap(entry => entry.study?.components ?? [])
        .filter(entry => entry.existingPublicId === reference).length !== 1) return component;
      const matches = materials.filter(entry => entry.materialId === reference);
      if (matches.length !== 1) return component;
      if (!materialLabels(matches[0]).some(label => typeof label === 'string' && label === component.label)) {
        return component;
      }
      // Live B on b2fbd121: 「青チャートのこと」 answered the material question with the
      // bookshelf id on a new component of the accepted task. Only a task with no material
      // yet is given one; for a task that has one, relabel versus addition stays ambiguous
      // and keeps the ordinary binding error and repair. The bookshelf name must also be
      // evidenced by the component's own current-turn source (not adopted after 「ありがとう」).
      if (acceptedTaskId && (activeComponents.some(entry => entry.taskPublicId === acceptedTaskId
        && entry.role === 'material') || !weeklyPlanningLabelEvidencedBySourceV5(component.label, component.sourceText))) return component;
      repairs.push(`registered-material-component-reference-projected:${component.localId}:${reference}`);
      return { ...component, existingPublicId: null };
    });
    const study = task.study;
    return components.some((component, index) => component !== study.components[index])
      ? { ...task, study: { ...study, components } }
      : task;
  });
  return { document: repairs.length > 0 ? { ...document, tasks } : document, repairs };
}
