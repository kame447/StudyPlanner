# Repository refactoring patterns

Status: current repository-wide refactoring knowledge
Updated: 2026-08-30

この文書は、StudyPlanner で過去のバグ・修正・リファクタリングから繰り返し確認された「壊れやすい構造」を形式知化するための正本です。

[`regression-patterns.md`](regression-patterns.md) が「どう壊れたか」を原因クラスとして整理するのに対し、この文書は「どの構造が、その壊れ方を生みやすいか」「どの時点で局所修正からリファクタリングへ昇格すべきか」を扱います。

この文書は各 domain の仕様書を置き換えません。現在の振る舞い・責任境界は必ず owning domain の canonical document を優先します。ここに書くのは repository-wide に再利用できる構造的判断だけです。

## 使い方

バグ調査では、まず `regression-patterns.md` で症状と既知の回帰クラスを照合します。原因が単一の実装ミスではなく、同じ責任の重複、依存方向の逆流、状態の二重管理、互換経路の並存などにある場合、この文書の refactoring pattern へ照合します。

局所修正で invariant を回復でき、責任境界も一意なままなら、無理にリファクタリングへ昇格しません。一方、同じ原因で複数箇所に修正が必要、同型バグが再発、修正するたび別レイヤーへ条件分岐が増える、テストが内部実装を知りすぎている、といった兆候がある場合は構造問題として扱います。

重要なのは「ファイルが大きい」「コードが長い」「抽象化できそう」という理由だけでリファクタリングしないことです。責任、authority、dependency direction、state lifecycle、testability、migration safety のいずれかを明確に改善できる場合にだけ実施します。

---

## F1. Multiple authority / responsibility duplication

優先度: Critical。
関連 regression: R1 Semantic / state authority drift、R4 Temporal reference context drift。
代表 evidence: PR #3, #68, #107, #109, #196, #202, #204, #225, #235。

### Trigger

同じ概念を複数の層が独立に解釈・決定している。たとえば semantic/compiler と scheduler の両方が日付意味を解釈する、AI output と deterministic parser が同じ自然言語意味を再判定する、表示中の projection と canonical model の両方を保存対象として扱う、など。

### Risk

一方だけを修正しても別 owner が古い規則で上書きするため、局所修正が効かないか、別経路で再発する。removed / superseded state の復活、relative date のずれ、環境ごとの挙動差につながる。

### Preferred direction

一つの概念に一つの authoritative owner を定め、下流には typed / compiled representation だけを渡す。projection、renderer、cache、read model は authority を持たない。raw input の再解釈を downstream から除去する。

### Verification

architecture guard、dependency test、production-shaped regression で、禁止レイヤーが raw semantic input や presentation output を参照できないことを確認する。

---

## F2. Lifecycle mutation without dependent-state policy

優先度: Critical。
関連 regression: R2 Correction lifecycle、R5 stale result / revision、R6 persistence / restore。
代表 evidence: PR #87, #88, #109, #146, #147, #149, #151, #157, #204, #235。

### Trigger

replace / remove / supersede / revoke で primary entity だけを更新し、そこから派生した facts、preview、remaining work、memory projection、cache、persistence record の扱いが各所の ad-hoc 条件分岐になっている。

### Risk

訂正直後は正しく見えても、readiness、scheduler、save、reload など後段で旧値が復活する。新しい Fact kind を追加するたび migration code が漏れる。

### Preferred direction

lifecycle transaction の境界を一つにし、dependent state を carry / invalidate / rebind / reject の明示 policy に分類する。新しい dependent kind を追加したとき exhaustive に扱われる型・policy table を使う。

### Verification

訂正→preview→save→reload までの end-to-end lifecycle を通す。古い active entity が残らないことだけでなく、derived state が再構成された後にも復活しないことを確認する。

---

## F3. Primitive / nullable state compression

優先度: Critical。
関連 regression: R3 Typed dimension conflation、R10 target scope leakage。
代表 evidence: PR #140, #148, #150, #154, #157, #195。

### Trigger

独立した状態軸を `boolean`、`null`、`any exists`、単一 enum に潰している。`duration_per_unit` と `session_duration`、absent と complete、task-level と component-level などが同じ判定経路に入る。

### Risk

