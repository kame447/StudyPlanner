// Stable V5 semantic model compatibility facade.
//
// Keep domain concepts and provider wire schema in separate modules so a change
// to one does not create a reason to edit the other. Existing importers may use
// this facade while new code should import the owning module directly.
export * from './weeklyPlanningSemanticTypesV5';
export { WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5 } from './weeklyPlanningSemanticSchemaV5';
