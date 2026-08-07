from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, got {count}: {old[:180]}')
    p.write_text(text.replace(old, new, 1))


path = 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts'
replace_once(
    path,
    "    'A quantity, duration, date, recurrence, or other modifier must have a uniquely supported semantic target before it is attached to a fact. When the same modifier can grammatically apply to more than one independently schedulable candidate, emit uncertainty for the unresolved target and do not assign, duplicate, distribute, or attach it by proximity, list order, or convenience.',\n",
    "    'A quantity, duration, date, recurrence, or other modifier must have a uniquely supported semantic target before it is attached to a fact. When the same modifier can grammatically apply to more than one independently schedulable candidate, emit uncertainty for the unresolved target and do not assign, duplicate, distribute, or attach it by proximity, list order, or convenience.',\n    'Scope rule: after two or more coordinated or listed candidate tasks/components have been introduced, a following standalone modifier phrase or sentence with no explicit target remains unresolved across those candidates. In that structure you MUST emit uncertainty for modifier_target and MUST NOT attach the modifier to the first, last, nearest, or otherwise preferred candidate. Only an explicit grammatical link or unambiguous conversation context may resolve it.',\n",
)

path = 'src/features/weeklyPlanning/__tests__/weeklyPlanningPromptGeneralizationV5.test.ts'
replace_once(
    path,
    "    expect(prompt).toContain('do not assign, duplicate, distribute, or attach it by proximity');\n",
    "    expect(prompt).toContain('do not assign, duplicate, distribute, or attach it by proximity');\n    expect(prompt).toContain('after two or more coordinated or listed candidate tasks/components');\n    expect(prompt).toContain('following standalone modifier phrase or sentence with no explicit target');\n    expect(prompt).toContain('MUST emit uncertainty for modifier_target');\n",
)
