import {
  FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
  type FocusedAuthorizationEvaluationSplit,
} from './focusedAuthorizationSyntheticCandidates';

export const FOCUSED_AUTHORIZATION_EXPANSION_SOURCE = 'issue333_expansion_v1' as const;
export const FOCUSED_AUTHORIZATION_EXPANSION_AUTHOR = 'claude-opus-5-5 (Claude Code child)' as const;

export const FOCUSED_AUTHORIZATION_EXPANSION_LAYERS = [
  'colloquial_omission',
  'tentative_approval',
  'politeness_ambiguity',
  'negation_request_form',
  'self_correction',
  'conditional_vs_echo',
  'mixed_turn_natural',
  'draft_vs_save',
  'context_dependent',
  'phatic_addition',
  'voice_input_noise',
  'dialect_typo_emoji',
] as const;

export type ExpansionLayer = typeof FOCUSED_AUTHORIZATION_EXPANSION_LAYERS[number];

// Unlabeled review inputs. There is deliberately no expected decision: humans assign
// labels in blind double review, and these candidates must never be treated as gold.
export interface FocusedAuthorizationExpansionCandidate {
  id: string;
  conversationGroupId: string;
  layer: ExpansionLayer;
  split: FocusedAuthorizationEvaluationSplit;
  lastAssistantMessage: string | null;
  currentUserText: string;
  reviewStatus: 'synthetic_unreviewed';
  source: typeof FOCUSED_AUTHORIZATION_EXPANSION_SOURCE;
  author: typeof FOCUSED_AUTHORIZATION_EXPANSION_AUTHOR;
  contrastNote: string;
}

/** FNV-1a 32-bit over the UTF-8 bytes of `value`. */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// Pre-registered split rule: fixed before any model result was seen. Group ids are
// never renamed to rebalance the split.
export function expansionSplitForGroup(conversationGroupId: string): FocusedAuthorizationEvaluationSplit {
  return fnv1a32(conversationGroupId) % 10 < 4 ? 'holdout' : 'tuning';
}

const candidate = (
  value: Omit<FocusedAuthorizationExpansionCandidate, 'reviewStatus' | 'source' | 'author'>,
): FocusedAuthorizationExpansionCandidate => ({
  ...value,
  reviewStatus: 'synthetic_unreviewed',
  source: FOCUSED_AUTHORIZATION_EXPANSION_SOURCE,
  author: FOCUSED_AUTHORIZATION_EXPANSION_AUTHOR,
});

