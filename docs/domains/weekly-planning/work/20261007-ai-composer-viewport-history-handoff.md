# AI入力時のviewportと会話履歴の表示

Status: active local checkpoint
Updated: 2026-10-07 23:33 UTC

Parent: [Weekly Planning active work](README.md)

この文書は本修正の作業記録である。Issue作成の初回エラーは原因未確定だった。新しい公開・main反映の承認後に許可された1回の再試行も、`user cancelled MCP tool call` で終了したため、それ以上のIssue作成は停止する。直前の検索とrecent issues一覧に同scope Issueはなく、作成成功を確認できていない。Issue作成の停止は、修正依頼の取消しではない。今回の修正・PR公開・main反映は承認済みで、修正作業と検証はこのローカルcheckpointで継続する。main統合は統合担当が行う。

## 問題
AI計画で入力欄をタップして入力しようとすると、入力欄へ画面が寄り、前までの会話が見えなくなる。入力中も履歴を読める可視領域とスクロールを維持する。

ユーザーの報告画像と現行実装を照合して調査する。報告は確認済みだが、画像のみで自動ズーム・キーボードの表示領域変更・スクロール位置移動のどれが主因かは断定しない。添付画像の私的な会話内容はIssueへ転記しない。

## 既存ownerと境界
- #193 / PR #194: mobile入力のフォーカス前font-size、composer幅、入力後の再フォーカスの修正履歴。Issueは完了、PRはmerged
- #209 / PR #210: アプリ全体の自動input focus撤去と16px方針。Issueは完了、PRはmerged
- open/closed Issue・PR、remote branch、#488の最新checkpointを確認し、本件のactive viewport/layout ownerは見つからなかった
- #488は意味解釈・会話継続とprovider E2Eの別owner。本件ではsemantic、履歴供給量、PlanningState、保存仕様を変えない

現行 src/styles/ai-planning-page.css はshell高さに100dvhを使う。既存 tests/e2e/ai-planning-attachment-mobile.spec.mjs は入力前後の16px・横幅・操作ボタンの包含を検証するが、keyboardによる可視領域縮小時の会話の高さ/到達性は検証していない。これだけでは原因の確定ではない。

## 実装checkpoint — 2026-10-07 23:27 UTC
- classification: active implementation
- 実装方針: VisualViewportの縮小とoffset/panへAI専用shellが追従し、通常のpinch zoom中は追従しない。会話の下端anchorと、過去メッセージを読んでいる位置を区別して保持する。body/rootのscroll lockとsemanticは変更しない。これは候補方針であり実装・検証済みの宣言ではない。
- branch: fix/ai-composer-viewport-history
- base / 着手時HEAD: 3a1e60b913e4258cb982dc836afe343ca7331a44
- PR: 未作成
- scope: 明示tapで入力した時のviewport/layoutとconversation scroll、解除後の復帰
- next: 報告画像を視認し、viewport/keyboardとscroll ownerを切り分け、最小修正と回帰を追加
- 未検証: baselineの同条件再現、修正候補、実ブラウザ・実機、公開後挙動

## 受入条件
- [ ] 入力欄へ明示tapしてkeyboardが開いても、既存会話を読める領域を確保し過去メッセージへスクロールできる
- [ ] composerと送信操作が可視領域内にあり、画面全体や背景が意図せず飛ばない
- [ ] 入力の解除・keyboardの開閉・繰り返しfocus・画面切替でレイアウトやscroll制御が残らない
- [ ] 長い会話と複数行入力、短い/長いmobile画面、PCの既存レイアウトを確認する
- [ ] フォーカス前16px・手動pinch zoom・自動input focus禁止の既存方針を維持する
- [ ] exact diff、focused tests、最終verify、該当browser/visual gateを確認し、合成viewport・WebKit・実機の証拠を区別する
- [ ] 公開・mergeが承認された場合はexact-head CIと反映後の確認を追跡し、公開状況を記録する

実keyboardを伴わないheadless focusやviewport模擬だけで実機完了とは報告しない。未検証箇所は残し、既存contractを緩めて成功扱いにしない。

## 実装・focused検証 — 2026-10-07 23:38 UTC

