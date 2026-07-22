# PR #75 七視点監査 2: AI schema と runtime contract

監査対象は AI response schema、command type union、known command set、runtime shape validator、candidate validator、repair protocol の整合性である。

機械比較では、AI schema、`KNOWN_COMMAND_TYPES`、`ParsedWeeklyPlanningCommand` が同一の 20 command type を保持しており、欠落または余分な command type はなかった。各 candidate は JSON parse、optional null canonicalization、runtime shape validation、enum validation、値域検証、confirmed-slot 競合、公開参照の存在確認を通過したものだけが reducer へ渡る。

初回監査では、schema 上有効な `{ candidates: [] }` が repair 対象にならず、通常の missing-slot 対話へ戻れる問題を確認した。修正後は command、assumption proposal、assumption decision、correction envelope の意味出力総数が 0 の応答も一度だけ repair する。repair 後も空、JSON 不正、shape 不正、parse rejection が残る場合は `invalid_candidates_after_repair` として fail-closed する。

`strict: false` は provider 互換性のため維持しているが、`additionalProperties: false` と runtime validator が authoritative contract として機能する。repair は最大 1 回であり、部分的に不正な response を都合よく採用せず、repair 全体が有効な場合だけ採用する。

判定は採用可である。schema/runtime drift と空応答 bypass は解消されている。
