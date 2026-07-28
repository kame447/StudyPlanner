# PR #95後の週間計画trace entry取得障害 再調査と修正記録

調査日: 2026-07-29（Asia/Tokyo）

対象Issue: #89

対象branch: `agent/trace-production-recovery`

## 結論

`docs/ai/audits/20260728-weekly-planning-trace-missing-after-pr94-investigation.md`の初版、訂正版、現在のmain版を再確認した。

初版は、実際に観測できたのがStable V5 trace remote write全体のwarningであるにもかかわらず、`/append`失敗を確認済みとして扱い、raw admin response未取得のままempty-session filterを0件表示の直接原因としていた。この2点は過剰断定だった。

mainの訂正版は、停止境界をremote write完了前のどこかへ戻し、`/session/start`と`/append`を未確定として分離し、empty-session filterの直接関与を強い推定へ下げている。この訂正は妥当である。

GitHubの到達可能なmain履歴では、報告書追加commit `bab6eb0`と訂正commit `e62b06b`を確認できた。提示された追加の`+1/-1`差分は到達可能なmain履歴から特定できなかったため、存在を推測せず、現在のmain本文を最終版として監査した。

ただし、この報告書はPR #94直後のProduction保存障害を扱ったhistorical reportであり、PR #95後の現在の症状を説明する根拠にはならない。現在は管理画面が`turns 6 / entries 256`のsession metadataを取得できているため、trace writeと`/admin/sessions`は少なくとも当該sessionについて成功している。一方、session展開時だけ`週間計画traceサーバーへ接続できませんでした。`となる。現在の停止境界は`/admin/entries`取得である。

## 現在の根本原因

frontendは`/weekly-planning-trace/admin/entries`を1回だけ呼び、sessionの全entryを単一responseで受け取る。

Workerはsessionの`entryCount`を最大500まで読み、queryで回収できなかったsequenceごとにFirestore document GETを`Promise.all`で実行する。その後、取得した全entryをredactionして単一JSON responseへ載せる。

今回のsessionは256 entriesである。この経路は、query結果が部分的な場合には1request内で最大256件のFirestore subrequestを発生させ得る。queryが全件返っても、最大48KiBを目標とするdebug entryを256件まとめてredaction・serialize・response化する。どちらもWorkerのresource/runtime境界を超えてrequest自体が中断する余地がある。

通常のHTTP error responseを受けた場合、frontendはstatusとerror codeを保持する。今回表示された`trace_network_failure`相当の文言はfetch自体がresponseを受け取れなかった場合に生成されるため、Worker実行中断という観測と整合する。

管理画面には別の表示上の契約違反もあった。`listEntries`が失敗してもsession単位の失敗状態を保持せず、空配列のまま`entryはありません。`を表示していた。そのため、通信失敗を正常な0件と誤認させていた。

## 修正

既存の全件取得endpointは後方互換用に残し、追加endpoint `/weekly-planning-trace/admin/entries/page`を実装した。

新endpointはsequenceをcursorとして扱い、1requestにつき最大20 documentだけを取得する。session metadataの`entryCount`が256でも、1request内のentry GETは20件を超えない。欠落documentがあってもcursorはpage末尾まで進め、無限再試行しない。

frontendにはpaginated admin repository decoratorを追加した。20件ずつ取得して最大500件まで集約し、cursorが進まない場合とpage数超過をfail closedで拒否する。未更新Workerが新endpointを404で返す場合に限り、既存の全件endpointへfallbackする。

管理画面はsessionごとのentry取得errorを保持するよう変更した。取得失敗時は`entryはありません。`とRaw JSONを表示せず、`entry取得失敗`と再試行操作を表示する。session一覧取得のglobal errorとentry詳細取得のsession-local errorも分離した。

Worker revisionを`weekly-planning-trace-20260729-002`へ更新した。contract versionは既存endpointを破壊しない追加変更であるため`2026-07-28-v2`を維持する。これにより、PagesとWorkerのdeploy順序が一時的に前後しても既存機能を直ちに全面停止させない。

## 追加test

frontend testでは、実症状と同じ256 entriesを20件以下の13 pageへ分割し、全件を一度ずつ集約できることを固定した。欠落entryがある場合の継続と、進まないcursorの拒否も確認対象にした。

Worker testでは、`entryCount=256`かつ要求limitが100でも、1pageのFirestore GETが20回に制限され、次cursorが19になる契約を固定した。2page目が20から39まで進むことと、欠落documentを数えながらcursorを進めることも確認対象にした。

## 現時点の検証

新しいWorker page loaderは、256件のsessionでも1pageあたり20 documentだけを読み、次cursorを19にする単体実行を確認した。frontend collectorは256 entriesを13 pageで重複なく集約する単体実行を確認した。新規frontend moduleとWorker moduleはstrict TypeScriptの分離検査を通過した。

Cloudflare Pagesのbranch previewは最新UI修正を含むheadでbuild成功した。一方、GitHub Actionsはrunner起動前に終了してstepsが0件であり、full test、repository全体のtypecheck、typecheck:buildをGitHub Actionsの成功証跡としては取得できていない。

## 残るdeploy gate

source修正だけではProductionは直らない。`workers/ai-proxy/wrangler.jsonc`を使用してWorkerをdeployし、その後Pagesを更新する必要がある。

Productionでは既存の256-entry sessionを展開し、Conversation、Events、State snapshots、Raw redacted JSON、JSON exportの各経路を確認する。`/admin/entries/page`が複数回200を返し、各responseのentry数が20以下で、最後のcursorがnullになることを確認する。

Issue #89はProductionで既存sessionを展開できるまでOPENを維持する。