export const FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES = [
  // colloquial_omission
  candidate({
    id: 'x333-un-sorede-a', conversationGroupId: 'x333-un-sorede', layer: 'colloquial_omission', split: 'tuning',
    lastAssistantMessage: '平日は1日2時間、数学と英語を中心に組みます。この条件で未保存の計画案を作りますか？',
    currentUserText: 'うんそれで',
    contrastNote: 'same reply, yes/no confirmation vs either-or question about hours',
  }),
  candidate({
    id: 'x333-un-sorede-b', conversationGroupId: 'x333-un-sorede', layer: 'colloquial_omission', split: 'tuning',
    lastAssistantMessage: '平日の勉強時間は2時間と3時間、どちらがよさそうですか？',
    currentUserText: 'うんそれで',
    contrastNote: 'same reply, yes/no confirmation vs either-or question about hours',
  }),
  candidate({
    id: 'x333-toriaezu-a', conversationGroupId: 'x333-toriaezu', layer: 'colloquial_omission', split: 'tuning',
    lastAssistantMessage: '条件はそろっています。計画案のプレビューを作ってみましょうか？',
    currentUserText: 'とりあえず作ってみて',
    contrastNote: 'same reply, offer to preview vs pending question about club-day start time',
  }),
  candidate({
    id: 'x333-toriaezu-b', conversationGroupId: 'x333-toriaezu', layer: 'colloquial_omission', split: 'tuning',
    lastAssistantMessage: '部活がある日は、何時ごろから勉強できそうですか？',
    currentUserText: 'とりあえず作ってみて',
    contrastNote: 'same reply, offer to preview vs pending question about club-day start time',
  }),
  candidate({
    id: 'x333-sore-a', conversationGroupId: 'x333-sore', layer: 'colloquial_omission', split: 'tuning',
    lastAssistantMessage: '毎日少しずつ進める形で、未保存の計画案を作りますか？',
    currentUserText: 'それ',
    contrastNote: 'same one-word reply, single proposal vs choice between two plan styles',
  }),
  candidate({
    id: 'x333-sore-b', conversationGroupId: 'x333-sore', layer: 'colloquial_omission', split: 'tuning',
    lastAssistantMessage: 'A案（毎日少しずつ）とB案（週末にまとめて）、どちらの形で作りましょうか？',
    currentUserText: 'それ',
    contrastNote: 'same one-word reply, single proposal vs choice between two plan styles',
  }),
  candidate({
    id: 'x333-sorede-onegai-a', conversationGroupId: 'x333-sorede-onegai', layer: 'colloquial_omission', split: 'holdout',
    lastAssistantMessage: 'テストまでの2週間、数学を多めに配分します。この内容で計画案を作りますか？',
    currentUserText: 'それでお願い',
    contrastNote: 'same reply, plan confirmation vs offer to explain a study technique',
  }),
  candidate({
    id: 'x333-sorede-onegai-b', conversationGroupId: 'x333-sorede-onegai', layer: 'colloquial_omission', split: 'holdout',
    lastAssistantMessage: 'テスト前の暗記のコツについて、少し説明しましょうか？',
    currentUserText: 'それでお願い',
    contrastNote: 'same reply, plan confirmation vs offer to explain a study technique',
  }),

  // tentative_approval
  candidate({
    id: 'x333-maa-ittan-a', conversationGroupId: 'x333-maa-ittan', layer: 'tentative_approval', split: 'tuning',
    lastAssistantMessage: '平日2時間・土日4時間で組みます。この条件でプレビューを作りますか？',
    currentUserText: 'まあ一旦それで',
    contrastNote: 'same reply, plan confirmation vs question whether to change English time',
  }),
  candidate({
    id: 'x333-maa-ittan-b', conversationGroupId: 'x333-maa-ittan', layer: 'tentative_approval', split: 'tuning',
    lastAssistantMessage: '英語の時間はもう少し増やしますか？ それとも今のままにしますか？',
    currentUserText: 'まあ一旦それで',
    contrastNote: 'same reply, plan confirmation vs question whether to change English time',
  }),
  candidate({
    id: 'x333-ii-kamo-a', conversationGroupId: 'x333-ii-kamo', layer: 'tentative_approval', split: 'holdout',
    lastAssistantMessage: '朝に英単語、夜に数学という形で計画案を作れます。作りますか？',
    currentUserText: 'いいかも',
    contrastNote: 'same proposal, two hedged replies of different wording',
  }),
  candidate({
    id: 'x333-ii-kamo-b', conversationGroupId: 'x333-ii-kamo', layer: 'tentative_approval', split: 'holdout',
    lastAssistantMessage: '朝に英単語、夜に数学という形で計画案を作れます。作りますか？',
    currentUserText: 'たぶんそれで大丈夫、作ってみて',
    contrastNote: 'same proposal, two hedged replies of different wording',
  }),

  // politeness_ambiguity
  candidate({
    id: 'x333-daijoubu-a', conversationGroupId: 'x333-daijoubu', layer: 'politeness_ambiguity', split: 'tuning',
    lastAssistantMessage: 'この内容で計画案を作ってもいいですか？',
    currentUserText: '大丈夫です',
    contrastNote: 'same reply, permission question vs asking for more conditions vs offering an extra check first',
  }),
  candidate({
    id: 'x333-daijoubu-b', conversationGroupId: 'x333-daijoubu', layer: 'politeness_ambiguity', split: 'tuning',
    lastAssistantMessage: 'ほかに追加したい条件はありますか？',
    currentUserText: '大丈夫です',
    contrastNote: 'same reply, permission question vs asking for more conditions vs offering an extra check first',
  }),
  candidate({
    id: 'x333-daijoubu-c', conversationGroupId: 'x333-daijoubu', layer: 'politeness_ambiguity', split: 'tuning',
    lastAssistantMessage: '計画案を作る前に、土日の予定も確認しておきましょうか？',
    currentUserText: '大丈夫です',
    contrastNote: 'same reply, permission question vs asking for more conditions vs offering an extra check first',
  }),
  candidate({
    id: 'x333-kekkou-a', conversationGroupId: 'x333-kekkou', layer: 'politeness_ambiguity', split: 'holdout',
    lastAssistantMessage: 'この条件で未保存の計画案を作成してよろしいですか？',
    currentUserText: '結構です',
    contrastNote: 'same reply, permission question vs offer to add another subject',
  }),
  candidate({
    id: 'x333-kekkou-b', conversationGroupId: 'x333-kekkou', layer: 'politeness_ambiguity', split: 'holdout',
    lastAssistantMessage: '理科も計画に追加しておきますか？',
    currentUserText: '結構です',
    contrastNote: 'same reply, permission question vs offer to add another subject',
  }),

  // negation_request_form
  candidate({
    id: 'x333-tsukutte-kurenai-a', conversationGroupId: 'x333-tsukutte-kurenai', layer: 'negation_request_form', split: 'tuning',
    lastAssistantMessage: '条件がそろいました。この内容で計画案を作りますか？',
    currentUserText: '作ってくれない？',
    contrastNote: 'negative-form phrasing, confirmation vs early-draft question vs deferral message',
  }),
  candidate({
    id: 'x333-tsukutte-kurenai-b', conversationGroupId: 'x333-tsukutte-kurenai', layer: 'negation_request_form', split: 'tuning',
    lastAssistantMessage: 'まだ土曜の予定を聞いていませんが、先に計画案を作りますか？',
    currentUserText: '作ってくれない？',
    contrastNote: 'negative-form phrasing, confirmation vs early-draft question vs deferral message',
  }),
  candidate({
    id: 'x333-tsukutte-kurenai-c', conversationGroupId: 'x333-tsukutte-kurenai', layer: 'negation_request_form', split: 'tuning',
    lastAssistantMessage: '土曜の予定がわかったら計画案を作りますね。',
    currentUserText: 'え、作ってくれないの？',
    contrastNote: 'negative-form phrasing, confirmation vs early-draft question vs deferral message',
  }),
  candidate({
    id: 'x333-tsukuranakute-ii-wake-a', conversationGroupId: 'x333-tsukuranakute-ii-wake', layer: 'negation_request_form', split: 'holdout',
    lastAssistantMessage: 'わかりました。今回は計画案を作らずにおきますね。',
    currentUserText: '作らなくていいってわけじゃない',
    contrastNote: 'double negation, after an assistant withdrawal vs after a confirmation, reply with vs without a trailing clause',
  }),
  candidate({
    id: 'x333-tsukuranakute-ii-wake-b', conversationGroupId: 'x333-tsukuranakute-ii-wake', layer: 'negation_request_form', split: 'holdout',
    lastAssistantMessage: 'この条件で計画案を作りますか？ 必要なければ作らずにおきます。',
    currentUserText: '作らなくていいってわけじゃないけど、ちょっと考えさせて',
    contrastNote: 'double negation, after an assistant withdrawal vs after a confirmation, reply with vs without a trailing clause',
  }),
  candidate({
    id: 'x333-betsuni-a', conversationGroupId: 'x333-betsuni', layer: 'negation_request_form', split: 'tuning',
    lastAssistantMessage: '今の条件で計画案を作ることもできます。どうしますか？',
    currentUserText: 'べつに作ってもいいけど',
    contrastNote: 'same offer, indifferent positive form vs indifferent negative form',
  }),
  candidate({
    id: 'x333-betsuni-b', conversationGroupId: 'x333-betsuni', layer: 'negation_request_form', split: 'tuning',
    lastAssistantMessage: '今の条件で計画案を作ることもできます。どうしますか？',
    currentUserText: 'べつに作らなくてもいいけど',
    contrastNote: 'same offer, indifferent positive form vs indifferent negative form',
  }),
  candidate({
    id: 'x333-mada-ii-a', conversationGroupId: 'x333-mada-ii', layer: 'negation_request_form', split: 'tuning',
    lastAssistantMessage: '集めた条件で、計画のプレビューを作りますか？',
    currentUserText: 'まだいいや',
    contrastNote: 'same offer, まだいいや vs もういいや with a following clause',
  }),
  candidate({
    id: 'x333-mada-ii-b', conversationGroupId: 'x333-mada-ii', layer: 'negation_request_form', split: 'tuning',
    lastAssistantMessage: '集めた条件で、計画のプレビューを作りますか？',
    currentUserText: 'もういいや、作っちゃって',
    contrastNote: 'same offer, まだいいや vs もういいや with a following clause',
  }),

  // self_correction
  candidate({
    id: 'x333-onegai-iya-matte-a', conversationGroupId: 'x333-onegai-iya-matte', layer: 'self_correction', split: 'tuning',
    lastAssistantMessage: 'この条件で未保存の計画案を作りますか？',
    currentUserText: 'お願い、いや待って',
    contrastNote: 'same assistant turn, utterance ends after 待って vs continues after it',
  }),
  candidate({
    id: 'x333-onegai-iya-matte-b', conversationGroupId: 'x333-onegai-iya-matte', layer: 'self_correction', split: 'tuning',
    lastAssistantMessage: 'この条件で未保存の計画案を作りますか？',
    currentUserText: 'お願い…いや待って、やっぱりお願い',
    contrastNote: 'same assistant turn, utterance ends after 待って vs continues after it',
  }),
  candidate({
    id: 'x333-yappa-matte-a', conversationGroupId: 'x333-yappa-matte', layer: 'self_correction', split: 'holdout',
    lastAssistantMessage: '数学と英語を交互に入れる形で、計画案を作ってよいですか？',
    currentUserText: '作って、いややっぱ待って',
    contrastNote: 'same assistant turn, comma-joined vs sentence-split casual wording',
  }),
  candidate({
    id: 'x333-yappa-matte-b', conversationGroupId: 'x333-yappa-matte', layer: 'self_correction', split: 'holdout',
    lastAssistantMessage: '数学と英語を交互に入れる形で、計画案を作ってよいですか？',
    currentUserText: 'つくって。あ、やっぱちょい待ち',
    contrastNote: 'same assistant turn, comma-joined vs sentence-split casual wording',
  }),
  candidate({
    id: 'x333-sakki-no-nashi-a', conversationGroupId: 'x333-sakki-no-nashi', layer: 'self_correction', split: 'holdout',
    lastAssistantMessage: '金曜は部活のため勉強なし、で合っていますか？ 合っていればこの条件で計画案を作ります。',
    currentUserText: 'さっきのなし',
    contrastNote: 'same reply, before a draft exists vs after an unsaved draft was shown',
  }),
  candidate({
    id: 'x333-sakki-no-nashi-b', conversationGroupId: 'x333-sakki-no-nashi', layer: 'self_correction', split: 'holdout',
    lastAssistantMessage: '未保存の計画案を表示しました。内容を確認して、問題なければ保存してください。',
    currentUserText: 'さっきのなし',
    contrastNote: 'same reply, before a draft exists vs after an unsaved draft was shown',
  }),
  candidate({
    id: 'x333-sorede-ii-janakute-a', conversationGroupId: 'x333-sorede-ii-janakute', layer: 'self_correction', split: 'tuning',
    lastAssistantMessage: '英語は毎日1時間で組みます。この条件で計画案を作りますか？',
    currentUserText: 'それでいい、じゃなくて英語だけ減らして',
    contrastNote: 'same assistant turn, じゃなくて phrasing with vs without punctuation',
  }),
  candidate({
    id: 'x333-sorede-ii-janakute-b', conversationGroupId: 'x333-sorede-ii-janakute', layer: 'self_correction', split: 'tuning',
    lastAssistantMessage: '英語は毎日1時間で組みます。この条件で計画案を作りますか？',
    currentUserText: 'それでいいよじゃなくて英語だけもうちょい少なめで',
    contrastNote: 'same assistant turn, じゃなくて phrasing with vs without punctuation',
  }),
  candidate({
    id: 'x333-kinyou-mokuyou-a', conversationGroupId: 'x333-kinyou-mokuyou', layer: 'self_correction', split: 'tuning',
    lastAssistantMessage: '金曜は塾があるので勉強時間を短めにします。この条件で計画案を作りますか？',
    currentUserText: '違う、金曜じゃなくて木曜',
    contrastNote: 'day correction after a plan confirmation',
  }),

  // conditional_vs_echo
  candidate({
    id: 'x333-22ji-made-a', conversationGroupId: 'x333-22ji-made', layer: 'conditional_vs_echo', split: 'holdout',
    lastAssistantMessage: '平日は19時から勉強を始める形にします。この条件で計画案を作りますか？',
    currentUserText: '22時までなら',
    contrastNote: 'same reply, end time unstated vs already stated as 22時 vs stated as later than 22時',
  }),
  candidate({
    id: 'x333-22ji-made-b', conversationGroupId: 'x333-22ji-made', layer: 'conditional_vs_echo', split: 'holdout',
    lastAssistantMessage: '平日は19時から22時までの間で組みます。この条件で計画案を作りますか？',
    currentUserText: '22時までなら',
    contrastNote: 'same reply, end time unstated vs already stated as 22時 vs stated as later than 22時',
  }),
  candidate({
    id: 'x333-22ji-made-c', conversationGroupId: 'x333-22ji-made', layer: 'conditional_vs_echo', split: 'holdout',
    lastAssistantMessage: 'テスト前の週は平日23時まで勉強する形になります。この条件で計画案を作りますか？',
    currentUserText: '22時までなら',
    contrastNote: 'same reply, end time unstated vs already stated as 22時 vs stated as later than 22時',
  }),
  candidate({
    id: 'x333-tsumekomi-a', conversationGroupId: 'x333-tsumekomi', layer: 'conditional_vs_echo', split: 'tuning',
    lastAssistantMessage: '1日に2〜3科目ずつ、余裕をもって配分します。この条件で計画案を作りますか？',
    currentUserText: '詰め込みすぎないならそれで',
    contrastNote: 'same condition, assistant describes a light load vs a heavy load',
  }),
  candidate({
    id: 'x333-tsumekomi-b', conversationGroupId: 'x333-tsumekomi', layer: 'conditional_vs_echo', split: 'tuning',
    lastAssistantMessage: 'テスト範囲が広いので、1日に5科目入る日があります。この条件で計画案を作りますか？',
    currentUserText: '詰め込みすぎないならそれで',
    contrastNote: 'same condition, assistant describes a light load vs a heavy load',
  }),
  candidate({
    id: 'x333-kyukei-ireru-a', conversationGroupId: 'x333-kyukei-ireru', layer: 'conditional_vs_echo', split: 'tuning',
    lastAssistantMessage: '数学・英語・国語の順で続けて組みます。この条件で計画案を作りますか？',
    currentUserText: '休憩入れられるならお願い',
    contrastNote: 'same condition, breaks not mentioned vs breaks already included by the assistant',
  }),
  candidate({
    id: 'x333-kyukei-ireru-b', conversationGroupId: 'x333-kyukei-ireru', layer: 'conditional_vs_echo', split: 'tuning',
    lastAssistantMessage: '各科目のあいだに10分の休憩を入れる形で、計画案を作りますか？',
    currentUserText: '休憩入れられるならお願い',
    contrastNote: 'same condition, breaks not mentioned vs breaks already included by the assistant',
  }),
  candidate({
    id: 'x333-doyou-yasumi-a', conversationGroupId: 'x333-doyou-yasumi', layer: 'conditional_vs_echo', split: 'tuning',
    lastAssistantMessage: '平日2時間、土日は3時間ずつで組みます。この条件でプレビューを作りますか？',
    currentUserText: '土曜休みにできるならいいよ',
    contrastNote: 'same condition, Saturday scheduled vs Saturday already off in the assistant message',
  }),
  candidate({
    id: 'x333-doyou-yasumi-b', conversationGroupId: 'x333-doyou-yasumi', layer: 'conditional_vs_echo', split: 'tuning',
    lastAssistantMessage: '土曜はお休みにして、日曜に4時間まとめます。この条件でプレビューを作りますか？',
    currentUserText: '土曜休みにできるならいいよ',
    contrastNote: 'same condition, Saturday scheduled vs Saturday already off in the assistant message',
  }),

  // mixed_turn_natural
  candidate({
    id: 'x333-eigo-hanbun-a', conversationGroupId: 'x333-eigo-hanbun', layer: 'mixed_turn_natural', split: 'tuning',
    lastAssistantMessage: '英語を毎日1時間、数学を1時間で組みます。この条件で計画案を作りますか？',
    currentUserText: 'それで、英語は半分に',
    contrastNote: 'same assistant turn, terse vs casual sentence-final wording',
  }),
  candidate({
    id: 'x333-eigo-hanbun-b', conversationGroupId: 'x333-eigo-hanbun', layer: 'mixed_turn_natural', split: 'tuning',
    lastAssistantMessage: '英語を毎日1時間、数学を1時間で組みます。この条件で計画案を作りますか？',
    currentUserText: 'それで。英語は半分にしといて',
    contrastNote: 'same assistant turn, terse vs casual sentence-final wording',
  }),
  candidate({
    id: 'x333-kyukei-nanpun-a', conversationGroupId: 'x333-kyukei-nanpun', layer: 'mixed_turn_natural', split: 'holdout',
    lastAssistantMessage: 'この内容で未保存の計画案を作りますか？',
    currentUserText: 'お願い。休憩は何分？',
    contrastNote: 'same reply, break length unstated vs already stated by the assistant',
  }),
  candidate({
    id: 'x333-kyukei-nanpun-b', conversationGroupId: 'x333-kyukei-nanpun', layer: 'mixed_turn_natural', split: 'holdout',
    lastAssistantMessage: '25分勉強して5分休憩のくり返しで組みます。この内容で未保存の計画案を作りますか？',
    currentUserText: 'お願い。休憩は何分？',
    contrastNote: 'same reply, break length unstated vs already stated by the assistant',
  }),
  candidate({
    id: 'x333-eigo-30pun-a', conversationGroupId: 'x333-eigo-30pun', layer: 'mixed_turn_natural', split: 'tuning',
    lastAssistantMessage: '英語は1日90分、数学は60分で組みます。この条件で計画案を作りますか？',
    currentUserText: 'それで作って、あと英語だけ30分減らして',
    contrastNote: 'same compound reply, English minutes stated vs not stated by the assistant',
  }),
  candidate({
    id: 'x333-eigo-30pun-b', conversationGroupId: 'x333-eigo-30pun', layer: 'mixed_turn_natural', split: 'tuning',
    lastAssistantMessage: '条件はそろいました。この条件で計画案を作りますか？',
    currentUserText: 'それで作って、あと英語だけ30分減らして',
    contrastNote: 'same compound reply, English minutes stated vs not stated by the assistant',
  }),
  candidate({
    id: 'x333-kinyou-osoku-a', conversationGroupId: 'x333-kinyou-osoku', layer: 'mixed_turn_natural', split: 'holdout',
    lastAssistantMessage: '毎日18時開始で組みます。この条件で計画案を作りますか？',
    currentUserText: '作って。あと金曜だけ開始遅らせたい',
    contrastNote: 'same assistant turn, Friday start wish without vs with an exact time',
  }),
  candidate({
    id: 'x333-kinyou-osoku-b', conversationGroupId: 'x333-kinyou-osoku', layer: 'mixed_turn_natural', split: 'holdout',
    lastAssistantMessage: '毎日18時開始で組みます。この条件で計画案を作りますか？',
    currentUserText: '作って。あ、金曜だけ19時からにしたい',
    contrastNote: 'same assistant turn, Friday start wish without vs with an exact time',
  }),

  // draft_vs_save
  candidate({
    id: 'x333-an-dake-a', conversationGroupId: 'x333-an-dake', layer: 'draft_vs_save', split: 'tuning',
    lastAssistantMessage: 'この条件で未保存の計画案（プレビュー）を作りますか？',
    currentUserText: '案だけ見たい、保存はまだ',
    contrastNote: 'same reply, offer of an unsaved preview vs offer to save and apply',
  }),
  candidate({
    id: 'x333-an-dake-b', conversationGroupId: 'x333-an-dake', layer: 'draft_vs_save', split: 'tuning',
    lastAssistantMessage: 'この計画を保存して、今週の予定に反映しますか？',
    currentUserText: '案だけ見たい、保存はまだ',
    contrastNote: 'same reply, offer of an unsaved preview vs offer to save and apply',
  }),
  candidate({
    id: 'x333-hozon-shite-a', conversationGroupId: 'x333-hozon-shite', layer: 'draft_vs_save', split: 'tuning',
    lastAssistantMessage: 'この条件で未保存の計画案を作りますか？',
    currentUserText: '作ってそのまま保存しといて',
    contrastNote: 'same unsaved-draft offer, reply mentions saving vs mentions preview',
  }),
  candidate({
    id: 'x333-hozon-shite-b', conversationGroupId: 'x333-hozon-shite', layer: 'draft_vs_save', split: 'tuning',
    lastAssistantMessage: 'この条件で未保存の計画案を作りますか？',
    currentUserText: 'とりあえずプレビューでいいから見せて',
    contrastNote: 'same unsaved-draft offer, reply mentions saving vs mentions preview',
  }),

  // context_dependent
  candidate({
    id: 'x333-compound-hai-a', conversationGroupId: 'x333-compound-hai', layer: 'context_dependent', split: 'holdout',
    lastAssistantMessage: 'では、この内容でプレビューを作りますか？',
    currentUserText: 'はい',
    contrastNote: 'same reply, simple question vs sequential compound vs alternative compound question',
  }),
  candidate({
    id: 'x333-compound-hai-b', conversationGroupId: 'x333-compound-hai', layer: 'context_dependent', split: 'holdout',
    lastAssistantMessage: '英語の時間を30分減らして、そのうえで計画案を作りますか？',
    currentUserText: 'はい',
    contrastNote: 'same reply, simple question vs sequential compound vs alternative compound question',
  }),
  candidate({
    id: 'x333-compound-hai-c', conversationGroupId: 'x333-compound-hai', layer: 'context_dependent', split: 'holdout',
    lastAssistantMessage: '英語の時間は減らしますか？ それとも今の条件のまま計画案を作りますか？',
    currentUserText: 'はい',
    contrastNote: 'same reply, simple question vs sequential compound vs alternative compound question',
  }),
  candidate({
    id: 'x333-mae-no-de-a', conversationGroupId: 'x333-mae-no-de', layer: 'context_dependent', split: 'tuning',
    lastAssistantMessage: '最初は平日2時間でしたが、今は平日3時間になっています。どちらで計画案を作りますか？',
    currentUserText: '前ので',
    contrastNote: 'same reply, two explicit alternatives vs only the current conditions mentioned',
  }),
  candidate({
    id: 'x333-mae-no-de-b', conversationGroupId: 'x333-mae-no-de', layer: 'context_dependent', split: 'tuning',
    lastAssistantMessage: '今回の条件（平日3時間・土日休み）で計画案を作りますか？',
    currentUserText: '前ので',
    contrastNote: 'same reply, two explicit alternatives vs only the current conditions mentioned',
  }),
  candidate({
    id: 'x333-sakki-no-jouken-a', conversationGroupId: 'x333-sakki-no-jouken', layer: 'context_dependent', split: 'tuning',
    lastAssistantMessage: '土日も勉強する形に変更しました。この条件で計画案を作りますか？',
    currentUserText: 'さっきの条件で',
    contrastNote: 'same reply, after a condition change vs before a rebuild question',
  }),
  candidate({
    id: 'x333-sakki-no-jouken-b', conversationGroupId: 'x333-sakki-no-jouken', layer: 'context_dependent', split: 'tuning',
    lastAssistantMessage: '新しいテスト範囲に合わせて、条件を組み直しますか？',
    currentUserText: 'さっきの条件で',
    contrastNote: 'same reply, after a condition change vs before a rebuild question',
  }),
  candidate({
    id: 'x333-unrelated-tip-a', conversationGroupId: 'x333-unrelated-tip', layer: 'context_dependent', split: 'holdout',
    lastAssistantMessage: 'ちなみに、暗記ものは寝る前にやると覚えやすいと言われています。',
    currentUserText: 'じゃあそれで作って',
    contrastNote: 'same reply, after an unrelated tip vs after a tip followed by a plan confirmation',
  }),
  candidate({
    id: 'x333-unrelated-tip-b', conversationGroupId: 'x333-unrelated-tip', layer: 'context_dependent', split: 'holdout',
    lastAssistantMessage: '暗記ものは寝る前が覚えやすいので、夜に英単語を入れました。この条件で計画案を作りますか？',
    currentUserText: 'じゃあそれで作って',
    contrastNote: 'same reply, after an unrelated tip vs after a tip followed by a plan confirmation',
  }),

  // phatic_addition
  candidate({
    id: 'x333-arigatou-a', conversationGroupId: 'x333-arigatou', layer: 'phatic_addition', split: 'holdout',
    lastAssistantMessage: '平日は数学を中心に、週末に英語をまとめて組みます。この条件で計画案を作りますか？',
    currentUserText: 'ありがとう、それでお願い',
    contrastNote: 'same reply, plan confirmation vs after study tips were given',
  }),
  candidate({
    id: 'x333-arigatou-b', conversationGroupId: 'x333-arigatou', layer: 'phatic_addition', split: 'holdout',
    lastAssistantMessage: '数学の問題集を進めるコツを3つ紹介しました。ほかに気になることはありますか？',
    currentUserText: 'ありがとう、それでお願い',
    contrastNote: 'same reply, plan confirmation vs after study tips were given',
  }),
  candidate({
    id: 'x333-otsukare-a', conversationGroupId: 'x333-otsukare', layer: 'phatic_addition', split: 'tuning',
    lastAssistantMessage: 'この条件で未保存の計画案を作りますか？',
    currentUserText: 'ありがとうございます！',
    contrastNote: 'same assistant turn, thanks only vs greeting plus a question-form phrase',
  }),
  candidate({
    id: 'x333-otsukare-b', conversationGroupId: 'x333-otsukare', layer: 'phatic_addition', split: 'tuning',
    lastAssistantMessage: 'この条件で未保存の計画案を作りますか？',
    currentUserText: 'おつかれ〜、さっそく作ってもらえる？',
    contrastNote: 'same assistant turn, thanks only vs greeting plus a question-form phrase',
  }),

  // voice_input_noise
  candidate({
    id: 'x333-voice-etto-a', conversationGroupId: 'x333-voice-etto', layer: 'voice_input_noise', split: 'tuning',
    lastAssistantMessage: 'この条件で計画のプレビューを作りますか？',
    currentUserText: 'えっとそれでつくっ、いや…',
    contrastNote: 'disfluent dictation, same assistant turn, trailing off vs continuing after the restart',
  }),
  candidate({
    id: 'x333-voice-etto-b', conversationGroupId: 'x333-voice-etto', layer: 'voice_input_noise', split: 'tuning',
    lastAssistantMessage: 'この条件で計画のプレビューを作りますか？',
    currentUserText: 'えっとそれでつくっ、いや、うん、つくって',
    contrastNote: 'disfluent dictation, same assistant turn, trailing off vs continuing after the restart',
  }),
  candidate({
    id: 'x333-voice-no-punct-a', conversationGroupId: 'x333-voice-no-punct', layer: 'voice_input_noise', split: 'tuning',
    lastAssistantMessage: '平日2時間で組みます。この条件で計画案を作りますか？',
    currentUserText: 'はいそれでお願いしますあと土曜は午前だけで',
    contrastNote: 'unpunctuated dictation, same assistant turn, trailing extra clause vs leading filler',
  }),
  candidate({
    id: 'x333-voice-no-punct-b', conversationGroupId: 'x333-voice-no-punct', layer: 'voice_input_noise', split: 'tuning',
    lastAssistantMessage: '平日2時間で組みます。この条件で計画案を作りますか？',
    currentUserText: 'えーとじゃあそれでつくってください',
    contrastNote: 'unpunctuated dictation, same assistant turn, trailing extra clause vs leading filler',
  }),
  candidate({
    id: 'x333-voice-hiragana-a', conversationGroupId: 'x333-voice-hiragana', layer: 'voice_input_noise', split: 'tuning',
    lastAssistantMessage: '英語は夜にまとめて入れます。この条件で計画案を作りますか？',
    currentUserText: 'それでつくってえいごはごぜんちゅうにして',
    contrastNote: 'all-hiragana unpunctuated dictation mixing a reply and a change',
  }),

  // dialect_typo_emoji
  candidate({
    id: 'x333-hona-a', conversationGroupId: 'x333-hona', layer: 'dialect_typo_emoji', split: 'tuning',
    lastAssistantMessage: 'この条件で未保存の計画案を作ってもええですか？',
    currentUserText: 'ほなそれでたのむ🙏',
    contrastNote: 'Kansai dialect, same assistant turn, two different casual replies',
  }),
  candidate({
    id: 'x333-hona-b', conversationGroupId: 'x333-hona', layer: 'dialect_typo_emoji', split: 'tuning',
    lastAssistantMessage: 'この条件で未保存の計画案を作ってもええですか？',
    currentUserText: 'それでええよ〜',
    contrastNote: 'Kansai dialect, same assistant turn, two different casual replies',
  }),
  candidate({
    id: 'x333-typo-a', conversationGroupId: 'x333-typo', layer: 'dialect_typo_emoji', split: 'tuning',
    lastAssistantMessage: 'この内容で計画案を作りますか？',
    currentUserText: 'それでおねがいしまうs',
    contrastNote: 'same assistant turn, romaji-input typo vs emoji only',
  }),
  candidate({
    id: 'x333-typo-b', conversationGroupId: 'x333-typo', layer: 'dialect_typo_emoji', split: 'tuning',
    lastAssistantMessage: 'この内容で計画案を作りますか？',
    currentUserText: '👍👍',
    contrastNote: 'same assistant turn, romaji-input typo vs emoji only',
  }),
  candidate({
    id: 'x333-width-mix-a', conversationGroupId: 'x333-width-mix', layer: 'dialect_typo_emoji', split: 'holdout',
    lastAssistantMessage: '平日2時間、土日3時間で組みます。この条件でプレビューを作りますか？',
    currentUserText: '平日２時間でok、それでお願い',
    contrastNote: 'mixed full/half width, repeating the stated hours vs a different hour value',
  }),
  candidate({
    id: 'x333-width-mix-b', conversationGroupId: 'x333-width-mix', layer: 'dialect_typo_emoji', split: 'holdout',
    lastAssistantMessage: '平日2時間、土日3時間で組みます。この条件でプレビューを作りますか？',
    currentUserText: 'ＯＫ、でも土日は4ｈで',
    contrastNote: 'mixed full/half width, repeating the stated hours vs a different hour value',
  }),
] as const satisfies readonly FocusedAuthorizationExpansionCandidate[];

