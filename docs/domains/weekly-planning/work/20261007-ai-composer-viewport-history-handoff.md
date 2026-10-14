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

## 公開後のfixture修正 — 2026-10-08 00:20 UTC

- 公開先: [PR #537](https://github.com/kame447/StudyPlanner/pull/537)、初回remote HEAD `db4c41eb69bb8cd1ba702db02a8155fe58013726`。親は#536の`d824af492b2007a10482c4991d57b35d7778b0d0`、treeは統合local HEAD `4dcd573252b1cde68bca2afbd0d4a52c9791d72b` と同じ `2f7f21674ae8688e00c8ee6d27e6e96d480eb2f8`。
- この統合treeの正規verifyは758 files / 6,132 passed / 45 skipped / 1 todo、fresh型/build/bundle guards成功。初回CI/Quality/Admin/visualも成功したが、[Browser Regression run 37705434154](https://github.com/kame447/StudyPlanner/actions/runs/37705434154) は381 passed / 4 failedで不合格。
- 3幅とも初回`input.tap()`（旧line109）で`element is outside of the viewport`、preview caseは初回open（旧line181）で同理由。24 messagesと末尾位置の確認は通過済みで、keyboard縮小操作より前に失敗していた。関連#538の同fixture失敗画像も、履歴が存在しcomposerが画面外へ押し出された状態を示す。
- 原因分類: E2E harness。`addInitScript`はviewport meta適用前に動き、mobile初期layoutの`window.innerHeight`をmockが固定していた。新fixtureは`page.viewportSize().height`を明示的に渡す。production sourceは変更しない。日付seed・メッセージ件数・containment・focus契約・timeoutは緩めない。
- actual fixture関数をNode VMで評価し、初期innerHeightを2122とした反証: 旧版はrunner指定640/844/874/900の全例を2122に固定、新版は各指定値に一致。これはfixture入力検証でありbrowser成功の代替ではない。
- 初期shell高さとcontainmentのassertionを追加。keyboard縮小時の成功画像をoutputPathへ保存しattach(path)する。次のexact-head browserで修正と実geometryを再検証する。
- 本修正後のfull/CIはこれから再実行する。初回失敗を隠さず、同branch/PRで継続する。main mergeは統合ownerのみ。

## WebKit scroll fixture修正 — 2026-10-08 00:54 UTC

- local `503c0779aef962285f8821665703ce14dd428599` / remote `16c8d36e7c5e2283b89472287558f106f2716be4` / tree `d1ccaa8abf791ff1f7b789bc0b436f299344ba08` はAPIで完全一致を確認した。clean worktreeの正規 `npm run verify` exit 0（758 files / 6,132 passed / 45 skipped / 1 todo、fresh app/Worker型、build）、8 bundle guards成功。Node24.19.0 / Vitest3.2.7、237実依存とlock前後一致、依存変更なし。中断した直前のfullは成功扱いにしていない。
- このheadの [Browser Regression 37708682319](https://github.com/kame447/StudyPlanner/actions/runs/37708682319) は385 passed。初回tap、3幅のkeyboard/pan/typing/履歴読返し、preview解除、desktopの6新規ケースを含め成功した。CI・Quality・Admin・visual比較も成功。
- [Matrix 37708682364](https://github.com/kame447/StudyPlanner/actions/runs/37708682364) は195 passed / 4 failed / 3 skipped。失敗はすべて新AIケースの `Mouse wheel is not supported in mobile WebKit`。初期containment・keyboard相当縮小・末尾表示は通過し、3幅の成功画像を保存した。インストール済Playwright1.62.1の実コードでもmobile WebKitのwheelが無条件throwであることを照合した。
- 原因分類はharness capability。WebKitをskipする案はcoverageを失い、keyboardでscrollする案は入力focusを移すため、本来の保持契約を検証できない。WebKit-mobileだけDOMのreader-position境界を設定し、Chromiumは実wheelを残す。overflow-y:autoと実scroll rangeを追加確認し、先頭message視認・入力focus・typing/pan後位置保持・解除後の復帰という元のassertionを維持した。
- 実helperのNode VM probeはmobile WebKitの境界設定、Chromium mobileとWebKit desktopのwheel維持、overflow:hidden/scroll rangeなしの拒否の5例が成功。syntaxとChromium/WebKit-mobile各6件の収集が成功。これはbrowser実行成功の代わりではない。
- 今回の差分はこの文書と独立E2Eファイルのみ。runtime・unit・型・build入力の同一性と237依存/lockを再照合し上記full証拠を再利用する。変更したE2Eは新exact-head CIで全gateを実行して再検証する。WebKit実touch gesture、実iPhone keyboard/pan/IMEは未検証のままである。
