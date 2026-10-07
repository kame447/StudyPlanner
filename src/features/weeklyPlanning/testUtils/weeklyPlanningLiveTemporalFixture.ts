import type { StudyMaterial } from '../../../types/domain';
import type { Json } from './weeklyPlanningSchedulingConstraintsFixture';

// Exact repaired semantic output of live A on e34b3c02, captured 2026-10-08.
// Transport metadata, credentials and unrelated registered materials are excluded.
const LIVE_A_DOCUMENT: Json = {
  "schemaVersion": "weekly-planning-semantic-v5",
  "planningIntent": "create_plan",
  "planningWindow": {
    "localId": "planning-window-1",
    "kind": "relative_week",
    "value": "next_week",
    "start": null,
    "end": null,
    "sourceText": "来週"
  },
  "tasks": [
    {
      "localId": "task-1",
      "existingPublicId": null,
      "decompositionStatus": "decomposed",
      "category": "study",
      "title": "アルゴリズムイントロダクションを読む",
      "study": {
        "purpose": "self_study",
        "activityKind": "reading",
        "contextLabel": "アルゴリズムイントロダクション",
        "components": [
          {
            "localId": "component-1",
            "existingPublicId": null,
            "parentLocalId": null,
            "role": "material",
            "label": "アルゴリズムイントロダクション",
            "workloads": [],
            "durableContextSignals": [],
            "sourceText": "アルゴリズムイントロダクション"
          }
        ]
      },
      "workloads": [
        {
          "localId": "workload-1",
          "quantityRole": "target",
          "amount": 20,
          "unitCode": "page",
          "unitLabel": "ページ",
          "rangeStart": null,
          "rangeEnd": null,
          "perOccurrence": false,
          "periodExpression": "来週",
          "sourceText": "20ページ"
        }
      ],
      "effortEstimates": [
        {
          "localId": "effort-1",
          "targetLocalId": "workload-1",
          "kind": "duration_per_unit",
          "minutes": 3,
          "unitCode": "page",
          "precision": "approximate",
          "sourceText": "1ページ3分くらい"
        }
      ],
      "temporalConstraints": [],
      "recurrence": [],
      "durableContextSignals": [],
      "sourceText": "来週、アルゴリズムイントロダクションを20ページ読みたい。"
    }
  ],
  "relations": [],
  "availabilityDeclarations": [
    {
      "localId": "availability-1",
      "kind": "preferred",
      "dateExpression": null,
      "namedTimePeriod": null,
      "startTime": "20:00",
      "endTime": null,
      "recurrenceKind": "weekdays",
      "days": [
        "weekday:monday",
        "weekday:tuesday",
        "weekday:wednesday",
        "weekday:thursday",
        "weekday:friday"
      ],
      "constraintLevel": "soft",
      "capacityMinutes": null,
      "sourceText": "平日は20時以降がいい"
    }
  ],
  "constraintSourceRequests": [],
  "userContextFacts": [],
  "conversationActs": [],
  "uncertainties": [],
  "corrections": [],
  "decisions": []
};

export const LIVE_A_MATERIAL_ID = 'study-material-00000000-0000-4000-8000-000000000488';

export function liveATemporalDocument(initialBindingError = false): Json {
  const document = structuredClone(LIVE_A_DOCUMENT);
  if (initialBindingError) {
    const study = (document.tasks as Json[])[0].study as Json;
    (study.components as Json[])[0].existingPublicId = LIVE_A_MATERIAL_ID;
  }
  return document;
}

/** Alternative typed representation: the same preference attached to its work. */
export function taskTemporalPreferenceDocument(overrides: Json = {}): Json {
  const document = liveATemporalDocument();
  document.availabilityDeclarations = [];
  const task = (document.tasks as Json[])[0];
  task.temporalConstraints = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((day) => ({
    localId: `preferred-${day}`, targetLocalId: task.localId, kind: 'preferred_window', constraintLevel: 'soft',
    dateExpression: `weekday:${day}`, namedTimePeriod: null, startTime: '20:00', endTime: null,
    precision: 'approximate', sourceText: '平日は20時以降がいい', ...overrides,
  }));
  return document;
}

export const LIVE_A_BOOK: StudyMaterial = {
  id: LIVE_A_MATERIAL_ID, userId: 'issue488-owner', name: 'アルゴリズムイントロダクション',
  subjectId: 'subject-computer-science', subjectName: '情報科学', paceEnabled: true,
  progressUnit: 'page', totalUnits: 650, currentUnit: 120,
  targetDate: '2026-11-22', estimatedMinutesPerUnit: 8, maxUnitsPerDay: 12,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
};
