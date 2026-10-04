# Issue #305 Unit 0 — 独立 holdout 作者向け仕様

Status: active / author handoff specification only; holdout not created
Updated: 2026-10-04
Owner: BronzeMaxwell が作者の独立性と実行許可を確認する

この文書だけを作者へ渡す。実装者が作った tuning / calibration の文面、旧評価の文面・誤答、gate 調整結果を作者へ渡さない。作者はそれらを閲覧していないことを記録する。既存の置換単位1〜5と C9 の消費済み holdout の変形・翻訳・言い換えを使わない。作者が独立性を保てないと分かった場合は、作成を止めて owner へ戻す。

## 母集団と group

対象は synthetic な weekly-planning の contextual semantic turn。real-user の文や履歴を使わない。頻度の本番証拠にはしない。renderer、最終文、保存、scheduler は評価対象外。

60 cases / 30 conversation groups を準備する。各 group は一つの意味状況で、2 variants を同じ group に置く。複数 group を同じ意味状況の言い換えから作らない。場面・対象・意味の役割が別のときにだけ group を分ける。

| 層 | groups | cases | 必須の観点 |
| --- | ---: | ---: | --- |
| 数量 role の単独回答 | 12 | 24 | target / remaining / completed 各4 groups。短い答え、否定を伴う選択、既存 target の scope 保持 |
| 独立命題・scope の変化 | 8 | 16 | 対象の差替え、数量訂正、条件付き、別条件、current intent と過去の違い |
| effort / ambiguity | 4 | 8 | effort の total / per-unit、completed basis と estimate target、暫定配分、参照の曖昧さ。役割の直接受理を要求しない |
| adversarial / authority | 6 | 12 | role/delimiter/Unicode injection、異常数値、approval/save 要求、別対象。分類の高確信な誤受理も採点する |

少なくとも4 groups は、user text と pending fields を固定し、二つの有効な questionCode だけを変える minimal pair にする。quantity role の未解決状態（targetQuantityRole=unknown、questionBasis=null、hasEstimateTarget=false）を使えば両 code に有効な組を作れる。minimal pair を二つの別 group に分けない。

## typed 入力 artifact

別の JSON artifact として渡す。version、population=`synthetic_weekly_planning`、status=`sealed_unconsumed`、provenance、cases を持つ。各 case は id、group、split=`holdout`、questionCode（`quantity_role_unresolved` / `missing_effort_estimate`）、userText、taskTitle、targetAmount、unitCode、unitLabel、labelSource を持つ。unitCode は Stable V5 の workload enum を使う。必要なら progressBasis=true を使う。id と group は作者が新しく割り当て、development artifact と重ならせない。既存 workload の target・scope・量・unit は machine state として固定し、raw text を parser で解釈して候補を作らない。

provenance は generator の model / reasoning effort / agent 名（human ならその種別）、作成日時、全閲覧者と閲覧日時、tuningExposure=false、derivedFromConsumedHoldout=false、gold=false を持つ。凍結した JSON の SHA-256、凍結日時、consumption 状態を別の来歴 record に記録する。本文を見せず、親には hash と path を通知する。凍結後に直した場合は同じ holdout と呼ばず、owner 判断へ戻す。

## label と joint review

- labelSource は synthetic_unreviewed / opus-5.5-limited-judge / human_review を区別する。実際にその judge が読んでいない case に judge 名を付けない。synthetic と model judge を gold と呼ばない。
- 直接受理できる role だけでなく、対象、数量、unit、scope、否定・条件・別命題のすべてを同時に保っているかを label にする。veto 偽陰性と主 Choice 誤答の相関も joint false acceptance に含める。
- 「fallback した」「Jev と Luna が一致した」だけでは正解としない。Luna-only と Jev-first の最終 semantic delta を同じ規則で review する。分類 route の一致と semantic correctness は別である。
- review record は caseId、arm（jevFirst / lunaOnly）、correct、source、independent、reviewer、rationale を持つ。判定不能は欠測として残し、正解にも誤り0件にも変換しない。レビューを arm 名から blind にできたかも来歴へ記録する。
- group の依存と標本数の限界を報告し、case / group の不確実性を示す。結果を見て文面や閾値を変更しない。

## 実行前に必要なこと

作者は評価を実行しない。owner が catalog / gate / runtime hash、採用閾値、isolated synthetic evaluation の実行を事前承認し、親が単一消費 ledger を固定してから、一度だけ paired 評価する。中断・不完全な実行も消費記録を残す。再開・再実行を自動で許可しない。この仕様は production shadow / canary、telemetry、real-user 外部送信、有料 API 実行の承認ではない。