### 切り分けと変更
- 添付画像を実視認し、入力欄・キーボード・見えなくなった履歴領域を確認した。画像だけで履歴データ喪失とは判定しない。
- 自動ズーム説: 入力前から16pxを適用する既存契約があり、今回その仕様は変えていない。実機のzoom値は未取得。
- 自動scroll説: 既存の会話末尾scrollはチャット切替・メッセージ数・処理状態などに依存し、focusや文字入力自体を依存に含まない。本修正はその契約を変更しない。
- 可視viewport説: 従来の100dvh外枠はVisualViewportの縮小・offset/panを扱っていなかった。今回の修正対象とするが、同条件の実機baseline再現は未実施。
- AI専用shellの高さ・上端をVisualViewportに合わせ、ナビゲーションも同じshellの下端へ配置する。通常入力のfocusは操作しない。body/rootのscroll lockは変更しない。
- 変更前に会話末尾を読んでいれば末尾、過去の会話を読んでいればscrollTopを保つ。pinch zoom（scale != 1）中はレイアウト寸法を書き換えない。画面終了時はlistenerと専用CSS変数を復元する。

### 証拠の範囲
- source base/HEAD: `3a1e60b913e4258cb982dc836afe343ca7331a44` 上の未commit差分。production 3ファイル、新hook unit、新E2E、cross-browser設定を変更。
- Node `v24.19.0`、npm `11.9.0`、Vitest `3.2.7`、Playwright `1.62.1`。既存依存treeの237個の実インストールversionをlockと照合し、不一致0・必須欠損0。package/lockは変更なし。
- lock SHA-256: `0cc1f34fa1ead88aab107a9cd1f91e00575d514d45406a5ec452d98b71bfdbb5`。
- code/test/manifestのpath→SHA-256辞書（key順ソートJSON）のaggregate: `f830431ac83fde92b24d238359c77ed7293257f58c91ff0c0e226e4e19eab57b`。対象はhook実装/unit、Legacy view、ai-planning-page.css、新composer E2E、cross-browser config、package.json、package-lock.json。文書自身と生成cacheは含めない。
- `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/hooks/useAiPlanningViewport.test.tsx src/components/AiPlanningView.persistence.test.tsx src/components/AiPlanningView.imageOwnership.test.tsx src/components/AiPlanningView.moduleRecovery.test.tsx --maxWorkers=2 --minWorkers=1 --configLoader native`: exit 0、4 files / 73 tests passed。
- `npm run typecheck:app`: exit 0。`DEV_LAN_HOST=127.0.0.1 WRANGLER_SEND_METRICS=false npm run typecheck:worker`: exit 0、runtime types再生成済み。Wrangler既定ログ先への非fatal書込警告あり。以後はworktree内のWRANGLER_LOG_PATHを使う。
- source-only `input-focus-policy` guard: browser/webServerを起動しない専用一時configで実際の既存testを実行し1 passed。viewport zoom lock / input auto-focusの追加なし。
- 新E2E: syntax check exit 0、Chromium 6件 / WebKit-mobile 6件を収集済み。viewport模擬と実ブラウザ実行は別であり、収集をpass扱いしない。
- 新E2Eの範囲: 360/390/402px幅、keyboard相当のheight/offset変更、履歴読返し、複数行draft、繰返し開閉、画面切替、zoom、desktop keyboard操作、preview背景lockとviewport変更の交差。既存input focus policyのbrowserケースも最終gate対象。
- 独立reviewでは確定runtime blocker未発見。指摘されたWebKit収集漏れ、desktopのmobile設定継承、preview lock交差の検証gapを修正した。reviewは実ブラウザ成功を意味しない。

### 次と未完了
- 統合ownerが直前のmain/他修正を非破壊統合し、正規`npm run verify`、exact-head browser/cross-browser gateを実行する。共有Viteの一時cacheは依存package変更と区別し、package version/lock/sourceを前後で照合する。
- ローカルChromiumの既知socket EPERMは同条件で再試行・迂回しない。ブラウザ確認は承認済み公開後のCIへ引き継ぐ。
- 実iPhoneのキーボード/pan/IMEとpinch操作は未検証。合成VisualViewportやWebKit headlessだけで実機修正完了とは報告しない。
- PR/main反映の承認はあるが、現時点でpush/PR/mergeは未実行。merge操作は統合ownerが担当する。Issue作成cancelは別操作として停止を維持する。
