# PR #130 週間計画 Human Grounding / Dynamic Dialogue Policy

Status: active / mandatory conversation-quality policy for PR #130
Date: 2026-08-15
Branch: `agent/weekly-conversation-quality-luna-audit`
Applies to: Stable V5 weekly-planning dialogue realization, real-API conversation evaluation, and dialogue-related prompt simplification

## 1. 目的

StudyPlanner の週間計画対話を、固定質問を順番に読み上げるフォームではなく、ユーザーとの共同活動として成立する対話へ戻す。

この文書は、特定の日本語表現や会話スクリプトを正解として固定するものではない。むしろ逆に、同じ machine decision であっても、それまでの発話系列、直前にユーザーが与えた情報、共有済みの語彙、その時点で成立している共通基盤に応じて、発話が自然に変化することを要求する。

PR #130 では、モデルを GPT-5.6 Luna へ更新した現在の能力を前提に、弱いモデル向けに蓄積された固定文・表現 heuristic・過剰な renderer bypass を再監査する。deterministic code が所有すべき safety / state / scheduling contract は維持しつつ、「どう言うか」を固定文で支配しない。

## 2. 現在確認されている問題

現在の Stable V5 には、conversation quality の観点で少なくとも次の違反が確認されている。

- `weeklyPlanningStableV5RuntimeQuestions.ts` が、対象 label だけを差し替えた長い固定質問文を生成している。
- 通常の question action が `deterministic_question_bypass` により AI renderer を通らず、その固定文をそのまま利用者へ返す経路がある。
- そのため、数学のワーク、古典の課題など対象だけが変わっても、同じ構文・同じ説明が連続して現れる。
- 直前のユーザー発話から新しい情報を正しく受理していても、その理解を相手に示さず、すぐ次の質問へ移ることがある。
- real-API conversation の入力自体が、ユーザーに必要情報を一度に多く説明させる固定 transcript になっており、「少ししか答えない人間」との逐次 grounding を十分に検証できていない。

これは単なる文体の問題ではない。利用者から見ると、アプリが本当に自分の発話を理解したのか確認できないまま内部状態だけが進み、対話上の共有理解が形成された証拠が欠ける。

## 3. 人間同士の対話から採用する一般原則

本方針は、ユーザーが分析している人間同士のタングラム命名課題の対話と、そこで扱っている grounding / 表象のずれ / 調整過程を設計上の参照とする。

タングラム命名課題では、参加者は最初から対象について完全な記述を交換しない。位置、形状、向き、見立てなどの部分的な手掛かりを出し、相手の反応を受け、その後の発話で参照対象と理解を徐々に合わせていく。扱う論点が変化しても、同じ対象についての共同理解は発話系列を通して更新される。

また、共通基盤は単に「情報が内部状態へ保存された」ことで成立するものではない。相槌、確認、言い換え、反復、受容、同意、適切な後続行為など、相手から観察可能な理解の証拠を交換することで形成・更新される。

完全な表象一致を毎回達成する必要もない。現在の共同活動を進めるのに十分な共有が成立していれば進行できる一方、理解上の問題が重要であれば聞き返し、確認、再説明、訂正などによって修復する。未解決点を常にその場で完全に解消することだけを目的にせず、局所的な理解と progressivity の両方を扱う。

StudyPlanner へ移すのは、タングラム固有の発話や表現ではなく、次の抽象的な性質である。

1. 共通理解は一度の長い説明ではなく、複数ターンの相互作用で形成される。
2. 相手が何を理解したかは、内部状態だけでなく発話上の証拠として適度に示される。
3. ユーザーの発話は不完全・省略的・局所的であることを通常ケースとして扱う。
4. 直前の発話を受けたことを示してから次の共同作業へ進む。
5. 理解が十分なら過剰確認しないが、共有が不十分なら曖昧なまま勝手に進めない。
6. 会話の進行に伴って共有された語彙・呼び方・参照の仕方を利用し、毎回ゼロから説明し直さない。
7. 同じ目的の質問でも、発話系列と共有状態が異なれば自然な表現は変わる。

