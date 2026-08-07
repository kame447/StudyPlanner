from pathlib import Path
p=Path('src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.test.ts')
s=p.read_text()
old_message="予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。"
new_message="予定に入れる作業量がまだありません。まず一つ、どこまで進めたいか教えてください。"
if old_message not in s:
    raise SystemExit('old missing-work message not found')
s=s.replace(old_message,new_message)
old_block="""    expect(result.message).toContain('「午前：研究を進める」');
    expect(result.message).toContain('「午後：院試の勉強」');
    expect(result.message).toContain('それぞれどれくらい進めたいですか');
"""
new_block="""    expect(result.message).toContain('「午前：研究を進める」');
    expect(result.message).not.toContain('「午後：院試の勉強」');
    expect(result.message).toContain('どこまで進めたいですか');
    expect(result.message).not.toContain('それぞれ');
"""
if s.count(old_block)!=1:
    raise SystemExit(f'expected one multi-task assertion block, got {s.count(old_block)}')
s=s.replace(old_block,new_block,1)
p.write_text(s)
