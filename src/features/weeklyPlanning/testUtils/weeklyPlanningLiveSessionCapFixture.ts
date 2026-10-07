import type { Json } from './weeklyPlanningSchedulingConstraintsFixture';

// Live D T3 semantic response at500173e0. No transport metadata or credentials.
// Public IDs and retained titles are rebound to the deterministic setup; semantic
// session lengths, recurrence counts, windows and original evidence are unchanged.
const LIVE_SPLIT: Json = {
  "schemaVersion": "weekly-planning-semantic-v5",
  "planningIntent": "update_plan",
  "planningWindow": null,
  "tasks": [
    {
      "localId": "task_algorithms",
      "existingPublicId": null,
      "decompositionStatus": "atomic",
      "category": "study",
      "title": "アルゴリズムイントロダクションを読む",
      "study": null,
      "workloads": [],
      "effortEstimates": [
        {
          "localId": "effort_algorithms_session",
          "targetLocalId": "task_algorithms",
          "kind": "session_duration",
          "minutes": 60,
          "unitCode": "session",
          "precision": "approximate",
          "sourceText": "1回1時間くらいで2回に分けたい"
        }
      ],
      "temporalConstraints": [
        {
          "localId": "time_algorithms_night",
          "targetLocalId": "task_algorithms",
          "kind": "preferred_window",
          "constraintLevel": "soft",
          "dateExpression": null,
          "namedTimePeriod": "night",
          "startTime": null,
          "endTime": null,
          "precision": "unspecified",
          "sourceText": "どっちも夜がいい"
        }
      ],
      "recurrence": [
        {
          "localId": "recurrence_algorithms",
          "targetLocalId": "task_algorithms",
          "kind": "custom",
          "count": 2,
          "days": [],
          "sourceText": "1回1時間くらいで2回に分けたい"
        }
      ],
      "durableContextSignals": [],
      "sourceText": "アルゴリズムイントロダクションを20ページ読む"
    },
    {
      "localId": "task_research_notes",
      "existingPublicId": null,
      "decompositionStatus": "atomic",
      "category": "study",
      "title": "卒業研究ノートを進める",
      "study": null,
      "workloads": [],
      "effortEstimates": [
        {
          "localId": "effort_research_notes_session",
          "targetLocalId": "task_research_notes",
          "kind": "session_duration",
          "minutes": 60,
          "unitCode": "session",
          "precision": "approximate",
          "sourceText": "1回1時間くらいで2回に分けたい"
        }
      ],
      "temporalConstraints": [
        {
          "localId": "time_research_notes_night",
          "targetLocalId": "task_research_notes",
          "kind": "preferred_window",
          "constraintLevel": "soft",
          "dateExpression": null,
          "namedTimePeriod": "night",
          "startTime": null,
          "endTime": null,
          "precision": "unspecified",
          "sourceText": "どっちも夜がいい"
        }
      ],
      "recurrence": [
        {
          "localId": "recurrence_research_notes",
          "targetLocalId": "task_research_notes",
          "kind": "custom",
          "count": 2,
          "days": [],
          "sourceText": "1回1時間くらいで2回に分けたい"
        }
      ],
      "durableContextSignals": [],
      "sourceText": "卒業研究ノートを2時間進めたい"
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
};

export function liveDSplitSessionDocument(graph: { tasks: readonly { id: string; title: string }[] }): Json {
  const document = structuredClone(LIVE_SPLIT);
  const targets = ['アルゴリズムイントロダクション', '卒業研究ノート'];
  (document.tasks as Json[]).forEach((task, index) => {
    const bound = graph.tasks.find(task => task.title === targets[index])!;
    task.existingPublicId = bound.id;
    task.title = bound.title;
  });
  return document;
}
