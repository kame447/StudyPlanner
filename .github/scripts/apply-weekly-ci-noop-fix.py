from pathlib import Path

# Preserve no-op turn idempotency while keeping semantic revision stable.
path = Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5.ts')
text = path.read_text()
old = """  return {\n    ...params.canonicalization,\n    graph: params.originalGraph,\n    diff: {\n      ...diff,\n      toRevision: params.originalGraph.revision,\n    },\n  };\n}"""
new = """  return {\n    ...params.canonicalization,\n    graph: {\n      ...params.originalGraph,\n      appliedTurnKeys: params.canonicalization.graph.appliedTurnKeys,\n    },\n    diff: {\n      ...diff,\n      toRevision: params.originalGraph.revision,\n    },\n  };\n}"""
assert old in text
path.write_text(text.replace(old, new, 1))

# Update no-op regression to require turn idempotency metadata.
path = Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5.test.ts')
text = path.read_text()
old = """    expect(second.graph).toBe(first.graph);\n    expect(second.graph.revision).toBe(first.graph.revision);\n"""
new = """    expect(second.graph).not.toBe(first.graph);\n    expect(second.graph.revision).toBe(first.graph.revision);\n    expect(second.graph.tasks).toEqual(first.graph.tasks);\n    expect(second.graph.workloads).toEqual(first.graph.workloads);\n    expect(second.graph.appliedTurnKeys).toContain('conversation-noop:turn-noop');\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

# Creation authorization is a fact no-op: keep revision, record turn.
path = Path('src/features/weeklyPlanning/semantic/weeklyPlanningStableV5MultiTurnPipeline.test.ts')
text = path.read_text()
old = """    expect(third.status).toBe('scheduler_ready');\n    expect(third.graph.revision).toBe(3);\n    expect(third.graph.tasks).toHaveLength(1);\n"""
new = """    expect(third.status).toBe('scheduler_ready');\n    expect(third.graph.revision).toBe(second.graph.revision);\n    expect(third.graph.appliedTurnKeys).toContain('conversation-1:turn-3');\n    expect(third.graph.tasks).toHaveLength(1);\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

# An incompatible contextual answer that applies no fact should not consume a fact revision,
# but it must remain idempotent as an applied turn.
path = Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5ExplicitRepair.test.ts')
text = path.read_text()
old = """    expect(wrong.status).toBe('scheduler_needs_resolution');\n    expect(wrong.graph.revision).toBe(first.graph.revision + 1);\n    expect(wrong.graph.appliedTurnKeys).toContain(\n"""
new = """    expect(wrong.status).toBe('scheduler_needs_resolution');\n    expect(wrong.graph.revision).toBe(first.graph.revision);\n    expect(wrong.graph.appliedTurnKeys).toContain(\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

# Ground fixtures in the current utterance without changing the behavior under test.
path = Path('src/features/weeklyPlanning/semantic/weeklyPlanningDuplicateWorkloadNormalizationV5.test.ts')
text = path.read_text()
old = """      userText: '分野1を2時間進めます',\n"""
new = """      userText: '学習として分野1を2時間進めます',\n"""
assert old in text
path.write_text(text.replace(old, new, 1))

path = Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5Coverage.test.ts')
text = path.read_text()
old = """      sourceText: `${title}${amount}`,\n"""
new = """      sourceText: `${title}を${amount}`,\n"""
assert text.count(old) == 2
path.write_text(text.replace(old, new))

path = Path('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5TaskBoundary.test.ts')
text = path.read_text()
old = """      sourceText: '物理と化学',\n"""
new = """      sourceText: '物理',\n"""
assert old in text
path.write_text(text.replace(old, new, 1))