## 4. 人間を「完全なフォーム入力者」と仮定しない

conversation-quality test では、ユーザーを協力的だが省力的な人間として扱う。

人間は、質問されていない情報まで先回りして体系的に列挙するとは限らない。必要だと思った部分だけを短く答え、省略語、指示語、短答、訂正、後出し情報を使う。場合によっては質問の一部だけに答える。

したがって、real-API evaluation のユーザー役に「最終的に必要な facts を一発話ですべて言わせる」ことを禁止する。アプリが一つの確認をしたなら、その確認に必要な最小限の情報を返し、その結果としてアプリがどう grounding し、次に何を聞くかを観察する。

例文の固定はしない。テスト harness が持つべきなのは、会話開始時の goal、ユーザーが実際には知っている情報の reservoir、性向・制約などであり、次の user utterance の本文ではない。各 user turn は直前の assistant utterance を見た後に、その場で自然に生成または人手選択する。

## 5. 責務境界

### AI semantic layer

AI はユーザーの自然言語と会話文脈から意味を解釈し、current-turn semantic delta を構造化する。

### AI semantic boundary は raw conversation の終端でもある

`AI first, schema next` は、単に AI の解釈を deterministic code より優先するという意味ではない。AI が structured semantic document を返した時点を semantic boundary とし、それ以後の deterministic code へ `userText`、raw conversation、`recentConversation` 本文を意味判断の入力として渡してはならない。

deterministic code が意味入力として受け取ってよいのは、AI が生成した schema 化済み semantic document と、application が所有する typed machine state に限る。raw text の substring 照合、sentence 分割、regex、keyword / dictionary match、token 位置比較などを用いて、target 推定、grounding 判定、quantity role 判定、日付解釈、曖昧性判定、authorization intent 判定を行ってはならない。

必要な不確実性、grounding、target ambiguity、参照候補は AI が schema 内の uncertainty / evidence / reference として表現する。deterministic layer はそれらと既存 typed state の構造整合性、参照整合性、lifecycle、policy invariant を検証し、raw conversation を再解釈して意味を補完または上書きしない。

この禁止は、raw conversation を AI semantic interpreter や AI dialogue renderer へ渡すこと、または意味判断を伴わない bounded logging / display / trace に保持することを禁止するものではない。禁止対象は、AI semantic boundary より後段の deterministic production logic が raw conversation を semantic decision source として利用することである。

### deterministic application layer

deterministic code は以下を所有する。

- schema / evidence / reference validation
- formal binding
- Fact Graph lifecycle / revision / idempotency
- confirmation necessity / question priority
- readiness
- scheduler / placement
- preview / approval / save / persistence
- safety invariant
- observed pace 等の計算結果

「何を確認する必要があるか」は deterministic application decision で決めてよい。しかし、その decision を利用者へどう表現するかまで固定の日本語 template で所有しない。

### AI dialogue renderer

renderer は typed application decision と、会話上必要な grounded context を受け取り、現在の発話系列に合う自然な response を生成する。

renderer は新しい事実、確認要否、schedule、save decision を発明してはならない。一方で、application decision の固定文を読み上げるだけの formatter にもしてはならない。

直前のユーザー発話に対して、理解が成立したことを相手へ示す価値がある場合、短い acknowledgement、確認、言い換え、要点の反映、deterministic に計算された帰結の提示などを自然に組み込み、その後に application decision が要求する次の行為へ進む。

## 6. 固定文に関する原則

通常の対話 turn で、question code ごとの完成済み日本語文章を source of truth にしない。

固定してよいのは、自然言語対話そのものではない contract だけである。例として schema identifier、action identifier、button label、system-level error boundary、accessibility label などがある。

provider failure 等で AI renderer が利用できない場合の最小 fallback は保持してよい。ただし fallback の存在を理由に、正常系まで deterministic fixed response へ bypass しない。

