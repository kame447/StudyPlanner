# Architecture Review

## DFD

```mermaid
flowchart LR
  user["User"]
  authUi["AuthScreen / MyPageDialog"]
  plannerUi["Month / Week / Day / Report Views"]
  appState["usePlannerAppState"]
  noticeState["useNoticeState"]
  authState["useAuthSessionState"]
  plannerState["usePlannerDataState"]
  authRepo["authRepository"]
  plannerRepo["plannerRepository"]
  authGateway["AuthStorageGateway"]
  plannerGateway["PlannerStorageGateway"]
  localStorage["window.localStorage"]
  aiUi["NaturalLanguageAssistant"]
  aiService["naturalLanguagePlanner"]
  aiConfig["aiConfig(sessionStorage)"]
  aiClient["OpenAI-compatible client"]
  ollama["Ollama / OpenAI-compatible API"]
  rules["Rule-based parser"]

  user --> authUi
  user --> plannerUi
  authUi --> appState
  plannerUi --> appState
  appState --> noticeState
  appState --> authState
  appState --> plannerState
  authState --> authRepo
  plannerState --> plannerRepo
  authRepo --> authGateway
  plannerRepo --> plannerGateway
  authGateway --> localStorage
  plannerGateway --> localStorage

  user --> aiUi
  aiUi --> aiService
  aiService --> aiConfig
  aiService --> aiClient
  aiService --> rules
  aiClient --> ollama
```

## ER

```mermaid
erDiagram
  USER ||--o{ PLAN : owns
  USER ||--o{ ACTUAL : records
  USER ||--o{ DAY_NOTE : writes
  USER ||--o{ MONTH_EVENT : manages
  PLAN ||--o| ACTUAL : has

  USER {
    string id
    string email
    string username
    string avatar
    string createdAt
  }

  PLAN {
    string id
    string userId
    string title
    string subject
    string date
    string startTime
    string endTime
    string type
    string memo
    string createdAt
    string updatedAt
  }

  ACTUAL {
    string id
    string userId
    string planId
    string actualStartTime
    string actualEndTime
    string title
    string subject
    boolean isAlignedToPlan
    string note
    string updatedAt
  }

  DAY_NOTE {
    string id
    string userId
    string date
    string quickMemo
    string reflection
    string nextFocus
    boolean checkedPlan
    boolean checkedRecord
    boolean checkedReady
    string updatedAt
  }

  MONTH_EVENT {
    string id
    string userId
    string date
    string title
    string startTime
    string endTime
    string repeat
    string repeatUntil
    string excludedDates[]
    string url
    string memo
    string locationTags[]
    string createdAt
    string updatedAt
  }
```

## Data Structure Notes

- `Plan` と `Actual` は 1 対 0/1 の構造で、MVP要件の「1予定に対して1実績」を満たしている。
- `MonthEvent` は `Plan` と分離されており、勉強予定と主要予定の責務分離は妥当。
- `MonthEvent` の繰り返しは `repeatUntil` と `excludedDates` で表現していて、削除スコープの拡張余地もある。
- `User` に `username` と `avatar` を持たせたことで、表示用プロフィールは `auth` レイヤーで閉じている。

## Review Summary

- データ構造に致命的な破綻は見つかっていない。
- `usePlannerAppState` の責務は `useAuthSessionState` と `usePlannerDataState` に分割済みで、合成フックとして整理された。
- OpenAI互換APIのキーをブラウザで保持し、ブラウザから直接送る構成は個人ローカル用途には妥協可能だが、公開用途では不適切。
- メール認証はMVP用で、コード表示・セッション保持ともにクライアント完結のため、本番用認証とは別物として扱うべき。

## Checks Run

- `node .\node_modules\typescript\bin\tsc --noEmit`
- `npm run build`
- `npm audit --json`
