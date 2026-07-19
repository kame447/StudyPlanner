from pathlib import Path

source_path = Path('scripts/pr68_stage2_fix.py')
exec(compile(source_path.read_text(), str(source_path), 'exec'))

test_path = Path('workers/ai-proxy/src/weeklyPlanningTraceStructuralIds.test.ts')
text = test_path.read_text()
old_entry = """      entries: [{
        id: `${SESSION_ID}-00000000`,
        sessionId: SESSION_ID,
        logicalConversationId: CONVERSATION_ID,
        entryCount: 1,
        userId: 'firebase-user-123',
      }],
"""
new_entry = """      entries: [{
        id: `${SESSION_ID}-00000000`,
        sessionId: SESSION_ID,
        logicalConversationId: CONVERSATION_ID,
        sequence: 0,
        userId: 'firebase-user-123',
      }],
"""
if old_entry not in text:
    raise RuntimeError('generated structural entry fixture was not found')
text = text.replace(old_entry, new_entry, 1)
old_assertion = """    expect(safeWeeklyPlanningTraceDocumentsForAdmin([{
      id: 'john-smith-09012345678',
      logicalConversationId: 'john-smith-09012345678',
    }])).toEqual([{}]);
"""
new_assertion = """    const redactedStructuralValues = safeWeeklyPlanningTraceDocumentsForAdmin([{
      id: 'john-smith-09012345678',
      logicalConversationId: 'john-smith-09012345678',
    }]);
    expect(JSON.stringify(redactedStructuralValues)).not.toContain('09012345678');
    expect(JSON.stringify(redactedStructuralValues)).toContain('[PHONE]');
"""
if old_assertion not in text:
    raise RuntimeError('generated structural redaction assertion was not found')
test_path.write_text(text.replace(old_assertion, new_assertion, 1))
