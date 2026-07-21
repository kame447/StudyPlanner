import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before);
  if (first < 0) throw new Error(`Missing replacement anchor: ${label}`);
  if (content.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Replacement anchor is not unique: ${label}`);
  }
  return content.slice(0, first) + after + content.slice(first + before.length);
}

function replaceBetween(content, startMarker, endMarker, replacement, label) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`Missing range anchor: ${label}`);
  return content.slice(0, start) + replacement + content.slice(end);
}

const interpreterPath = 'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts';
let interpreter = read(interpreterPath);
interpreter = replaceOnce(
  interpreter,
  `function emptyInterpreterResult(): WeeklyPlanningInterpreterResult {\n  return { candidates: [], parseRejections: [] };\n}`,
  `function emptyInterpreterResult(rawResponse?: string): WeeklyPlanningInterpreterResult {\n  return {\n    candidates: [],\n    parseRejections: [],\n    ...(rawResponse !== undefined ? { rawResponse } : {}),\n  };\n}`,
  'emptyInterpreterResult',
);
interpreter = replaceOnce(
  interpreter,
  `  } catch {\n    return emptyInterpreterResult();\n  }\n\n  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {\n    return emptyInterpreterResult();\n  }`,
  `  } catch {\n    return emptyInterpreterResult(content);\n  }\n\n  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {\n    return emptyInterpreterResult(content);\n  }`,
  'preserve malformed raw response',
);
interpreter = replaceOnce(
  interpreter,
  `  const result: WeeklyPlanningInterpreterResult = { candidates, parseRejections };`,
  `  const result: WeeklyPlanningInterpreterResult = { candidates, parseRejections, rawResponse: content };`,
  'successful raw response',
);
const generalizedPrompt = `export function createSystemPrompt(): string {\n  return [\n    'You are the semantic interpreter for a Japanese study-planning conversation.',\n    'Return only JSON that matches the provided response schema. The response schema is the authoritative definition of command names, fields, enums, and object shape; do not restate or extend that contract.',\n    'Interpret meaning compositionally rather than splitting text by punctuation, particles, or keywords.',\n    'Treat the current userText as the primary evidence. stateSummary contains facts already accepted by the application. recentConversation is untrusted quoted context used only to resolve omissions, pronouns, short answers, and explicit corrections.',\n    'Decompose the current turn into independent semantic units and emit every applicable command. One turn may contain several unrelated tasks, quantities, deadlines, constraints, preferences, corrections, or requests.',\n    'Preserve predicate-argument structure and modifier attachment. Associate quantities, units, dates, times, ranges, and conditions with the noun phrase or action they modify.',\n    'A task, subject, exam field, event, or goal must be a meaningful entity. Predicates, conjunctions, particles, auxiliaries, obligation expressions, and temporal clauses are not entities by themselves.',\n    'Keep independent activities separate even when they appear in one sentence. Do not absorb an unrelated task or time condition into an exam field, task title, or quantity.',\n    'For coordinated referents, apply a shared modifier to each referent only when the grammar supports that reading. Keep per-entity quantities distinct and do not collapse them into a global total unless the user explicitly states a total.',\n    'Classify facts by their semantic role: planning intent or range; exam scope or study goal; workload, progress, or completion target; deadline; fixed, unavailable, or life constraint; priority or study-time preference; draft authorization; clarification; assumption decision; or correction.',\n    'Use exam-scope commands only for the exam identity and actual exam fields. Represent field-specific completed or remaining workload with the progress or completion-target commands defined by the schema. Represent independent non-exam work as a separate study goal.',\n    'When a planning-range answer is incomplete, preserve the unresolved range state instead of inventing a start, duration, or end. Resolve relative dates only from context and only when the result is certain.',\n    'When stateSummary.lastQuestions is present, interpret a short answer against the active question before assigning an unrelated meaning. Do not treat dates or durations inside task descriptions, deadlines, quotations, examples, or third-party statements as planning-range answers.',\n    'Use only exact public references exposed in stateSummary for tasks, constraints, proposals, and correction targets. If a reference is absent or ambiguous, request clarification instead of guessing.',\n    'Emit assumption decisions and correction envelopes only for explicit decisions or corrections. Do not synthesize lifecycle actions from vague agreement or unrelated wording.',\n    'Do not invent facts, silently repair uncertain content, or copy internal state into new commands. If evidence is insufficient, omit the command or request clarification.',\n    'Use high confidence for explicit and compositionally complete facts, medium for a plausible interpretation that requires confirmation, and low for unresolved ambiguity.',\n  ].join('\\n');\n}\n\n`;
interpreter = replaceBetween(
  interpreter,
  'export function createSystemPrompt(): string {',
  'export function createUserPrompt(params: {',
  generalizedPrompt,
  'createSystemPrompt',
);
write(interpreterPath, interpreter);

const typesPath = 'src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts';
let types = read(typesPath);
types = replaceOnce(
  types,
  `  correctionEnvelopes?: unknown[];\n}`,
  `  correctionEnvelopes?: unknown[];\n  /** Raw provider content before parsing. Kept for redacted diagnostic trace. */\n  rawResponse?: string;\n}`,
  'interpreter raw response type',
);
write(typesPath, types);

const pipelinePath = 'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts';
let pipeline = read(pipelinePath);
pipeline = replaceOnce(
  pipeline,
  `export interface WeeklyPlanningAssumptionProposalDiagnostics {\n  accepted: PendingAssumptionProposal[];\n  rejected: Array<{ draft: unknown; reason: string }>;\n}\n\nexport interface WeeklyPlanningIntakePipelineOutput {`,
  `export interface WeeklyPlanningAssumptionProposalDiagnostics {\n  accepted: PendingAssumptionProposal[];\n  rejected: Array<{ draft: unknown; reason: string }>;\n}\n\nexport interface WeeklyPlanningInterpreterFailure {\n  category: 'provider_error';\n  name: string;\n  message: string;\n}\n\nexport interface WeeklyPlanningIntakePipelineOutput {`,
  'interpreter failure interface',
);
pipeline = replaceOnce(
  pipeline,
  `  interpreterDiagnostics?: CandidateValidationResult;\n  assumptionProposalState?: AssumptionProposalSessionState;`,
  `  interpreterDiagnostics?: CandidateValidationResult;\n  interpreterRawResponse?: string;\n  interpreterFailure?: WeeklyPlanningInterpreterFailure;\n  assumptionProposalState?: AssumptionProposalSessionState;`,
  'pipeline output observability fields',
);
pipeline = replaceOnce(
  pipeline,
  `  interpreterDiagnostics?: CandidateValidationResult;\n  assumptionProposalState?: AssumptionProposalSessionState;`,
  `  interpreterDiagnostics?: CandidateValidationResult;\n  interpreterRawResponse?: string;\n  interpreterFailure?: WeeklyPlanningInterpreterFailure;\n  assumptionProposalState?: AssumptionProposalSessionState;`,
  'build output observability params',
);
pipeline = replaceOnce(
  pipeline,
  `  if (params.interpreterDiagnostics) {\n    output.interpreterDiagnostics = params.interpreterDiagnostics;\n  }\n\n  if (params.assumptionProposalState) {`,
  `  if (params.interpreterDiagnostics) {\n    output.interpreterDiagnostics = params.interpreterDiagnostics;\n  }\n  if (params.interpreterRawResponse !== undefined) {\n    output.interpreterRawResponse = params.interpreterRawResponse;\n  }\n  if (params.interpreterFailure) {\n    output.interpreterFailure = params.interpreterFailure;\n  }\n\n  if (params.assumptionProposalState) {`,
  'copy observability output fields',
);
pipeline = replaceOnce(
  pipeline,
  `function deterministicClarificationRequest(\n  input: WeeklyPlanningIntakePipelineInput,`,
  `function toInterpreterFailure(error: unknown): WeeklyPlanningInterpreterFailure {\n  const name = error instanceof Error && error.name.trim() ? error.name.trim() : 'Error';\n  const message = error instanceof Error && error.message.trim()\n    ? error.message.trim()\n    : 'Unknown interpreter provider failure.';\n  return {\n    category: 'provider_error',\n    name: name.slice(0, 120),\n    message: message.slice(0, 500),\n  };\n}\n\nfunction deterministicClarificationRequest(\n  input: WeeklyPlanningIntakePipelineInput,`,
  'interpreter failure normalization',
);
pipeline = replaceOnce(
  pipeline,
  `  } catch {\n    const deterministicClarification = deterministicClarificationRequest(input, previousState);`,
  `  } catch (error) {\n    const deterministicClarification = deterministicClarificationRequest(input, previousState);`,
  'catch interpreter error',
);
pipeline = replaceOnce(
  pipeline,
  `      state: fallbackTurn.state,\n      assumptionProposalState: proposalState,`,
  `      state: fallbackTurn.state,\n      interpreterFailure: toInterpreterFailure(error),\n      assumptionProposalState: proposalState,`,
  'attach fallback reason',
);
pipeline = replaceOnce(
  pipeline,
  `    state: interpretedState,\n    interpreterDiagnostics,\n    assumptionProposalState: proposalResult?.state ?? proposalState,`,
  `    state: interpretedState,\n    interpreterDiagnostics,\n    interpreterRawResponse: interpreterResult.rawResponse,\n    assumptionProposalState: proposalResult?.state ?? proposalState,`,
  'attach raw interpreter response',
);
write(pipelinePath, pipeline);

const tracePath = 'src/features/weeklyPlanning/trace/weeklyPlanningTraceRuntime.ts';
let trace = read(tracePath);
const oldTraceBlock = `  const diagnostics = output.interpreterDiagnostics;\n  if (diagnostics) {\n    entries.push(eventEntry(active, {\n      eventType: 'interpreter_started',\n      payload: { previousStateRevision: Math.max(0, stateRevision - 1) },\n      requestId,\n      stateRevision: Math.max(0, stateRevision - 1),\n      occurredAt,\n      severity: 'debug',\n    }));\n    entries.push(eventEntry(active, {\n      eventType: 'interpreter_completed',\n      payload: {\n        acceptedCount: diagnostics.accepted.length,\n        acceptedWithConfirmationCount: diagnostics.acceptedWithConfirmation.length,\n        rejectedCount: diagnostics.rejected.length,\n        clarificationRequestCount: diagnostics.clarificationRequests.length,\n        parseRejections: diagnostics.parseRejections,\n      },\n      requestId,\n      stateRevision,\n      occurredAt,\n    }));\n    diagnostics.accepted.forEach((command) => entries.push(eventEntry(active, {\n      eventType: 'candidate_accepted',\n      payload: command,\n      requestId,\n      stateRevision,\n      occurredAt,\n    })));\n    diagnostics.rejected.forEach((rejection) => entries.push(eventEntry(active, {\n      eventType: 'candidate_rejected',\n      payload: rejection,\n      requestId,\n      stateRevision,\n      occurredAt,\n      severity: 'warn',\n    })));\n  }`;
const newTraceBlock = `  const diagnostics = output.interpreterDiagnostics;\n  const interpreterFailure = output.interpreterFailure;\n  if (diagnostics || interpreterFailure) {\n    entries.push(eventEntry(active, {\n      eventType: 'interpreter_started',\n      payload: { previousStateRevision: Math.max(0, stateRevision - 1) },\n      requestId,\n      stateRevision: Math.max(0, stateRevision - 1),\n      occurredAt,\n      severity: 'debug',\n    }));\n  }\n  if (diagnostics) {\n    entries.push(eventEntry(active, {\n      eventType: 'interpreter_completed',\n      payload: {\n        status: 'completed',\n        acceptedCount: diagnostics.accepted.length,\n        acceptedWithConfirmationCount: diagnostics.acceptedWithConfirmation.length,\n        rejectedCount: diagnostics.rejected.length,\n        clarificationRequestCount: diagnostics.clarificationRequests.length,\n        parseRejections: diagnostics.parseRejections,\n        ...(output.interpreterRawResponse !== undefined\n          ? { rawResponse: output.interpreterRawResponse }\n          : {}),\n      },\n      requestId,\n      stateRevision,\n      occurredAt,\n    }));\n    diagnostics.accepted.forEach((command) => entries.push(eventEntry(active, {\n      eventType: 'candidate_accepted',\n      payload: command,\n      requestId,\n      stateRevision,\n      occurredAt,\n    })));\n    diagnostics.rejected.forEach((rejection) => entries.push(eventEntry(active, {\n      eventType: 'candidate_rejected',\n      payload: rejection,\n      requestId,\n      stateRevision,\n      occurredAt,\n      severity: 'warn',\n    })));\n  }\n  if (interpreterFailure) {\n    active.session.hasFallback = true;\n    entries.push(eventEntry(active, {\n      eventType: 'interpreter_completed',\n      payload: { status: 'failed', failure: interpreterFailure },\n      requestId,\n      stateRevision,\n      occurredAt,\n      severity: 'warn',\n    }));\n    entries.push(eventEntry(active, {\n      eventType: 'fallback_used',\n      payload: { category: 'interpreter_failure', failure: interpreterFailure },\n      requestId,\n      stateRevision,\n      occurredAt,\n      severity: 'warn',\n    }));\n  }`;
trace = replaceOnce(trace, oldTraceBlock, newTraceBlock, 'interpreter trace observability');
write(tracePath, trace);

write('src/features/weeklyPlanning/intake/weeklyPlanningAiPromptContract.test.ts', `import { describe, expect, it } from 'vitest';\nimport { createSystemPrompt, WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT } from './weeklyPlanningAiInterpreter';\n\ndescribe('weekly planning AI prompt contract', () => {\n  it('uses generalized semantic principles and stays below the Worker message limit', () => {\n    const prompt = createSystemPrompt();\n\n    expect(prompt.length).toBeLessThan(6_000);\n    expect(prompt).toContain('Decompose the current turn into independent semantic units');\n    expect(prompt).toContain('Preserve predicate-argument structure and modifier attachment');\n    expect(prompt).toContain('The response schema is the authoritative definition');\n    expect(prompt).not.toContain('OSとネットワーク');\n    expect(prompt).not.toContain('ヒューマンサイエンス');\n    expect(prompt).not.toContain('バイトの後');\n    expect(prompt).not.toContain('固定の予定って何ですか');\n  });\n\n  it('keeps command shape and vocabulary in the response schema rather than the prompt', () => {\n    const schemaText = JSON.stringify(WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT);\n    expect(schemaText).toContain('set_exam_scope');\n    expect(schemaText).toContain('mark_completion_target');\n    expect(schemaText).toContain('set_study_goal');\n    expect(createSystemPrompt()).not.toContain('Command types you may emit');\n  });\n});\n`);

write('src/features/weeklyPlanning/intake/weeklyPlanningAiRawResponse.test.ts', `import { describe, expect, it, vi } from 'vitest';\nimport type { AiConfig } from '../../../lib/aiConfig';\nimport type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';\nimport { createAiWeeklyPlanningInterpreter } from './weeklyPlanningAiInterpreter';\n\nconst config: AiConfig = {\n  provider: 'openai',\n  baseUrl: 'https://example.test/v1',\n  model: 'gpt-5.4-nano-2026-03-17',\n  apiKey: 'test-key',\n};\n\nfunction params() {\n  return {\n    userText: '研究と院試の予定を立てたい',\n    context: { selectedDate: '2026-07-21', planningDayCount: 7 },\n    stateSummary: { knownFields: [], confirmedSlots: [] },\n  } as const;\n}\n\ndescribe('weekly planning AI raw response observability', () => {\n  it('preserves the exact valid provider response for trace diagnostics', async () => {\n    const raw = JSON.stringify({ candidates: [] });\n    const client: OpenAiCompatibleClient = {\n      createChatCompletion: vi.fn(async () => raw),\n    };\n\n    const result = await createAiWeeklyPlanningInterpreter(config, client).interpretUserTurn(params());\n\n    expect(result.rawResponse).toBe(raw);\n    expect(result.candidates).toEqual([]);\n  });\n\n  it('preserves malformed provider content even when parsing fails closed', async () => {\n    const raw = 'not-json';\n    const client: OpenAiCompatibleClient = {\n      createChatCompletion: vi.fn(async () => raw),\n    };\n\n    const result = await createAiWeeklyPlanningInterpreter(config, client).interpretUserTurn(params());\n\n    expect(result.rawResponse).toBe(raw);\n    expect(result.candidates).toEqual([]);\n  });\n});\n`);

write('src/features/weeklyPlanning/trace/weeklyPlanningInterpreterTraceObservability.test.ts', `import { afterEach, beforeEach, describe, expect, it } from 'vitest';\nimport {\n  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,\n  type BehaviorAwareDialoguePlanner,\n} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';\nimport type { WeeklyPlanningIntakeInterpreter } from '../intake/weeklyPlanningInterpreterTypes';\nimport { createInMemoryWeeklyPlanningTraceRepository } from './weeklyPlanningTraceInMemoryRepository';\nimport { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';\nimport { resetWeeklyPlanningTraceRuntimeForTests } from './weeklyPlanningTraceRuntime';\n\nconst dialoguePlanner: BehaviorAwareDialoguePlanner = {\n  async plan() {\n    return { message: '確認します。', response: null, source: 'ai' };\n  },\n};\n\nfunction input(interpreter: WeeklyPlanningIntakeInterpreter) {\n  return {\n    userText: '今日の予定を立てたいです',\n    planningStartDate: '2026-07-21',\n    planningDayCount: 7,\n    currentDateTime: '2026-07-21T23:24:00',\n    existingPlans: [],\n    scheduleTemplates: [],\n    interpreter,\n  };\n}\n\nasync function waitForTrace(assertion: () => Promise<void>, maxAttempts = 30): Promise<void> {\n  let lastError: unknown;\n  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {\n    try {\n      await assertion();\n      return;\n    } catch (error) {\n      lastError = error;\n      await new Promise((resolve) => setTimeout(resolve, 0));\n    }\n  }\n  throw lastError;\n}\n\ndescribe('weekly planning interpreter trace observability', () => {\n  beforeEach(() => resetWeeklyPlanningTraceRuntimeForTests());\n  afterEach(() => {\n    resetWeeklyPlanningTraceRuntimeForTests();\n    setWeeklyPlanningTraceRepositoryForTests(undefined);\n  });\n\n  it('records the redaction-boundary raw provider response with interpreter completion', async () => {\n    const repository = createInMemoryWeeklyPlanningTraceRepository();\n    setWeeklyPlanningTraceRepositoryForTests(repository);\n    const rawResponse = JSON.stringify({ candidates: [] });\n\n    await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(input({\n      async interpretUserTurn() {\n        return { candidates: [], parseRejections: [], rawResponse };\n      },\n    }), { userId: 'user-1', conversationId: 'conversation-raw', dialoguePlanner });\n\n    await waitForTrace(async () => {\n      const [session] = await repository.listSessionsForAdmin();\n      const entries = await repository.listEntries('user-1', session!.id);\n      expect(entries).toEqual(expect.arrayContaining([\n        expect.objectContaining({\n          kind: 'internal_event',\n          eventType: 'interpreter_completed',\n          payload: expect.objectContaining({ status: 'completed', rawResponse }),\n        }),\n      ]));\n    });\n  });\n\n  it('records the provider failure reason when rules fallback is used', async () => {\n    const repository = createInMemoryWeeklyPlanningTraceRepository();\n    setWeeklyPlanningTraceRepositoryForTests(repository);\n\n    await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(input({\n      async interpretUserTurn() {\n        throw new Error('A message was too long.');\n      },\n    }), { userId: 'user-1', conversationId: 'conversation-fallback', dialoguePlanner });\n\n    await waitForTrace(async () => {\n      const [session] = await repository.listSessionsForAdmin();\n      expect(session?.hasFallback).toBe(true);\n      const entries = await repository.listEntries('user-1', session!.id);\n      expect(entries).toEqual(expect.arrayContaining([\n        expect.objectContaining({\n          kind: 'internal_event',\n          eventType: 'fallback_used',\n          payload: expect.objectContaining({\n            category: 'interpreter_failure',\n            failure: expect.objectContaining({\n              category: 'provider_error',\n              message: 'A message was too long.',\n            }),\n          }),\n        }),\n      ]));\n    });\n  });\n});\n`);

write('src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.observed-real-eval.test.ts', `import { describe, expect, it } from 'vitest';\nimport type { AiConfig } from '../../../lib/aiConfig';\nimport { getCloudflareAiProxyUrl } from '../../../lib/aiConfig';\nimport type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';\nimport { createAiWeeklyPlanningInterpreter } from '../intake/weeklyPlanningAiInterpreter';\n\nconst shouldRun = process.env.WEEKLY_PLANNING_REAL_AI_EVAL === '1';\nconst observedUserText = [\n  '院試の過去問終わらせたいです',\n  'OSとネットワークが一年分で、ヒューマンサイエンスが二年分あります',\n  'あと研究の進捗生まないといけないので、3時ぐらいまでは研究の内容やらないといけないです',\n].join('\\n');\n\nfunction proxyClient(proxyUrl: string, idToken: string, model: string): OpenAiCompatibleClient {\n  return {\n    async createChatCompletion({ messages, temperature = 0.1, responseFormat }) {\n      const endpoint = proxyUrl.endsWith('/chat/completions')\n        ? proxyUrl\n        : \\`\${proxyUrl.replace(/\\/$/, '')}/chat/completions\\`;\n      const response = await fetch(endpoint, {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json', Authorization: \\`Bearer \${idToken}\\` },\n        body: JSON.stringify({ model, temperature, messages, response_format: responseFormat }),\n      });\n      const body = await response.json() as { content?: string; error?: string };\n      if (!response.ok || !body.content?.trim()) {\n        throw new Error(body.error || \\`AI proxy request failed with status \${response.status}.\\`);\n      }\n      return body.content.trim();\n    },\n  };\n}\n\ndescribe.skipIf(!shouldRun)('weekly planning observed semantic segmentation real evaluation', () => {\n  it('keeps exam fields, per-field workload, and research as separate meanings', async () => {\n    const proxyUrl = process.env.WEEKLY_PLANNING_REAL_AI_EVAL_PROXY_URL?.trim() || getCloudflareAiProxyUrl();\n    const idToken = process.env.WEEKLY_PLANNING_REAL_AI_EVAL_ID_TOKEN?.trim();\n    const model = process.env.WEEKLY_PLANNING_REAL_AI_EVAL_MODEL?.trim() || 'gpt-5.4-nano-2026-03-17';\n    if (!proxyUrl || !idToken) {\n      console.info('[weekly-planning-observed-real-eval] skipped: missing proxy URL or ID token');\n      expect(true).toBe(true);\n      return;\n    }\n    const config: AiConfig = { provider: 'openai', baseUrl: '', model, apiKey: '' };\n    const result = await createAiWeeklyPlanningInterpreter(\n      config,\n      proxyClient(proxyUrl, idToken, model),\n    ).interpretUserTurn({\n      userText: observedUserText,\n      context: {\n        selectedDate: '2026-07-21',\n        planningDayCount: 7,\n        currentDateTime: '2026-07-21T23:24:00',\n      },\n      stateSummary: {\n        knownFields: [],\n        confirmedSlots: ['planning_range'],\n        planningRangeSummary: '2026-07-21T23:24:00〜2026-07-21T24:00:00',\n        lastQuestions: [{ slotKey: 'tasks_or_goals', intent: 'ask_tasks_or_goals' }],\n      },\n    });\n    const commands = result.candidates.map((candidate) => candidate.command);\n    const examScope = commands.find((command) => command.type === 'set_exam_scope');\n    expect(examScope?.type).toBe('set_exam_scope');\n    if (examScope?.type !== 'set_exam_scope') return;\n    expect(examScope.scope.fields).toEqual(['OS', 'ネットワーク', 'ヒューマンサイエンス']);\n\n    const targets = new Map(commands.flatMap((command) =>\n      command.type === 'mark_completion_target' && command.target.kind === 'latest_n_years'\n        ? [[command.field, command.target.count] as const]\n        : [],\n    ));\n    expect(targets.get('OS')).toBe(1);\n    expect(targets.get('ネットワーク')).toBe(1);\n    expect(targets.get('ヒューマンサイエンス')).toBe(2);\n    expect(commands.some((command) =>\n      command.type === 'set_study_goal' && /研究/.test(command.goal.title),\n    )).toBe(true);\n    expect(examScope.scope.fields.some((field) =>\n      /終わらせたい|研究|いけない|3時/.test(field),\n    )).toBe(false);\n\n    console.info('[weekly-planning-observed-real-eval]', JSON.stringify({\n      model,\n      input: observedUserText,\n      rawResponse: result.rawResponse,\n      commands,\n    }, null, 2));\n  }, 120000);\n});\n`);

console.log('Applied weekly planning interpreter generalization and observability changes.');
