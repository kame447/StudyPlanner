# Product Observability Console Requirements

Status: canonical product requirement
Updated: 2026-08-28
Owning Issue: #213

## 1. Product intent

StudyPlannerの管理画面は、個別ユーザーの保存データを眺める裏画面ではなく、サービス全体の状態を観測し、変化を発見し、原因まで掘り下げるためのconsoleとして扱う。

管理者が最初に知りたいのは「何件データがあるか」ではない。「利用者は増えているか」「実際に使われているか」「AI/APIの利用量や失敗が増えていないか」「週間計画が最後まで成功しているか」「特定ユーザーの不具合で内部に何が起きたか」である。

したがって、管理画面の情報設計は保存collection単位ではなく、管理者が答えたい問いを基準に構成する。

## 2. Design principles

### Meaning before jargon

分析用語を知っていることを前提にしない。

画面では「過去7日間に利用したユーザー」を主表示し、必要であれば補助的に`WAU`と表示する。`WAU`だけを大きく表示して意味を利用者に推測させない。

同じ方針をDAU、MAU、p95、retentionなどにも適用する。略語や統計用語を利用する場合は、短い日本語説明と集計対象を確認できるようにする。

### Overview first, detail on demand

最初から大量のログや全ユーザーの詳細を表示しない。

全体の変化をOverviewで発見し、必要な場合だけUsers、AI/API、Planning Analytics、Logsへ掘り下げる。

### One metric, one definition

同じ名前の指標をページごとに別の計算で作らない。

各metricは集計対象、期間境界、重複排除単位、除外条件をcanonical semanticsとして1箇所で定義し、UIはそのprojectionを表示する。

### Read-only first

最初の管理consoleは観測と調査を主目的とする。

ユーザーのデータ変更、quota変更、feature flag変更などの管理操作は、観測UIと混在させない。必要になった場合は権限とauditを別設計する。

### Drill down without losing context

集計値から詳細へ進んでも、何を調べていたか分からなくならない。

期間、filter、metric、user、session、requestの関係をURLまたはstable identifierで保持し、戻ったときに同じ調査文脈へ戻れるようにする。

## 3. Top-level information architecture

トップレベルは次の6領域とする。これらは概念レベルで並列な管理目的であり、保存collectionの分類ではない。

### Overview

サービス全体の現在状態を短時間で把握する入口とする。

主に次を表示する。

- 登録ユーザー総数
- 今日利用したユーザー
- 過去7日間に利用したユーザー
- 過去30日間に利用したユーザー
- 新規登録者
- 予定作成、学習記録、AI計画など主要行動の利用量
- AI request数、失敗率、token、推定費用、応答時間
- Planning Sessionの開始数、完了率、失敗率
- telemetry/read modelの更新遅延やsystem warning

各値は可能な範囲で前期間との差を併記する。ただし、単純な増減だけで良し悪しを断定しない。

Overviewは詳細調査を行う場所ではない。異常または変化を発見し、対応ページへ遷移する場所とする。

### Users

ユーザー全体の推移と個別ユーザー調査を同じ責務で扱う。

一覧はカードの羅列ではなく、検索・filter・sort可能な分析表現とする。

ユーザーごとに少なくとも登録日時、最終利用、利用日数、主要機能の利用量、AI計画利用、直近error有無を確認できるようにする。

個別ユーザー詳細では、現在の保存データだけではなく時系列を中心に表示する。

登録、app利用、予定操作、学習記録、AI計画session、AI errorなどの軽量eventをtimelineへ投影し、該当sessionまたはrequestへ直接移動できるようにする。

### AI / API

AI provider利用をStudyPlannerの機能単位で理解するページとする。

request数だけでなく、model、purpose、phase、operation種別ごとに次を確認する。

- request数
- success / failure
- prompt token
- completion token
- total token
- providerが返す場合のcached token等の追加usage
- latency
- rate limit
- timeout
- provider failure
- 推定API費用

推定費用はprovider請求書の代替ではない。StudyPlannerのどの機能が費用を発生させているかを把握するための観測値として扱う。

model価格が不明またはpricing versionを確定できないrequestは、費用を0として扱わず`算出不能`として分離する。

### Planning Analytics

週間計画を「個別ログ」ではなくプロダクト機能として評価する。

少なくとも次の状態遷移を期間別に把握できるようにする。

- session started
- preview reached
- approval reached
- save completed
- abandoned
- failed
- fallback used
- semantic repair used
- stale result observed
- unscheduled item observed
- approval failure observed

また、平均turn数、preview到達までのturn数、appVersion、schedulerVersion、promptVersion、model等で比較できるようにする。

Planning Analyticsはweekly-planning runtime truthを再定義しない。weekly-planning domainが出したtyped outcomeを集計する。

### Logs

個別障害を調査するLog Explorerとする。

最初からRaw JSONを全面表示しない。時刻、severity、feature、actor、session、request、event type、結果の短い要約を一覧化し、必要なentryだけ展開する。

週間計画sessionを開いた場合は、可能な範囲で次の処理順をtimelineとして表示する。

User input → AI request → AI response / validation → deterministic decision → state diff → scheduler → assistant output → preview → approval → save

Raw JSONは最終確認手段として残す。

### System

利用分析ではなく観測基盤と主要依存先の状態を見る。

初期対象はAI proxy、telemetry ingestion、aggregation/read model freshness、trace availability、authenticationなどとする。

System pageも最初はread-onlyとし、設定変更UIは含めない。

## 4. Metric semantics

### 登録ユーザー総数

有効なuser profileの総数を意味する。

削除済みaccountを含めるかはaccount lifecycleの正仕様に従い、単に過去に作られたprofile document数を数えない。

