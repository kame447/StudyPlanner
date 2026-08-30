from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one anchor, found {count}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    'src/repositories/plannerRepository.ts',
    '''function applyPlanMutation(\n  current: Plan[],\n  mutation: RecurringPlanMutation,\n): Plan[] {\n  const deleteIds = new Set(mutation.planDeletes.map((plan) => plan.id));\n  return mutation.planUpserts.reduce(\n    (records, plan) => replaceById(records, plan),\n    current.filter((plan) => !deleteIds.has(plan.id)),\n  );\n}\n\nfunction applyActualMutation(\n  current: Actual[],\n  mutation: RecurringPlanMutation,\n): Actual[] {\n  const planDeleteIds = new Set(mutation.planDeletes.map((plan) => plan.id));\n  const actualDeleteIds = new Set(mutation.actualDeletes.map((actual) => actual.id));\n  const reboundIds = new Set(mutation.actualUpserts.map((actual) => actual.id));\n  const remaining = current.filter(\n    (actual) =>\n      reboundIds.has(actual.id) ||\n      (!actualDeleteIds.has(actual.id) &&\n        (!actual.planId || !planDeleteIds.has(actual.planId))),\n  );\n  return mutation.actualUpserts.reduce(\n    (records, actual) => upsertActualRecord(records, actual),\n    remaining,\n  );\n}\n''',
    '''function applyPlanMutation(\n  current: Plan[],\n  userId: string,\n  mutation: RecurringPlanMutation,\n): Plan[] {\n  const deleteIds = new Set(mutation.planDeletes.map((plan) => plan.id));\n  return mutation.planUpserts.reduce(\n    (records, plan) => replaceById(records, plan),\n    current.filter(\n      (plan) => !(plan.userId === userId && deleteIds.has(plan.id)),\n    ),\n  );\n}\n\nfunction actualOccurrenceKey(actual: Actual): string | null {\n  return actual.planId\n    ? `${actual.planId}\\u0000${actual.occurrenceDate}`\n    : null;\n}\n\nfunction applyActualMutation(\n  current: Actual[],\n  userId: string,\n  mutation: RecurringPlanMutation,\n): Actual[] {\n  const planDeleteIds = new Set(mutation.planDeletes.map((plan) => plan.id));\n  const actualDeleteIds = new Set(mutation.actualDeletes.map((actual) => actual.id));\n  const actualDeleteOccurrences = new Set(\n    mutation.actualDeletes\n      .map(actualOccurrenceKey)\n      .filter((key): key is string => key !== null),\n  );\n  const reboundIds = new Set(mutation.actualUpserts.map((actual) => actual.id));\n  const remaining = current.filter((actual) => {\n    if (actual.userId !== userId || reboundIds.has(actual.id)) {\n      return true;\n    }\n\n    const occurrenceKey = actualOccurrenceKey(actual);\n    const matchesExplicitDelete =\n      actualDeleteIds.has(actual.id) ||\n      (occurrenceKey !== null && actualDeleteOccurrences.has(occurrenceKey));\n    const matchesDeletedPlan =\n      actual.planId !== null && planDeleteIds.has(actual.planId);\n    return !matchesExplicitDelete && !matchesDeletedPlan;\n  });\n  return mutation.actualUpserts.reduce(\n    (records, actual) => upsertActualRecord(records, actual),\n    remaining,\n  );\n}\n''',
)
replace_once(
    'src/repositories/plannerRepository.ts',
    '''      const nextPlans = applyPlanMutation(previousPlans, mutation);\n      const nextActuals = applyActualMutation(previousActuals, mutation);''',
    '''      const nextPlans = applyPlanMutation(previousPlans, userId, mutation);\n      const nextActuals = applyActualMutation(previousActuals, userId, mutation);''',
)

replace_once(
    'src/repositories/firebasePlannerRepository.ts',
    '''        const linkedActuals = (\n          await Promise.all(\n            mutation.planDeletes.map((plan) =>\n              listActualsByPlanId(firestoreDb, userId, plan.id),\n            ),\n          )\n        ).flat();\n        const actualDeletesById = new Map(\n          [...mutation.actualDeletes, ...linkedActuals]\n            .filter((actual) => !reboundIds.has(actual.id))\n            .map((actual) => [actual.id, actual]),\n        );''',
    '''        const [linkedActuals, duplicateOccurrenceActuals] = await Promise.all([\n          Promise.all(\n            mutation.planDeletes.map((plan) =>\n              listActualsByPlanId(firestoreDb, userId, plan.id),\n            ),\n          ).then((groups) => groups.flat()),\n          Promise.all(\n            mutation.actualDeletes.map((actual) =>\n              listActualsByPlanOccurrence(firestoreDb, actual),\n            ),\n          ).then((groups) => groups.flat()),\n        ]);\n        const actualDeletesById = new Map(\n          [\n            ...mutation.actualDeletes,\n            ...duplicateOccurrenceActuals,\n            ...linkedActuals,\n          ]\n            .filter((actual) => !reboundIds.has(actual.id))\n            .map((actual) => [actual.id, actual]),\n        );''',
)

repo_test = Path('src/repositories/recurringPlanMutationRepository.test.ts')
text = repo_test.read_text()
anchor = '''  it('preserves a rebound Actual when its old Plan is deleted in the same mutation', async () => {'''
addition = '''  it('removes every raw duplicate for an explicitly deleted occurrence', async () => {\n    const source = plan();\n    const visible = actual({ id: 'visible', occurrenceDate: '2026-09-03' });\n    const hiddenDuplicate = actual({ id: 'hidden', occurrenceDate: '2026-09-03' });\n    const otherOccurrence = actual({ id: 'other', occurrenceDate: '2026-09-04' });\n    const { state, gateway } = createGateway({\n      plans: [source],\n      actuals: [visible, hiddenDuplicate, otherOccurrence],\n    });\n    const repository = createPlannerRepository(gateway);\n\n    await repository.applyRecurringPlanMutation(\n      'user-1',\n      mutation({ actualDeletes: [visible] }),\n    );\n\n    expect(state.actuals).toEqual([otherOccurrence]);\n  });\n\n'''
if text.count(anchor) != 1:
    raise SystemExit('repository duplicate test anchor mismatch')
repo_test.write_text(text.replace(anchor, addition + anchor, 1))

firebase_test = Path('src/repositories/firebasePlannerRepository.recurringMutation.test.ts')
text = firebase_test.read_text()
anchor = '''  it('keeps a rebound Actual out of the old Plan cascade delete', async () => {'''
addition = '''  it('deletes all stored duplicates for an explicit occurrence delete', async () => {\n    const target = actual({ id: 'visible', occurrenceDate: '2026-09-03' });\n    mocks.getDocs.mockResolvedValue({\n      docs: [\n        { id: 'visible', data: () => ({ ...target }) },\n        { id: 'hidden', data: () => ({ ...target, id: undefined }) },\n      ],\n    });\n    const repository = createFirebasePlannerRepository({} as Firestore);\n\n    await repository.applyRecurringPlanMutation('user-1', {\n      planUpserts: [],\n      planDeletes: [],\n      actualUpserts: [],\n      actualDeletes: [target],\n    });\n\n    expect(mocks.batchDelete).toHaveBeenCalledTimes(2);\n    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);\n  });\n\n'''
if text.count(anchor) != 1:
    raise SystemExit('firebase duplicate test anchor mismatch')
firebase_test.write_text(text.replace(anchor, addition + anchor, 1))
