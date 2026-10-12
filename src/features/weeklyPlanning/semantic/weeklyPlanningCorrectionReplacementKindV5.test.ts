import { describe, expect, it } from 'vitest';
import { validateWeeklyPlanningCorrectionReplacementKindsV5 } from './weeklyPlanningCorrectionReferenceValidationV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { createWeeklyPlanningSemanticRepairMessagesV5 } from './weeklyPlanningSemanticRepairPromptV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

// Live B T4 on dc38e978 (「青チャートのこと」): a correct new material component, also sent as the
// replacement of its task. The canonical owner rejected the kind mismatch after validation.
function liveB4(withCorrection: boolean): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [{
      localId: 'task-existing', existingPublicId: 'wpf_task_math', decompositionStatus: 'decomposed', category: 'study',
      title: '数学の問題集を進める',
      study: { purpose: 'practice', activityKind: 'problem_solving', contextLabel: null, components: [{
        localId: 'component-blue-chart', existingPublicId: null, parentLocalId: 'task-existing', role: 'material',
        label: '青チャート 数学III', workloads: [], durableContextSignals: [], sourceText: '青チャートのこと',
      }] },
      workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
      sourceText: '青チャートのこと',
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], conversationActs: [],
    uncertainties: [], decisions: [],
    corrections: withCorrection ? [{
      localId: 'correction-material', target: { kind: 'task', publicId: 'wpf_task_math', localId: null, mention: '数学の問題集' },
      operation: 'replace', replacementLocalId: 'component-blue-chart', sourceText: '青チャートのこと',
    }] : [],
  } as WeeklyPlanningSemanticDocumentV5;
}

