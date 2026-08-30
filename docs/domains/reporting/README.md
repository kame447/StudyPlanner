# Reporting domain

このdomainは、StudyPlannerに保存された学習実績・予定・教材情報を、ユーザー向けの学習レポートとして集計・表示する責務を所有する。

現在の正仕様:

- [`spec/learning-report.md`](spec/learning-report.md): 学習レポートの情報設計、集計不変条件、UI/UX、ナビゲーション、受け入れ条件

このdomainは、週間計画の意味解釈・スケジューリングや、client/server authorityを所有しない。レポートは既存データを決定論的に集計して表示する二次画面であり、AIを集計や評価の正本として利用しない。