新しい状態を追加するたび if 文が増え、既存ケースとの排他関係が崩れる。複数 task / sibling component / zero-value のケースで誤判定しやすい。

### Preferred direction

意味的に独立する軸は discriminated union、typed identifier、reason code、target scope として保持する。`null` に複数の意味を持たせない。

### Verification

table-driven / property-based test で軸の直積を検証する。特に zero / absent / complete / unknown、複数 sibling target、異なる measurement kind の共存を含める。

---

## F4. Context propagation by implicit fallback

優先度: Critical。
関連 regression: R4 Temporal reference context drift、R13 deploy/runtime boundary。
代表 evidence: PR #24, #26, #99, #120, #199, #202, #204, #225。

### Trigger

request date、timezone、weekStartsOn、environment、active term、auth context など、本来 upstream で確定している context を下流が optional fallback で再生成している。

### Risk

テストでは既定値で通るが、本番の異なる日付・timezone・週開始曜日・environment でずれる。複数段階で fallback が連鎖すると原因箇所が特定しにくい。

### Preferred direction

context を typed boundary の必須入力として伝播し、意味を決定した地点より下流で再生成しない。fallback は migration / compatibility の明示経路だけに限定し、通常経路から除去する。

### Verification

既定値と異なる context を必ずテストする。request date と horizon start が異なる、Sunday-start、非既定 timezone、term 境界などを固定ケースにする。

---

## F5. Async operation state split across UI and domain layers

優先度: Critical。
関連 regression: R5 Idempotency / stale result / concurrency、R6 persistence / restore。
代表 evidence: PR #82, #88, #94, #96, #109, #119, #121, #220, #222。

### Trigger

pending / completed / canceled / stale の判断が UI component、hook、controller、repository に分散している。UI の disabled state と domain の idempotency guard が別々の条件で動く。

### Risk

double submit、late result の復活、modal close 後の再表示、revision poisoning、二重保存が起こる。UI guard だけでは programmatic / keyboard / race activation を防げない。

### Preferred direction

operation identity、revision、pending state、cancel token、commit point を domain/application boundary で一元管理し、UI はその状態を表示する。side effect は idempotent にする。

### Verification

同一 browser task 内の二重 activation、cancel 後の late completion、close/reopen 中の pending、retry、reload を含む race test を実施する。

---

## F6. Projection used as persistence source

優先度: Critical。
関連 regression: R1 authority drift、R6 persistence / restore、R11 partial read / bounded query。
代表 evidence: PR #109, #157, #196, #220, #222, #234。

### Trigger

画面に表示している現在ページ、filtered list、bounded read model、rendered text、summary を保存・再計算の source にしている。

### Risk

画面外のデータが消える、pagination で全体値を誤推定する、reload 後だけ不整合になる、unknown を zero と誤認する。

### Preferred direction

canonical model と projection を分離し、保存・集計・authority decision は canonical model または明示した server-side read model から行う。projection は再生成可能にする。

### Verification

複数 page、filter 前後、reload、empty / unknown / partial data、30日境界などで canonical total と UI projection が混同されないことを確認する。

---

## F7. Compatibility path becomes a second runtime

優先度: High。
関連 regression: R1 authority drift、R9 migration/version skew、R13 deploy/runtime boundary。
代表 evidence: PR #68, #107, #109, #146, #235。

### Trigger

legacy compatibility、migration fallback、old schema support が通常 runtime の decision path に残り、新旧ロジックが並行して意味を決めている。

### Risk

「古いデータを読めること」と「古い runtime を実行すること」が混同され、修正が片方にしか入らない。テスト対象も倍増する。

### Preferred direction

compatibility は read / migration boundary に閉じ込め、canonical representation へ変換した後は単一 runtime を使う。削除時は production、test、persisted-data responsibility が本当に無いことを確認する。

### Verification

legacy fixture を canonical form へ migrate した後、現行 runtime と同じ code path に入ることを確認する。旧 semantic execution が呼ばれない architecture guard を置く。

---

## F8. Cross-target policy duplicated per feature

優先度: High。
関連 regression: R3 typed dimension conflation、R10 scope isolation。
代表 evidence: PR #140, #148, #154, #204, #225。

### Trigger

task / component / sibling、user / actor、term / class、proposal target などの scope 判定を機能ごとに別実装している。

### Risk