固定 regression test では action kind、question target、required fact、禁止事項などの semantic / application contract を検証する。自然な response の全文一致を正常系の品質 oracle にしない。

## 7. Renderer prompt 方針

production prompt に、特定の返答例、語尾、定型的 acknowledgement、質問テンプレートを列挙しない。

prompt は以下の一般原則だけを伝える。

```text
You are the conversational realization layer for a collaborative planning dialogue.
Maintain a natural ongoing interaction rather than reciting a form or a scripted questionnaire.
Treat each turn as part of progressively building shared understanding with the user.

Respond to what the user has just contributed and make your understanding observable when that is useful for the collaboration.
Use acknowledgement, confirmation, paraphrase, reference to the user's wording, or a grounded consequence only when they naturally help establish shared understanding.
Then advance only as far as the application decision requires.

Assume users usually provide partial, economical, and context-dependent information rather than complete structured reports.
Do not pressure them to provide everything at once. Ask only about the unresolved point selected by the application.
Use the conversation's established wording and context where helpful, and let the realization vary with the dialogue history instead of repeating a stock sentence.

Do not claim understanding that is not supported by the provided state.
If shared understanding is insufficient for the required next action, expose the relevant uncertainty naturally rather than guessing.
Do not over-repair every harmless difference when the current shared understanding is already sufficient for the joint activity.

Do not invent facts, decisions, schedules, confirmations, or completed actions.
The structured application state owns what must be asked or done; your role is to realize that intent as a coherent human-like conversational turn.
```

上記は「この場合はこう返す」という script ではない。grounding、incrementality、partial information、progressivity、non-invention、dynamic realization という一般的な会話原則だけを与える。

日本語版へ置き換える場合も、この抽象度を維持する。具体的なユーザー発話や完成済み返答例を prompt へ追加して regression を塞がない。

## 8. ACK / grounding の扱い

ACK は装飾ではない。共通基盤形成のための observable evidence として扱う。

ただし、毎回同じ「分かりました」を先頭に付ける規則にしてはならない。それは別の固定テンプレートになる。

renderer には、現在の turn で新たに共有された情報、訂正された情報、deterministic に確定した帰結、次の質問との関係を machine-readable に渡す。renderer がその turn で grounding evidence を示す価値があるかを文脈から判断し、自然な形で一つの発話へ統合する。

たとえば observed pace の計算は deterministic code が所有する。renderer に渡すのは「30ページに90分かかったため、同じscopeの25ページは約75分と見積もられた」という確定済みの構造化結果であり、Luna に算術や scheduler policy を決めさせない。renderer はその結果を必要に応じて理解の証拠として会話へ反映できる。

## 9. 動的 conversation-quality evaluation

固定 transcript を conversation-quality acceptance の主試験にしない。

固定 unit / integration regression は deterministic invariant の検査として残す。一方、自然な対話品質の評価は、次の逐次 protocol を必須とする。

```text
scenario seed / user information reservoir
→ user turnを必要最小限で生成
→ real Luna semantic + application + rendererを1 turnだけ実行
→ assistant responseを人間視点で確認
→ semantic / Fact Graph / dialogue decision / renderer traceを確認
→ 次のuser turnを、そのassistant responseを見て初めて生成
→ 問題があればその場で停止してowning layerを修正
→ 同地点から再実行
```

次の user utterance を先に固定しない。前の assistant response が不自然でも予定通りの scripted user reply を送って先へ進まない。

各 turn では少なくとも次を確認する。

- 直前の user contribution を本当に受け取ったことが発話から分かるか。
- 必要な場合に grounding evidence があるか。
- 受理済み情報を無視して同じ質問をしていないか。
- 同じ固定表現を機械的に繰り返していないか。
- user がまだ言っていない情報を前提にしていないか。
- 一度に必要以上の情報を要求していないか。
- question target は deterministic decision と一致しているか。
- uncertainty を勝手に確定していないか。
- 十分に共有できている点を過剰に確認してprogressivityを阻害していないか。
- correction / repair 後に局所的な共有状態が更新されたことが会話上も分かるか。
- preview / approval / save の境界を越えていないか。

