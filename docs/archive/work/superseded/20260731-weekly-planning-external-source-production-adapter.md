# External calendar source production adapter — deferred

Status: superseded / deferred outside current MVP
Updated: 2026-08-22

The old active task proposed connecting a production external calendar adapter with pagination, auth refresh and retry semantics.

Current Stable V5 only treats the app's timetable and existing saved plans as supported schedule sources. Google / Apple / Outlook calendar integration is not a current production source and must not be inferred by the semantic model.

If external calendar integration becomes a product requirement, create or reuse an explicit current Issue, define privacy / auth / pagination / atomic-source contracts, and then create a fresh task from current architecture. Do not resume this historical task directly.
