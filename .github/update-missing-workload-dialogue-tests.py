from pathlib import Path
p=Path('src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.test.ts')
s=p.read_text()
repls={
"'予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。'":"'予定に入れる作業量がまだありません。まず一つ、どこまで進めたいか教えてください。'",
"    expect(result.message).toContain('「午前：研究を進める」');\n    expect(result.message).toContain('「午後：院試の勉強」');\n    expect(result.message).toContain('それぞれどれくらい進めたいですか');":"    expect(result.message).toContain('「午前：研究を進める」');\n    expect(result.message).not.toContain('「午後：院試の勉強」');\n    expect(result.message).toContain('どこまで進めたいですか');\n    expect(result.message).not.toContain('それぞれ');",
"      '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。',":"      '予定に入れる作業量がまだありません。まず一つ、どこまで進めたいか教えてください。',",
}
for old,new in repls.items():
    c=s.count(old)
    if c<1: raise SystemExit(f'missing expected fragment: {old[:80]}')
    s=s.replace(old,new)
p.write_text(s)
