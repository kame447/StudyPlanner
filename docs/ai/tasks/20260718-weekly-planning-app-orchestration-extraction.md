# Appから週間計画の進行・承認・画面接続を分離する

Status: implementing
Priority: P1
Issue: #49

## 1. 背景

`src/App.tsx`はアプリ全体の画面構成に加えて、週間計画について次の責務を直接担当している。

- 週間計画の状態初期化
- 会話処理の開始、中止、履歴消去、セッション初期化
- 非同期処理の実行依存の組み立て
- 仮予定の承認前検証
- 仮予定から通常予定への保存
- 承認履歴の読み込み、更新、localStorage保存
- クイック追加画面への週間計画用props接続
- 週表示・日表示への仮予定接続

この状態では、週間計画の内部変更が`App.tsx`へ波及し、アプリ全体の画面変更と衝突しやすい。また、承認処理と会話処理のテストが画面ルートへ引き上げられ、責務境界が不明瞭になる。

## 2. 目的

週間計画の進行管理、仮予定承認、画面接続を週間計画専用のアプリケーション層へ移し、`App.tsx`を次の責務へ限定する。

- アプリ全体の認証・画面切替
- 他機能から週間計画へ渡す外部データの選択
- 週間計画用の専用接続componentの配置

## 3. 実装方針

### 3.1 専用アプリケーションhook

専用hookへ次を集約する。

- `useWeeklyPlanningState`の呼び出し
- 1回の会話処理を管理するsessionの保持
- 会話送信、中止、履歴消去、セッション初期化
- 仮予定候補と下書きの追加・削除
- 仮予定承認と通常予定への保存
- 承認履歴の永続化

既存のreducer、turn controller、approval処理を再利用し、業務ロジックを複製しない。

### 3.2 専用画面接続component

クイック追加画面へ渡す週間計画用の状態と操作を専用componentで接続する。

`App.tsx`はクイック追加画面へ、利用者、選択日、既存予定、教材、通常の保存操作、週間計画アプリケーションオブジェクトだけを渡す。

### 3.3 依存方向

```text
App
  -> 週間計画アプリケーションhook
       -> reducer / turn controller / turn executor / approval
  -> 週間計画用クイック追加接続component
       -> QuickEntryModal
```

UI componentから`App`固有の状態へ逆参照しない。週間計画のdomain処理からReact component型へ依存しない。

## 4. 受け入れ条件

- `App.tsx`から週間計画の会話開始・中止・履歴消去・初期化の実装詳細がなくなる。
- `App.tsx`から仮予定承認処理、承認履歴、保存済み重複確認の実装詳細がなくなる。
- `App.tsx`からクイック追加画面への週間計画用propsの列挙がなくなる。
- 既存の二重送信防止、週変更・中止・初期化後の古い結果破棄を維持する。
- 仮予定承認時の古い候補・未確認仮定・重複保存の防止を維持する。
- 週間計画のfocused test、週間計画suite、全test、production buildが成功する。
- 実装後の全体監査結果と残課題を本書へ追記する。

## 5. 対象外

- 発話解釈、質問選択、仮予定配置アルゴリズムの変更
- サーバー側の承認永続化
- 週始まり・長期個別設定の実装
- 会話記録の保存方式変更

## 6. 実装予定ファイル

- `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.ts`
- `src/components/WeeklyPlanningQuickEntryModal.tsx`
- `src/features/weeklyPlanning/application/useWeeklyPlanningApplication.test.tsx`
- `src/App.tsx`

## 7. 全体監査

実装と自動検証後に追記する。

確認対象:

- `App.tsx`に残る週間計画の実装詳細
- QuickEntryModalとNaturalLanguageAssistantの責務境界
- reducer、turn controller、executor、pipeline間の重複
- 仮予定承認の永続化と複数端末安全性
- 会話記録、個別設定、通常予定保存のデータ境界
- 実ブラウザでのみ確認可能な操作