## 10. テスト用ユーザーの原則

real-API roleplay の user は、最終回答を知っているテスト自動化エージェントとして振る舞わせない。

次の性質を持たせる。

- cooperative だが economical
- 一度に一つか少数の情報だけを出す
- 直前の質問へ局所的に答える
- 既出の対象を短い参照表現で指すことがある
- 必要なら訂正・言い直しを行う
- アプリの理解が見えなければ確認を返すことがある
- 内部 schema を知っているような完全な列挙をしない

「このテストを通すために次はこの文章を言う」という scripted sequence を禁止する。

## 11. PR #130 acceptance

PR #130 の conversation-quality 部分を完了扱いにするには、少なくとも以下を満たす。

1. 通常の質問 turn が固定完成文を source of truth とする production path を再監査し、正常系の mechanical repetition を除去する。
2. deterministic code は question target / priority を保持するが、natural-language realization を過剰所有しない。
3. renderer prompt は本書の抽象原則を基準とし、特定発話専用 rule や返答例を積み増さない。
4. user contribution に対する grounding evidence が必要な場面で、ACKなしに状態だけ進む対話を許容しない。
5. dynamic turn-by-turn real-API roleplay を行い、各 assistant response を確認してから次の user utterance を決める。
6. user は必要情報を一括説明せず、短答・後出し・省略を含む human-like interaction で preview まで到達する。
7. 同じ semantic scenario を言い回しや情報提示順を変えて複数回観測し、特定 transcript 依存でないことを確認する。
8. semantic / Fact Graph / scheduler / preview / approval / save の deterministic ownership は維持する。
9. full CI / Browser Regression を green にしたうえで、最終HEADの実API transcriptとtraceを人間が読んで不自然な固定対話が残っていないことを確認する。
10. AI semantic boundary 後の deterministic production path が raw `userText` / raw conversation を意味判断に使用せず、AI-produced schema / Fact Graph / typed machine state だけから semantic application decision を行うことを、実装監査と回帰で確認する。

## 12. 禁止する修正パターン

- 不自然な発話を直すために、その発話専用の日本語文字列を追加する。
- question code ごとに「自然そうな固定文」を増やす。
- ACK不足を直すために全turnへ同じ相槌をprefixする。
- dynamic dialogue failureを、固定 transcript のexpected string変更だけでgreenにする。
- Lunaが理解できる意味処理をraw-text regex / keyword routingへ戻す。
- AI semantic boundary 後の deterministic code が、raw conversation の substring / regex / keyword / sentence split を semantic decision source として利用する。
- rendererが自然に言える内容を、旧モデル向けprompt例示で過剰拘束する。
- user simulatorに未来のassistant responseや最終Fact Graphを見せ、最適な完全回答を作らせる。
- conversation-quality testの途中で違和感を見つけても、そのままscriptを最後まで流す。

## 13. 実装時の優先順位

この文書を読んだ実装担当は、まず production の固定 question / deterministic bypass / renderer input を監査する。

修正は一度に大きく書き換えず、次の順で一要素ずつ検証する。

```text
fixed realization / bypassを一箇所特定
→ typed application decisionが十分なcontextを持つか確認
→ 必要ならrenderer inputへgrounding素材を構造化追加
→ 固定自然文への依存を除去またはfallback限定
→ abstract renderer promptでreal Luna 1 turn再実行
→ 人間視点のgrounding / naturalnessを確認
→ semantic / deterministic invariantを確認
→ full CI
```

問題を見つけたら prompt に具体例を足すのではなく、まず ownership、renderer context、machine decision、過去のmodel-era heuristicのどれが原因かを特定する。

この方針は PR #130 の残り会話品質修正と最終 real-API preview acceptance の必須参照とする。
