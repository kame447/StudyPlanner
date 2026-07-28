# PR #95後の週間計画trace entry取得障害 再調査と修正記録

調査日: 2026-07-29（Asia/Tokyo）

対象Issue: #89

対象branch: `agent/trace-production-recovery`

## 結論

`docs/ai/audits/20260728-weekly-planning-trace-missing-after-pr94-investigation.md`の初版、訂正版、現在のmain版を再確認した。

初版は、実際に観測できたのがStable V5 trace remote write全体のwarningであるにもかかわらず、`/append`失敗を確認済みとして扱い、raw admin response未取得のままempty-session filterを0件表示の直接原因としていた。この2点は過剰断定だった。

mainの訂正版は、停止境界をremote write完了前のどこかへ戻し、`/session/start`と`/append`を未確定として分離し、empty-session filterの直接関与を強い推定へ下げている。この訂正は妥当である。

ただし、同報告はPR #94直後のProduction保存障害を扱ったhistorical reportであり、PR #95後に観測された症状の説明には直接使えない。現在は管理画面が`turns 6 / entries 256`のsession metadataを取得できているため、当該sessionの保存と`/admin/sessions`は成功している。一方、session展開時のentry本文取得だけが失敗している。観測できた停止境界は`/weekly-planning-trace/admin/entries`である。

## 原因評価

旧frontendは`/weekly-planning-trace/admin/entries`を1回だけ呼び、sessionの全entryを単一responseで受け取っていた。

旧Workerはsessionの`entryCount`を最大500まで読み、queryで回収できなかったsequenceごとにFirestore document GETを実行した後、取得した全entryをredactionして単一JSON responseへ載せていた。256-entry sessionでは、query結果やdocument状態によって多数のFirestore GET、redaction、serialize、response生成が1requestへ集中し得る。

frontendで観測された`trace_network_failure`相当の文言は、通常のHTTP error envelopeではなくfetch自体がresponseを受け取れなかった場合に生成される。したがって、旧全件取得経路がWorkerのresourceまたはruntime境界で中断した可能性が最も高い。ただし、旧endpointの実環境response、Worker invocation log、subrequest数は取得できていないため、これを実証済みの単一根本原因とは扱わない。

一方、管理画面の表示上の契約違反はコードから確定した。`listEntries`が失敗してもsession単位の失敗状態を保持せず、空配列のまま`entryはありません。`と空Raw JSONを表示していたため、通信失敗を正常な0件として誤表示していた。

## 修正

既存の全件取得endpointは後方互換用に残し、追加endpoint `/weekly-planning-trace/admin/entries/page`を実装した。

新endpointはsequenceをcursorとして扱い、1requestにつき最大20 documentだけを取得する。session metadataの`entryCount`が256でも、1request内のentry GETは20件を超えない。欠落documentがある場合もpage末尾までcursorを進め、同じ欠落sequenceを無限再試行しない。

frontendにはpaginated admin repository decoratorを追加した。20件ずつ最大500件まで集約し、総件数のpage間変化、page上限超過、cursor非進行、不正な欠落件数、不正schemaをfail closedで拒否する。Workerが欠落documentを報告した場合は残存entryを最後まで確認するが、部分的なtimelineやJSONを正常結果として返さず、最終的に取得失敗とする。

未更新Workerが新endpointを`404 / trace_endpoint_not_found`で返す場合に限り、既存の全件endpointへfallbackする。それ以外の404、認証失敗、storage失敗、contract mismatchではfallbackせず、その失敗を保持する。

管理画面はsessionごとのentry取得errorを保持するよう変更した。取得失敗時は`entryはありません。`とRaw JSONを表示せず、`entry取得失敗`と再試行操作を表示する。JSON exportは全entryの取得に成功した場合だけ実行し、取得失敗時はarchiveしない。

さらに、session一覧を`未export`、`アーカイブ済み`、`Empty`の3区分へ変更した。アーカイブ済みsessionはFirestoreから削除せず、`archivedAt`が最後の活動以降である間はアーカイブ済み一覧へ表示する。そこからConversation、Events、State snapshots、Raw JSONを再表示し、archive状態を変更せずJSONを再エクスポートできる。archive後に新しいactivityが追加されたsessionは未export一覧へ戻り、再エクスポート時に`archivedAt`を更新する。empty sessionの既存export・archive動作も維持する。

Worker revisionを`weekly-planning-trace-20260729-002`へ更新した。contract versionは既存endpointを破壊しない追加変更であるため`2026-07-28-v2`を維持する。

## 追加test

frontend testでは、実症状と同じ256 entriesを20件以下の13 pageへ分割して全件集約できること、欠落entryがある場合に部分結果を拒否すること、page間で総件数が変化した場合に拒否すること、cursor非進行を拒否することを固定した。

archive判定testでは、未archive session、empty session、活動の一部だけが保存されたsession、archive済みで新規activityがないsession、archive後に新規activityがあるsessionを分離した。これにより、archive済み一覧へ表示する条件と未export一覧へ戻す条件を固定した。

Worker testでは、`entryCount=256`かつ要求limitが100でも1pageのFirestore GETが20回に制限され、次cursorが19になること、2page目が20から39まで進むこと、欠落documentを数えながらcursorを進めることを固定した。

## 検証結果

Cloudflare Pagesの同一build環境で、一時的にbuild commandへ次の4工程を直列化して実行し、アーカイブ済み一覧・再エクスポート・empty session回帰修正を含むcommit `af86f9d`で成功した。

```text
npm run typecheck
npm run typecheck:build
npm run test:run
vite build --config vite.config.mjs
```

検証後は`package.json`の通常build commandへ戻した。通常のVite buildはcommit `1d14af2`で成功している。GitHub Actionsはrunner起動前に終了してstepsが0件だったため、成功証跡には使用していない。

## 残るdeploy gate

source修正だけではProductionは直らない。`workers/ai-proxy/wrangler.jsonc`を使用してWorkerをdeployし、その後Pagesを更新する必要がある。

Productionでは認証済みhealth probeでcontract version、Worker revision、CORS response headersを確認する。その後、既存の256-entry sessionを展開し、Conversation、Events、State snapshots、Raw redacted JSON、JSON exportの各経路を確認する。`/admin/entries/page`が複数回200を返し、各responseのentry数が20以下で、最後のcursorがnullになることも確認する。

加えて、export後にsessionが未export一覧からアーカイブ済み一覧へ移動し、アーカイブ済み一覧から同じentryを再表示・再エクスポートできることを確認する。再エクスポートでは`archivedAt`が変更されないこと、archive後に新規activityが追加された場合は未export一覧へ戻ることも確認する。

Issue #89はProductionで既存sessionを完全に取得・表示・export・再表示できるまでOPENを維持する。PR #96もWorker deployとProduction確認が終わるまでDraft・merge不可とする。
