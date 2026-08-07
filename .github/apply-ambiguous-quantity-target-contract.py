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
    "    'Obvious spelling, kana/kanji, speech-input, or OCR noise may be interpreted without clarification only when one reading is clearly supported by current userText and conversation context; keep the original excerpt in sourceText. If two or more plausible readings would change task identity, the target of a quantity, or another planning fact, emit uncertainty and do not create or modify the guessed fact.',\n",
    "    'Obvious spelling, kana/kanji, speech-input, or OCR noise may be interpreted without clarification only when one reading is clearly supported by current userText and conversation context; keep the original excerpt in sourceText. If two or more plausible readings would change task identity, the target of a quantity, or another planning fact, emit uncertainty and do not create or modify the guessed fact.',\n    'A quantity, duration, date, recurrence, or other modifier must have a uniquely supported semantic target before it is attached to a fact. When the same modifier can grammatically apply to more than one independently schedulable candidate, emit uncertainty for the unresolved target and do not assign, duplicate, distribute, or attach it by proximity, list order, or convenience.',\n",
)

path = 'src/features/weeklyPlanning/__tests__/weeklyPlanningPromptGeneralizationV5.test.ts'
replace_once(
    path,
    "    expect(prompt).toContain('emit uncertainty and do not create or modify the guessed fact');\n",
    "    expect(prompt).toContain('emit uncertainty and do not create or modify the guessed fact');\n    expect(prompt).toContain('must have a uniquely supported semantic target');\n    expect(prompt).toContain('more than one independently schedulable candidate');\n    expect(prompt).toContain('do not assign, duplicate, distribute, or attach it by proximity');\n",
)
