# 段階的な対話と既知情報の再利用(質問計画の設計)【設計主体・大きめ】

現在の対話は不足項目を一度に列挙しており事務的で圧迫感がある。今後は **一度に1〜2論点**を自然に確認し、既知情報は再質問せず、短く受け止めてから次へ進みたい。特に固定予定は、アプリが既存カレンダーを持つため「現在のカレンダーには火曜20時〜22時のバイトがあります。これ以外に予定はありますか?」のように**既知情報を提示して差分だけ尋ねる**。睡眠・生活情報も既知情報があれば再利用する。

このタスクは**設計主体**。実装範囲が広いため、まず設計 Phase を行い、実装は最小サブセットに絞る。**質問文の日本語生成は別タスク**(`20260707-weekly-planning-question-rendering-separation.md`)であり、本タスクは「何を・どの順で・どれだけ聞くか」の deterministic な決定と既知情報の取り込みに限定する。

本mdの範囲外へ進まない。git add / commit / push はしない。

## 確定している事実 / 調査前提

- `dialogueManager` の `createWeeklyPlanningDialogueDecision` は `missing` 全件を `requiredFields` に列挙し、`missingMessageKey` で1メッセージ化している。**1〜2論点への絞り込みや優先度付けの層がない**。
- missing 判定は `weeklyPlanningMissingStatus` に集約されており、deterministic。既知情報の再利用は「そもそも missing に入れない」形で表現できる。
- 既存カレンダー予定(fixed events)は現状 intake の外にあり、会話で毎回ユーザーに聞いている。アプリはカレンダーを持っているため、**既知の fixed events を intake の初期状態として取り込めば再質問を避けられる**。
- roadmap R4「質問計画」(質問するべき度・1ターン1〜3問・spec §6)、R2初期-4「受理済み条件の応答反映」と重なる。本タスクはその R4 の deterministic 中核を先取りする。

## 実装範囲

### Phase 1: 設計(文書のみ)

- 質問計画の設計: missing を「1ターンに提示する 1〜2 論点」へ絞る優先度規則(どの slot を先に聞くか)。spec §6 の「質問するべき度」を決定的規則に落とす。
- 既知情報の取り込み設計: アプリが保持する既存カレンダー予定 / 睡眠・生活プロファイルを intake の初期 `constraints` / state に注入し、対応 missing を初期解消する経路。「既知を提示して差分を尋ねる」ための decision 表現(既知サマリ + 差分質問)。
- どこまでを本タスクの実装サブセットにするかを決めて報告(下記 Phase 2 の候補から選ぶ)。

### Phase 2: 最小実装サブセット(Phase 1 で確定・挙動変更は red→green)

候補(Phase 1 で1つ以上に絞る。全部はやらない):

- (a) 質問の 1〜2 論点絞り込み: decision に「今回聞く優先 slot 1〜2件」を持たせ、requiredFields を全列挙しない。優先度規則は deterministic。
- (b) 既知カレンダー予定の intake 注入: 既存 fixed events を初期 constraints として取り込み、`fixed_events` missing を初期解消し、decision に既知サマリを載せる(差分を尋ねる形)。カレンダー取得の配線が UI/データ層に及ぶ場合は、intake が受け取る interface までを実装し UI 配線は停止して報告。
- (c) **分割方針の確認対話(atomic-work-unit-splitting からの引き継ぎ責任)**: `atomic-work-unit-splitting` は意味単位を atomic 既定で配置し、入り切らない場合は unscheduled diagnostics を出すところまでで完結する。その diagnostics(配置不能な atomic work item)を入力に、「この1年度分はまとめて配置できませんでした。分割してもよいですか?」のように**分割許可を確認する対話**は本タスク(質問計画)が所有する。設計 Phase でこの確認を質問計画の1論点として位置づけ、実装するかは Phase 1 で他候補と優先度比較する。**この責任は本タスクにあり、atomic 側にはない**(責任が宙に浮かないよう明示)。

## 回帰テスト

- (a): missing が3件以上ある state で、decision の提示論点が 1〜2 件に絞られること。優先度規則どおりの slot が選ばれること。全列挙されないこと。
- (b): 既知 fixed events を持つ初期 state で `fixed_events` が missing に入らず、decision に既知サマリが含まれること。
- 既存 dialogue / missingStatus テストのうち、全列挙前提のものは「現状固定 → intended 変更」を明記して更新。既存 intake フローの受理挙動は不変。

## 完了条件

- 質問計画の設計文書(優先度規則・既知情報取り込み経路)が報告されている。
- Phase 2 の実装サブセットが red→green で入り、1ターンの提示論点が絞られる or 既知情報が再質問されないことがテストで固定されている。
- 既存テスト全 green、build 成功。

## 触らない範囲

- 質問文の日本語生成(別タスク `question-rendering-separation`)。本タスクは「何を聞くか」まで。
- AI interpreter、renderer の AI 接続、R2-D。
- scheduling、work item、capacity。
- カレンダーデータ層の大改修(intake が受け取る interface までに留め、UI 配線が要るなら停止して報告)。

## 停止条件

- Phase 2 が dialogue/missingStatus の広範な期待値変更(既存テストの大量赤化)を要し、現状固定/intended の切り分けが1タスクに収まらないとき。
- 既知カレンダー取り込みが UI/データ層の設計変更に及ぶとき(interface まで実装し報告)。
- 変更が dialogue / missingStatus / intake と対応テストの外へ波及するとき。
- 説明できない新規テスト失敗が出たとき。

## 検証(Node 22)

```bash
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueManager.test.ts
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run test:run -- src/features/weeklyPlanning
env PATH=/home/kame/.nvm/versions/node/v22.23.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm run build
git diff --check && git diff --stat && git status -sb
```
