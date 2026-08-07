import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  collectUserPlanningContextFactsV5,
} from './weeklyPlanningDurableContextSignalsV5';
import {
  validateWeeklyPlanningSemanticValueV5,
} from './weeklyPlanningSemanticValidatorV5';

function baseDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 entity-bound durable context signals', () => {
  it('requires durableContextSignals on every provider task and study component', () => {
    const root = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.schema as any;
    const taskSchema = root.properties.tasks.items;
    const componentSchema = taskSchema.properties.study.anyOf[0].properties.components.items;

    expect(taskSchema.required).toContain('durableContextSignals');
    expect(taskSchema.properties.durableContextSignals.items.properties.kind.enum).toEqual([
      'concern',
    ]);
    expect(componentSchema.required).toContain('durableContextSignals');
    expect(componentSchema.properties.durableContextSignals.items.properties.kind.enum).toEqual([
      'concern',
    ]);
  });

  it('maps a component-local concern to owner context using the AI-selected component label', () => {
    const document: WeeklyPlanningSemanticDocumentV5 = {
      ...baseDocument(),
      tasks: [{
        localId: 'task-exam',
        category: 'study',
        title: '模試の勉強',
        study: {
          purpose: 'exam',
          contextLabel: '模試',
          components: [{
            localId: 'component-math',
            parentLocalId: null,
            role: 'subject',
            label: '数学',
            workloads: [],
            durableContextSignals: [{
              localId: 'concern-math',
              kind: 'concern',
              value: '結構まずい',
              sourceText: '特に数学が結構まずいです',
            }],
            sourceText: '特に数学が結構まずいです',
          }],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        durableContextSignals: [],
        sourceText: '模試の勉強も進めたいです',
      }],
    };

    expect(collectUserPlanningContextFactsV5(document)).toEqual([{
      localId: 'concern-math',
      kind: 'concern',
      label: '数学',
      value: '結構まずい',
      dateExpression: null,
      sourceText: '特に数学が結構まずいです',
    }]);
  });

  it('maps a task-local concern when the concern applies to the whole task', () => {
    const document: WeeklyPlanningSemanticDocumentV5 = {
      ...baseDocument(),
      tasks: [{
        localId: 'task-research',
        category: 'study',
        title: '研究の分析',
        study: {
          purpose: 'research',
          contextLabel: '研究',
          components: [],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        durableContextSignals: [{
          localId: 'concern-research',
          kind: 'concern',
          value: 'かなり遅れていて不安',
          sourceText: '研究の分析がかなり遅れていて不安です',
        }],
        sourceText: '研究の分析がかなり遅れていて不安です',
      }],
    };

    expect(collectUserPlanningContextFactsV5(document)).toEqual([
      expect.objectContaining({
        kind: 'concern',
        label: '研究の分析',
        value: 'かなり遅れていて不安',
      }),
    ]);
  });

  it('keeps old internal semantic fixtures compatible when signal arrays are omitted', () => {
    const legacyFixture = {
      ...baseDocument(),
      tasks: [{
        localId: 'task-old',
        category: 'study',
        title: '英語',
        study: {
          purpose: 'self_study',
          contextLabel: null,
          components: [{
            localId: 'component-old',
            parentLocalId: null,
            role: 'subject',
            label: '英語',
            workloads: [],
            sourceText: '英語を進めたい',
          }],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '英語を進めたい',
      }],
    };

    expect(validateWeeklyPlanningSemanticValueV5(legacyFixture).errors).toEqual([]);
  });

  it('rejects duplicate signal localIds without reinterpreting raw text', () => {
    const value = {
      ...baseDocument(),
      tasks: [{
        localId: 'task-one',
        category: 'study',
        title: '英語',
        study: null,
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        durableContextSignals: [{
          localId: 'same-signal',
          kind: 'concern',
          value: null,
          sourceText: '英語が不安',
        }],
        sourceText: '英語が不安',
      }, {
        localId: 'task-two',
        category: 'study',
        title: '数学',
        study: null,
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        durableContextSignals: [{
          localId: 'same-signal',
          kind: 'concern',
          value: null,
          sourceText: '数学が不安',
        }],
        sourceText: '数学が不安',
      }],
    };

    expect(validateWeeklyPlanningSemanticValueV5(value).errors).toContain(
      'document.tasks[1].durableContextSignals[0].localId:duplicate-local-id',
    );
  });
});
