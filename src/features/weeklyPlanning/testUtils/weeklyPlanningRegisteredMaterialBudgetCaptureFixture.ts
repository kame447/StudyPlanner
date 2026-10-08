import type { StudyMaterial } from '../../../types/domain';

/** Live D2 shapes; all material names and public identities are synthetic. */
export const REGISTERED_MATERIAL_BUDGET_CAPTURE = {
  "initialUserText": "来週、合成演習帳を20ページ読むのと、合成研究メモを2時間進めたい",
  "initialDocument": {
    "schemaVersion": "weekly-planning-semantic-v5",
    "planningIntent": "create_plan",
    "planningWindow": {
      "localId": "window-1",
      "kind": "relative_week",
      "value": "next_week",
      "start": null,
      "end": null,
      "sourceText": "来週"
    },
    "tasks": [
      {
        "localId": "task-1",
        "existingPublicId": "fixture-material-2",
        "decompositionStatus": "atomic",
        "category": "study",
        "title": "合成演習帳",
        "study": {
          "purpose": "self_study",
          "activityKind": "reading",
          "contextLabel": "合成演習帳",
          "components": []
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
            "periodExpression": null,
            "sourceText": "20ページ読む"
          }
        ],
        "effortEstimates": [],
        "temporalConstraints": [],
        "recurrence": [],
        "durableContextSignals": [],
        "sourceText": "合成演習帳を20ページ読む"
      }
    ],
    "relations": [],
    "availabilityDeclarations": [],
    "constraintSourceRequests": [],
    "userContextFacts": [],
    "conversationActs": [],
    "uncertainties": [],
    "corrections": [],
    "decisions": []
  },
  "audit": {
    "decision": "incomplete",
    "missingFacts": [
      "合成研究メモを2時間進めたいという作業内容と2時間の作業量"
    ]
  },
  "rereadDocument": {
    "schemaVersion": "weekly-planning-semantic-v5",
    "planningIntent": "create_plan",
    "planningWindow": {
      "localId": "window-1",
      "kind": "relative_week",
      "value": "next_week",
      "start": null,
      "end": null,
      "sourceText": "来週"
    },
    "tasks": [
      {
        "localId": "task-1",
        "existingPublicId": "fixture-material-2",
        "decompositionStatus": "atomic",
        "category": "study",
        "title": "合成演習帳",
        "study": {
          "purpose": "self_study",
          "activityKind": "reading",
          "contextLabel": "合成演習帳",
          "components": []
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
            "periodExpression": null,
            "sourceText": "20ページ読む"
          }
        ],
        "effortEstimates": [],
        "temporalConstraints": [],
        "recurrence": [],
        "durableContextSignals": [],
        "sourceText": "合成演習帳を20ページ読む"
      }
    ],
    "relations": [],
    "availabilityDeclarations": [],
    "constraintSourceRequests": [],
    "userContextFacts": [],
    "conversationActs": [],
    "uncertainties": [],
    "corrections": [],
    "decisions": []
  },
  "paceUserText": "1ページ3分くらい",
  "paceAnswer": {
    "decision": "effort_answer",
    "effortTarget": "question_target",
    "effortMeasurement": "duration_per_unit",
    "minutes": 3,
    "precision": "approximate",
    "quantityRole": null
  },
  "splitUserText": "1回1時間くらいで2回に分けたい。どっちも夜がいい",
  "splitDocument": {
    "schemaVersion": "weekly-planning-semantic-v5",
    "planningIntent": "update_plan",
    "planningWindow": null,
    "tasks": [
      {
        "localId": "task_algorithms_existing",
        "existingPublicId": "BOOK_PUBLIC_ID",
        "decompositionStatus": "atomic",
        "category": "study",
        "title": "合成演習帳",
        "study": {
          "purpose": "self_study",
          "activityKind": "reading",
          "contextLabel": null,
          "components": []
        },
        "workloads": [],
        "effortEstimates": [],
        "temporalConstraints": [],
        "recurrence": [],
        "durableContextSignals": [],
        "sourceText": "どっちも夜がいい"
      },
      {
        "localId": "task_graduation_notes",
        "existingPublicId": null,
        "decompositionStatus": "atomic",
        "category": "study",
        "title": "合成研究メモ",
        "study": {
          "purpose": "research",
          "activityKind": "writing",
          "contextLabel": null,
          "components": []
        },
        "workloads": [],
        "effortEstimates": [],
        "temporalConstraints": [],
        "recurrence": [],
        "durableContextSignals": [],
        "sourceText": "どっちも夜がいい"
      }
    ],
    "relations": [],
    "availabilityDeclarations": [],
    "constraintSourceRequests": [],
    "userContextFacts": [],
    "conversationActs": [],
    "uncertainties": [],
    "corrections": [],
    "decisions": []
  }
} as const;

export const REGISTERED_MATERIAL_BUDGET_MATERIALS: StudyMaterial[] = [
  { id: 'fixture-material-1', userId: 'issue488-owner', name: '合成研究メモ',
    subjectId: 'subject-research', subjectName: '研究', paceEnabled: true,
    progressUnit: 'section', totalUnits: 12, currentUnit: 5,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
  { id: 'fixture-material-2', userId: 'issue488-owner', name: '合成演習帳',
    subjectId: 'subject-computing', subjectName: '情報科学', paceEnabled: true,
    progressUnit: 'page', totalUnits: 650, currentUnit: 120,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
];
