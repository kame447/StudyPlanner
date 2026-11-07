# Reporting domain

このドメインは、StudyPlanner に保存された学習実績・予定・教材情報を、ユーザー向けの学習レポートとして集計・表示する責務を所有する。

現在の正仕様:

- [`spec/learning-report.md`](spec/learning-report.md): 学習レポートの情報設計、集計不変条件、UI/UX、ナビゲーション、受け入れ条件

本ドメインは、週間計画の意味解釈・スケジューリングや、client/server authority を所有しない。レポートは既存データを決定論的に集計して表示する二次画面であり、AI を集計や評価の正本として利用しない。

2026-11-04 時点の main には [PR #968](https://github.com/kame447/StudyPlanner/pull/968)（未使用のレポート・予定ヘルパー削除）、[PR #969](https://github.com/kame447/StudyPlanner/pull/969)（教材ペース結果の共通フィールド整理）、[PR #972](https://github.com/kame447/StudyPlanner/pull/972)（レポート間の教材配色規則の共通化）が取り込まれている。公開 API、集計対象、比率、並べ替えの意味を変更する機能追加ではない。実装の正本は `src/lib/reportAnalytics.ts`、`src/lib/learningReport.ts`、`src/lib/materialPace.ts` と対応するテストであり、完了済みPRを新しい作業キューとして扱わない。

進行中の作業:

- [自動お休み券の反復計算削減と復元検証](work/study-rest-calculation-handoff.md)

- [連続学習カレンダーとお休みチケット](work/20261014-study-streak-calendar-handoff.md)

- [連続学習の1画面化・自動お休み券・今日の炎](work/20261014-study-streak-auto-rest-handoff.md)

- [連続学習カレンダーと下部表示の読みやすさ](work/20261014-study-streak-readability-handoff.md)

- [ホーム学習進捗の集計対象設定](work/20261014-home-progress-inclusion-handoff.md)
- [学習レポートの概要1画面化](work/20261014-compact-learning-report-handoff.md)

- [デスクトップ学習レポートの幅・可読性](work/20261017-desktop-report-readability-handoff.md)
