import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    : [];
}

/**
 * A bookshelf identity is context for a new material component, not an existing
 * Fact Graph component. Project only an exact, owner-scoped material reference
 * with a matching structured label into the ordinary component-creation path.
 * All evidence, existing-entity and correction validators still run afterwards.
 */
export function projectWeeklyPlanningRegisteredMaterialReferencesV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  publicStateSummary?: Record<string, unknown>;
}): { document: WeeklyPlanningSemanticDocumentV5; repairs: string[] } {
  const { document, publicStateSummary: state } = params;
  const materials = records(state?.registeredMaterials);
  if (materials.length === 0) return { document, repairs: [] };

  const activeComponents = records(state?.components);
  const repairs: string[] = [];
  const tasks = document.tasks.map(task => {
    // Existing task/component mutations retain their ordinary binding contract.
    if (task.existingPublicId || !task.study) return task;
    const components = task.study.components.map(component => {
      const reference = component.existingPublicId;
      if (!reference || component.role !== 'material'
        || activeComponents.some(entry => entry.publicId === reference)) return component;
      const matches = materials.filter(entry => entry.materialId === reference);
      if (matches.length !== 1) return component;
      const material = matches[0];
      const labels = [material.name, material.catalogTitle,
        ...(Array.isArray(material.aliases) ? material.aliases : [])];
      if (!labels.some(label => typeof label === 'string' && label === component.label)) return component;
      repairs.push(`registered-material-component-reference-projected:${component.localId}:${reference}`);
      return { ...component, existingPublicId: null };
    });
    return components.some((component, index) => component !== task.study!.components[index])
      ? { ...task, study: { ...task.study, components } }
      : task;
  });
  return { document: repairs.length > 0 ? { ...document, tasks } : document, repairs };
}