const pairKey = (value: { lastAssistantMessage: string | null; currentUserText: string }): string =>
  JSON.stringify([value.lastAssistantMessage, value.currentUserText]);

export function validateFocusedAuthorizationExpansionCandidates(
  candidates: readonly FocusedAuthorizationExpansionCandidate[],
  existing: readonly { lastAssistantMessage: string | null; currentUserText: string }[] =
  FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
): void {
  const existingPairs = new Set(existing.map(pairKey));
  const ids = new Set<string>();
  const groupSplits = new Map<string, FocusedAuthorizationEvaluationSplit>();
  for (const value of candidates) {
    if (ids.has(value.id)) throw new Error(`Duplicate expansion candidate id: ${value.id}`);
    ids.add(value.id);
    const split = groupSplits.get(value.conversationGroupId);
    if (split !== undefined && split !== value.split) {
      throw new Error(`Conversation group crosses evaluation splits: ${value.conversationGroupId}`);
    }
    groupSplits.set(value.conversationGroupId, value.split);
    if (value.split !== expansionSplitForGroup(value.conversationGroupId)) {
      throw new Error(`Split does not follow the pre-registered rule: ${value.id}`);
    }
    if (value.currentUserText.trim() === '') throw new Error(`Empty currentUserText: ${value.id}`);
    if (value.lastAssistantMessage !== null && value.lastAssistantMessage.trim() === '') {
      throw new Error(`Empty lastAssistantMessage: ${value.id}`);
    }
    if (value.contrastNote.trim() === '') throw new Error(`Empty contrastNote: ${value.id}`);
    if (value.reviewStatus !== 'synthetic_unreviewed') {
      throw new Error(`Expansion candidate is incorrectly marked as reviewed: ${value.id}`);
    }
    if (value.source !== FOCUSED_AUTHORIZATION_EXPANSION_SOURCE || value.author !== FOCUSED_AUTHORIZATION_EXPANSION_AUTHOR) {
      throw new Error(`Expansion candidate provenance is not fixed: ${value.id}`);
    }
    if (existingPairs.has(pairKey(value))) {
      throw new Error(`Expansion candidate duplicates an existing candidate pair: ${value.id}`);
    }
  }
}

/** Informational only: expansion ids whose currentUserText exactly matches an existing candidate. */
export function findExpansionUserTextOverlaps(
  candidates: readonly FocusedAuthorizationExpansionCandidate[],
  existing: readonly { id: string; currentUserText: string }[] = FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
): { id: string; currentUserText: string; existingIds: string[] }[] {
  return candidates.flatMap((value) => {
    const existingIds = existing
      .filter((other) => other.currentUserText === value.currentUserText)
      .map((other) => other.id);
    return existingIds.length > 0 ? [{ id: value.id, currentUserText: value.currentUserText, existingIds }] : [];
  });
}