describe('correction replacement kind (interaction validation, live B on dc38e978)', () => {
  it('reports a task replaced by a component before canonicalization, so the one repair can drop it', () => {
    expect(validateWeeklyPlanningCorrectionReplacementKindsV5(liveB4(true)))
      .toEqual(['document.corrections[0].replacementLocalId:kind-mismatch:task:component']);
    expect(validateWeeklyPlanningCorrectionReplacementKindsV5(liveB4(false))).toEqual([]);
  });

  it('accepts same-kind replacements, temporal kinds and replacements it cannot see', () => {
    const document = liveB4(true);
    document.corrections[0] = { ...document.corrections[0], target: { kind: 'component', publicId: 'wpf_component_book', localId: null, mention: null } };
    expect(validateWeeklyPlanningCorrectionReplacementKindsV5(document)).toEqual([]);
    document.tasks[0].temporalConstraints = [{ localId: 'deadline', targetLocalId: 'task-existing', kind: 'deadline', constraintLevel: 'hard',
      dateExpression: '2026-10-16', namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact', sourceText: '青チャートのこと' }];
    document.corrections[0] = { ...document.corrections[0], target: { kind: 'temporal_constraint', publicId: 'wpf_temporal_old', localId: null, mention: null }, replacementLocalId: 'deadline' };
    expect(validateWeeklyPlanningCorrectionReplacementKindsV5(document)).toEqual([]);
    document.corrections[0] = { ...document.corrections[0], replacementLocalId: 'not-declared' };
    expect(validateWeeklyPlanningCorrectionReplacementKindsV5(document)).toEqual([]);
  });

  // Single current contract; no legacy architecture selector is introduced.
  it('tells the repair to keep the new component without a correction', () => {
    const directive = () => {
      const messages = createWeeklyPlanningSemanticRepairMessagesV5({
        baseMessages: [{ role: 'system', content: 'normalize' }], invalidResponse: '{}',
        validationErrors: ['document.corrections[0].replacementLocalId:kind-mismatch:task:component'],
      });
      return (JSON.parse(messages[messages.length - 1].content) as { requiredChanges: string[] }).requiredChanges.join('\n');
    };
    expect(directive()).toContain('without any correction');
  });
});

// Actual first completeness reread from run38175475592. Its cross-kind replace is
// rejected earlier; the model's effort is never fabricated or silently rewritten.
const actualRereadRaw = "{\"schemaVersion\":\"weekly-planning-semantic-v5\",\"planningIntent\":\"update_plan\",\"planningWindow\":null,\"tasks\":[{\"localId\":\"task_math\",\"existingPublicId\":\"wpf_task_3ulz2o1jax3jg\",\"decompositionStatus\":\"atomic\",\"category\":\"study\",\"title\":\"数学の教材\",\"study\":null,\"workloads\":[],\"effortEstimates\":[{\"localId\":\"effort_math_12pages\",\"targetLocalId\":\"wpf_workload_ywgn9veiafvb\",\"kind\":\"total_duration\",\"minutes\":30,\"unitCode\":\"page\",\"precision\":\"exact\",\"sourceText\":\"30分は問題数ではなく、数学12ページ全部を解くのにかかる合計時間です\"}],\"temporalConstraints\":[],\"recurrence\":[],\"durableContextSignals\":[],\"sourceText\":\"30分は問題数ではなく、数学12ページ全部を解くのにかかる合計時間です\"}],\"relations\":[],\"availabilityDeclarations\":[],\"constraintSourceRequests\":[],\"userContextFacts\":[],\"conversationActs\":[{\"kind\":\"answer_pending_question\",\"targetPublicId\":\"wpf_workload_1x13su81czs2s4\"}],\"uncertainties\":[],\"corrections\":[{\"localId\":\"correction_math_30min\",\"target\":{\"kind\":\"workload\",\"publicId\":\"wpf_workload_1x13su81czs2s4\",\"localId\":null,\"mention\":\"30分\"},\"operation\":\"replace\",\"replacementLocalId\":\"effort_math_12pages\",\"sourceText\":\"30分は問題数ではなく、数学12ページ全部を解くのにかかる合計時間です\"}],\"decisions\":[]}";
const currentUserText = "30分は問題数ではなく、数学12ページ全部を解くのにかかる合計時間です";
const currentSummary = {
  "tasks": [
    {
      "publicId": "wpf_task_3ulz2o1jax3jg",
      "category": "study",
      "title": "数学の教材"
    },
    {
      "publicId": "wpf_task_9xqwc677bz6q",
      "category": "study",
      "title": "英語の教材"
    }
  ],
  "workloads": [
    {
      "publicId": "wpf_workload_ywgn9veiafvb",
      "taskPublicId": "wpf_task_3ulz2o1jax3jg",
      "componentPublicId": null,
      "quantityRole": "target",
      "amount": 12,
      "unitCode": "page",
      "unitLabel": "ページ",
      "rangeStart": null,
      "rangeEnd": null,
      "perOccurrence": false,
      "periodExpression": null
    },
    {
      "publicId": "wpf_workload_1imgan61ykai32",
      "taskPublicId": "wpf_task_9xqwc677bz6q",
      "componentPublicId": null,
      "quantityRole": "target",
      "amount": 9,
      "unitCode": "page",
      "unitLabel": "ページ",
      "rangeStart": null,
      "rangeEnd": null,
      "perOccurrence": false,
      "periodExpression": null
    },
    {
      "publicId": "wpf_workload_1x13su81czs2s4",
      "taskPublicId": "wpf_task_3ulz2o1jax3jg",
      "componentPublicId": null,
      "quantityRole": "declared",
      "amount": 30,
      "unitCode": "minute",
      "unitLabel": "分",
      "rangeStart": null,
      "rangeEnd": null,
      "perOccurrence": false,
      "periodExpression": null
    }
  ],
  "pendingQuestion": {
    "actionId": null,
    "questionCode": "quantity_role_unresolved",
    "targetFactId": "wpf_workload_1x13su81czs2s4",
    "graphRevision": 2,
    "effortMeasurement": null,
    "estimateForWorkloadFactId": null,
    "questionBasis": null
  }
};
// Explicit accepted-state unit fixture for the existing public-workload permission.
// The API0 companion uses the complete original saved graph byte-for-byte.
function acceptedGraph() {
  const graph=createEmptyWeeklyPlanningFactGraphV5();graph.revision=2;
  const source=(id:string)=>({conversationId:'known-context',turnId:'known-turn',semanticLocalId:id,sourceText:'known accepted context',origin:'user' as const});
  graph.tasks=currentSummary.tasks.map(t=>({id:t.publicId,category:'study' as const,title:t.title,source:source(t.publicId),createdRevision:1}));
  graph.workloads=currentSummary.workloads.map(w=>({id:w.publicId,taskId:w.taskPublicId,componentId:w.componentPublicId,quantityRole:w.quantityRole as 'target'|'declared',amount:w.amount,unitCode:w.unitCode as 'page'|'minute',unitLabel:w.unitLabel,rangeStart:w.rangeStart,rangeEnd:w.rangeEnd,perOccurrence:w.perOccurrence,periodExpression:null,source:source(w.publicId),createdRevision:1}));
  graph.factLifecycles=[...graph.tasks,...graph.workloads].map(f=>({factId:f.id,status:'active' as const,createdRevision:1,terminalRevision:null,supersededByFactId:null}));
  return graph;
}
const correctedRaw = () => { const document=JSON.parse(actualRereadRaw); document.corrections[0].operation='remove'; document.corrections[0].replacementLocalId=null; return JSON.stringify(document); };

describe('recorded workload to effort correction reaches existing early validation', () => {
  it('rejects the actual wrong-kind replace, while explicit remove plus effort stays valid', () => {
    const invalid=validateWeeklyPlanningSemanticResponseV5(actualRereadRaw,{currentUserText,publicStateSummary:currentSummary,committedGraph:acceptedGraph()});
    expect(invalid.document).toBeNull();
    expect(invalid.errors).toEqual(['document.corrections[0].replacementLocalId:kind-mismatch:workload:effort_estimate']);
    const valid=validateWeeklyPlanningSemanticResponseV5(correctedRaw(),{currentUserText,publicStateSummary:currentSummary,committedGraph:acceptedGraph()});
    expect(valid.errors).toEqual([]);expect(valid.document?.tasks[0].effortEstimates[0].minutes).toBe(30);
  });

  it('uses the existing single JSON repair when the wrong-kind response is the initial generic reading', async () => {
    const requests: Array<{messages: Array<{role:string;content:string}>}> = [];
    const normalizer=createWeeklyPlanningSemanticNormalizerV5({createChatCompletion:async(request) => {
      requests.push(request);
      if(requests.length===1) return '{"decision":"fallback","effortTarget":null,"effortMeasurement":null,"minutes":null,"precision":null,"quantityRole":null}';
      if(requests.length===2) return actualRereadRaw;
      if(requests.length===3){const repair=JSON.parse(request.messages[request.messages.length - 1].content);expect(repair.validationErrors).toEqual(['document.corrections[0].replacementLocalId:kind-mismatch:workload:effort_estimate']);expect(repair.requiredChanges.join(' ')).toContain('same kind');return correctedRaw();}
      throw new Error('Unexpected additional dispatch');
    }});
    const result=await normalizer.normalize({userText:currentUserText,publicStateSummary:currentSummary,committedGraph:acceptedGraph()});
    expect(requests).toHaveLength(3);expect(result.status).toBe('accepted');expect(result.diagnostics.repairAttempted).toBe(true);
    expect(result.document?.corrections[0].operation).toBe('remove');expect(result.document?.tasks[0].effortEstimates[0].minutes).toBe(30);
  });
});

// Invalid content from the existing first completeness pass follows the existing
// final completeness route, not the initial-reading JSON repair route.
it('reports wrong-kind reread early and retains the existing bounded final completeness path', async () => {
  const requests: Array<{messages: Array<{role:string;content:string}>}> = [];
  const normalizer=createWeeklyPlanningSemanticNormalizerV5({createChatCompletion:async(request) => {
    requests.push(request);
    if(requests.length===1)return '{"decision":"fallback","effortTarget":null,"effortMeasurement":null,"minutes":null,"precision":null,"quantityRole":null}';
    if(requests.length===2)return "{\"schemaVersion\":\"weekly-planning-semantic-v5\",\"planningIntent\":\"update_plan\",\"planningWindow\":null,\"tasks\":[],\"relations\":[],\"availabilityDeclarations\":[],\"constraintSourceRequests\":[],\"userContextFacts\":[],\"conversationActs\":[{\"kind\":\"answer_pending_question\",\"targetPublicId\":null}],\"uncertainties\":[],\"corrections\":[],\"decisions\":[] }";
    if(requests.length===3){expect(request.messages[request.messages.length - 1].content).toContain('The prior response is schema-valid');return actualRereadRaw;}
    if(requests.length===4){expect(request.messages[request.messages.length - 1].content).toContain('The completeness retry still produced no typed semantic content.');expect(request.messages.filter(m=>m.role==='assistant')).toHaveLength(0);return correctedRaw();}
    throw new Error('Unexpected additional dispatch');
  }});
  const result=await normalizer.normalize({userText:currentUserText,publicStateSummary:currentSummary,committedGraph:acceptedGraph()});
  expect(requests).toHaveLength(4);expect(result.status).toBe('accepted');expect(result.diagnostics.repairAttempted).toBe(false);
  expect(result.document?.corrections[0].operation).toBe('remove');
});