task-level inheritance は効くが component sibling へ漏れる、ある画面では active term を使うが scheduler では使わない、といった不一致が起きる。

### Preferred direction

target resolution / inheritance / isolation を共通 policy にし、各 feature はその結果だけを使う。scope rule を presentation component に持たせない。

### Verification

parent inheritance、sibling isolation、複数 target 同時存在、removed target、term 外 target を共通 contract test で固定する。

---

## F9. Mobile interaction ownership collision

優先度: High。
関連 regression: R7 Mobile viewport / overlay / gesture ownership、R12 accessibility semantics。
代表 evidence: PR #167 周辺、AI planning preview、schedule drag、month event editor、bookshelf sheet の各 mobile regression。

### Trigger

sheet drag、timeline drag、page scroll、background scroll、date picker、edge swipe など複数 gesture owner が同じ pointer / touch sequence を処理する。fixed overlay と root viewport の scroll owner も曖昧。

### Risk

iPhone 実機でだけ背景が動く、modal がずれる、tap が親 gesture に奪われる、入力 focus で zoom する、close target が押せないなどが起こる。

### Preferred direction

gesture activation 後の owner を一意にし、background scroll lock、pointer capture、hit target、overlay stacking、viewport units を同じ interaction contract で扱う。単なる z-index 追加で直さない。

### Verification

small iPhone 相当 viewport、tall phone、tablet、touch long-press、short tap、drag cancel、keyboard focus、modal open/close を browser regression と必要に応じ実機 evidence で確認する。

---

## F10. Harness-specific behavior leaks into product assumptions

優先度: High。
関連 regression: R8 Harness vs product classification、R14 integration-only failure。
代表 evidence: Browser Regression / Admin Render / real API audit の複数 follow-up。

### Trigger

test harness、mock、local build、production proxy、GitHub Actions の差を無視し、テストで再現しないことを product correctness の証拠にする。逆に harness failure を production defect としてコード側へ修正する。

### Risk

本番だけ壊れる、不要な product workaround を入れる、test contract を弱める、integration failure を見逃す。

### Preferred direction

失敗を production defect / stale contract / harness defect / infrastructure failure に分類してから修正する。environment boundary を明示し、real browser / real API / post-merge integration を必要な箇所だけ使う。

### Verification

各 gate が何を証明して何を証明しないかを明示する。個別 PR が green でも integration state で再検証すべき契約は main 上でも確認する。

---

## リファクタリングへ昇格する判断基準

以下のうち一つでも強い証拠があれば、局所 bug fix だけで終わらせず refactor candidate として扱います。

- 同じ根本原因が二回以上、別 PR / 別 subsystem で再発した
- 一つの invariant を守るために三箇所以上へ同種条件を追加する必要がある
- authoritative owner を一意に答えられない
- correction / remove / retry / reload のどこかで旧状態が復活する
- 新しい型や状態を追加するたび既存 boolean / null 条件が増える
- test が public contract ではなく private implementation ordering に依存している
- compatibility path が通常 runtime と同じ decision を行っている
- UI projection や rendered text が domain decision の入力になっている

逆に、単一 typo、局所的な off-by-one、独立した CSS 調整、明確な owner 内の単発ロジックミスなどは、構造問題の証拠がなければ無理に refactor へ昇格しません。

## 新規バグ修正の標準フロー

1. 再現 evidence を固定する。
2. `regression-patterns.md` で既知の壊れ方へ照合する。
3. root cause が責任境界・依存方向・state lifecycle の問題なら、この文書で refactoring pattern へ照合する。
4. 局所修正で invariant を回復できるか、構造変更が必要かを反証可能に判断する。
5. refactor する場合は owner contract を先に決め、architecture guard / regression test を先行または同じ PR で固定する。
6. 修正後は症状だけでなく linked regression class が再発しないことを確認する。
7. 新しい再発クラス・構造クラスなら、PR 内でこの形式知を更新する。

## Maintenance rule

新しい entry は、単なる好みや一般論ではなく、StudyPlanner の実際の failure / review / refactor evidence がある場合に追加します。同じ構造なら既存 entry を更新し、似た名前の pattern を増殖させません。

feature-specific な設計判断は owning domain に置き、この文書には repository-wide に再利用できる抽象化だけを残します。