### 今日利用したユーザー（DAU）

日本時間の当日中にqualifying activityが1回以上記録されたdistinct actor数とする。

DAUは`Daily Active Users`の略称だが、UIでは日本語を主表示する。

### 過去7日間に利用したユーザー（WAU）

今日を含む直近7日間でqualifying activityが1回以上記録されたdistinct actor数とする。

WAUは`Weekly Active Users`の略称である。

7日分のDAUを足した値ではない。同じユーザーが7日すべて利用してもWAUでは1人として数える。

### 過去30日間に利用したユーザー（MAU）

今日を含む直近30日間でqualifying activityが1回以上記録されたdistinct actor数とする。

MAUは`Monthly Active Users`の略称であるが、暦月の登録者数ではない。

### Qualifying activity

「利用ユーザー」を定義するための行動は、認証済みapp利用または意味のあるproduct interactionとする。

初期実装では、認証済みapp active marker、予定操作、学習実績操作、Todo/教材操作、週間計画session/turn等を候補とする。

単なるanalytics beaconの再送やtelemetry retryはactivityとして二重計上しない。

具体的event catalogはarchitecture contractがownerであり、UI側で勝手に追加しない。

### 新規登録者

選択期間内にaccount/profileが新規作成されたユーザー数とする。

### 継続利用

初期UIでは複雑なcohort retentionをいきなり導入せず、「新規」「再利用」「30日以上活動なし」など意味が直接伝わる状態を優先する。

cohort retentionを追加する場合は、母集団と経過期間を明示した別metric contractを先に定義する。

### AI失敗率

選択期間の計測対象AI operationのうち、success以外のterminal outcomeが占める割合とする。

quota reject、timeout、provider error、invalid response等はerror categoryを分離し、原因の異なる失敗を一つの曖昧なerrorへまとめない。

### AI応答時間

平均値だけでなく分布を確認できることを要件とする。

p50は半数のrequestがその時間以下で完了する境界、p95は95%のrequestがその時間以下で完了する境界を意味する。

UIでは`95%のリクエストがこの時間以内`のような説明を確認できるようにする。

### 推定API費用

provider、model、pricing version、usageから推定した金額とする。

実請求とは差があり得るため、UI上で`推定`を省略しない。

## 5. Time semantics

管理画面の標準日付境界はAsia/Tokyoとする。

日次指標は日本時間0:00から23:59:59.999までを1日として扱う。

rolling 7 days / 30 daysは現在の日を含む連続期間として定義し、暦週・暦月と混同しない。

週間計画固有のplanning rangeはweekly-planning domainの契約を優先し、管理analyticsの日付境界から書き換えない。

## 6. Drill-down contract

全体分析と個別診断を別々の世界にしない。

少なくとも次の識別子を利用して関連情報を接続できるようにする。

- actorSubjectId
- appSessionId（存在する場合）
- featureSessionId
- requestId
- traceSessionId
- eventId
- appVersion
- schemaVersion

Raw UIDやemailをanalytics eventの基本join keyにしない。管理者がユーザープロフィールから調査する場合は、restricted resolverを経由してopaque actor identityへ接続する。

URLで表現可能なfilterやidentifierはURLへ保持し、reload後も同じ調査対象を再現できるようにする。

## 7. Debug Bundle

AI/agentまたは開発者が一つの障害を調査しやすいように、selected user/session/requestからversioned Debug Bundleを生成できることを要件とする。

Debug Bundleは次を満たす。

- stable JSON schema
- bundle schema version
- selected period / actor / session / request correlation metadata
- app / model / prompt / scheduler等のversion情報
- relevant lightweight metrics
- permitted detailed trace projection
- state diff / deterministic decision / error category等の診断情報
- redaction summary
- data truncation summary

API key、Firebase token、Authorization header、provider secret等は絶対に含めない。

本文を含むdiagnostic traceはlightweight analyticsより高いsensitivityとして扱い、current trace privacy policyとrestricted accessを経由する。

## 8. Privacy and display requirements

全体分析ではemail、prompt本文、assistant本文を必要としない設計を優先する。

ユーザー一覧でemailが必要な場合でも、analytics event自体へemailを複製しない。

詳細traceを開くまでは、可能な限り集計値とopaque identifierだけで調査できるようにする。

管理者権限があることを理由に、全ページへraw contentを常時表示しない。

## 9. Responsive requirements

管理consoleはdesktopを主要な分析面とするが、mobileでも状態確認と基本drill-downを可能にする。

mobileでdesktop表をそのまま横スクロールさせることを唯一の対応にしない。重要metric、filter、session summaryを段階的に開示する。

Raw JSONや広いtimeline等、mobileで閲覧性が低い高度な診断面は、内容を欠落させず折りたたみまたは専用詳細viewへ分離する。

## 10. Non-goals for the first implementation

最初の実装では次を目的にしない。

- provider billing portalの完全再現
- 高度なBI query builder
- 任意SQL相当のanalytics
- 全eventの永久保存
- 全ユーザー本文の長期保存
- 管理者によるユーザーデータ編集
- feature flag / quotaのwrite UI
- AIによる自動的な障害修復

## 11. Acceptance criteria

console全体の完成時には、管理者が専門用語を知らなくてもサービス全体の利用状況を理解できる必要がある。

Overviewから異常を見つけ、Users / AI/API / Planning Analyticsへ移動し、必要であればuser → session → request/traceまで数クリックで掘り下げられる必要がある。

また、同じ障害についてDebug Bundleを生成し、そのJSONだけでAI/agentが主要な内部状態と失敗境界を把握できる状態を目標とする。