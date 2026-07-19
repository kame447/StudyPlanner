from pathlib import Path


target = Path('src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts')
text = target.read_text()
start = text.index('function escapeRegExp(value: string): string {')
end = text.index('function priorityHeadGrounded', start)
replacement = """function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
}

"""
target.write_text(text[:start] + replacement + text[end:])
