import { diag } from "./shared/diagnostics";
import type {
  AttachmentNode,
  BaseScheduleNode,
  ClauseNode,
  DateSpec,
  DurationSpec,
  EnumerationVariantNode,
  EventGroupNode,
  OverrideScheduleNode,
  ScheduleAST,
  SequencedEventNode,
  TimeRangeSpec,
  TimeSpec,
  Token,
} from "./shared/types";

type ContentSemanticRole =
  | "context"
  | "control"
  | "override-cue"
  | "recurrence-cue"
  | "set-count-cue"
  | "connective"
  | "instruction-tail"
  | "particle";

interface ClassifiedContentFragment {
  cleanedText?: string;
  roles: Set<ContentSemanticRole>;
}

interface ContentSpanCandidate {
  parts: ClassifiedContentFragment[];
  leadingBoundaryKinds: Token["kind"][];
  trailingBoundaryKinds: Token["kind"][];
}

const SEMANTIC_LEADING_RULES: Array<{
  role: ContentSemanticRole;
  patterns: RegExp[];
}> = [
  {
    role: "context",
    patterns: [
      /^(?:(?:今日|明日|明後日|今週|来週)(?:の|は|に)?\s*)+/,
      /^(?:(?:朝|午前|午後|昼|夕方|夜)(?:は|に)?\s*)+/,
      /^(?:(?:寝る前|授業後|放課後|帰宅後)(?:に|は)?\s*)+/,
      /^(?:(?:軽く|少し|ちょっと)(?:だけ)?\s*)+/,
    ],
  },
  {
    role: "override-cue",
    patterns: [/^(?:(?:ただし|その代わり|他の日は|他は)\s*)+/],
  },
  {
    role: "control",
    patterns: [/^(?:(?:全部|ずつ)\s*)+/],
  },
  {
    role: "set-count-cue",
    patterns: [/^(?:(?:これを)\s*)+/],
  },
  {
    role: "connective",
    patterns: [/^(?:(?:そのあと|その後|次に|続けて)\s*)+/],
  },
  {
    role: "particle",
    patterns: [
      /^(?:(?:の|は|を|に|で|が|へ|より)\s*)+/,
      /^(?:(?:から|まで)\s*)+/,
    ],
  },
];

const SEMANTIC_TRAILING_RULES: Array<{
  role: ContentSemanticRole;
  patterns: RegExp[];
}> = [
  {
    role: "instruction-tail",
    patterns: [
      /(?:\s*(?:やるようにしたい|ようにしたい|に変更して|にして|固定して|休みにして|やりたい|したい))+$/,
      /(?:\s*(?:やる|する|進める|入れて|勉強する|学習する))+$/,
      /(?:\s*して)+$/,
    ],
  },
  {
    role: "particle",
    patterns: [/(\s*(?:の|は|を|に|で|が|へ|より))+$/],
  },
];

function firstTime(tokens: Token[], spanText?: string): TimeSpec | TimeRangeSpec | undefined {
  const token = tokens.find(
    (current) => current.kind === "TIME_RANGE"
  );

  if (token) {
    return token.value;
  }

  const timeTokens = tokens.filter(
    (current): current is Extract<Token, { kind: "TIME" }> =>
      current.kind === "TIME",
  );

  if (
    spanText &&
    timeTokens.length >= 2 &&
    /から/.test(spanText) &&
    /まで/.test(spanText)
  ) {
    return {
      raw: `${timeTokens[0].raw}から${timeTokens[1].raw}`,
      start: timeTokens[0].value,
      end: timeTokens[1].value,
    };
  }

  return timeTokens[0]?.value;
}

function firstDate(tokens: Token[]): DateSpec | undefined {
  const token = tokens.find((current) => current.kind === "DATE");
  return token?.kind === "DATE" ? token.value : undefined;
}

function firstDuration(tokens: Token[]): DurationSpec | undefined {
  const token = tokens.find((current) => current.kind === "DURATION");
  return token?.kind === "DURATION" ? token.value : undefined;
}

function firstRest(tokens: Token[]): DurationSpec | undefined {
  const token = tokens.find((current) => current.kind === "REST");
  return token?.kind === "REST" ? token.value : undefined;
}

function firstSetCount(tokens: Token[]): number | undefined {
  const token = tokens.find((current) => current.kind === "SET_COUNT");
  return token?.kind === "SET_COUNT" ? token.value.count : undefined;
}

function firstConnectiveRaw(tokens: Token[]): string | undefined {
  return tokens.find((token) => token.kind === "CONNECTIVE")?.raw;
}

function classifyContentFragment(text: string): ClassifiedContentFragment {
  let normalized = text.trim();
  const roles = new Set<ContentSemanticRole>();
  let changed = true;

  while (changed) {
    changed = false;

    for (const rule of SEMANTIC_LEADING_RULES) {
      for (const pattern of rule.patterns) {
        const next = normalized.replace(pattern, "").trim();
        if (next !== normalized) {
          normalized = next;
          roles.add(rule.role);
          changed = true;
        }
      }
    }
  }

  changed = true;
  while (changed) {
    changed = false;

    for (const rule of SEMANTIC_TRAILING_RULES) {
      for (const pattern of rule.patterns) {
        const next = normalized.replace(pattern, "").trim();
        if (next !== normalized) {
          normalized = next;
          roles.add(rule.role);
          changed = true;
        }
      }
    }
  }

  return {
    cleanedText: normalized.length > 0 ? normalized : undefined,
    roles,
  };
}

function isMeaningfulContentFragment(text: string | undefined): text is string {
  if (!text) {
    return false;
  }

  return !/^(?:の|は|を|に|で|が|へ|より|から|まで|だけ|のみ|全部|ずつ|これを?|他の日は|他は)$/.test(
    text.replace(/\s+/g, ""),
  );
}

function extractContentSpans(tokens: Token[]): ContentSpanCandidate[] {
  const spans: ContentSpanCandidate[] = [];
  let currentSpan: ClassifiedContentFragment[] = [];
  let leadingBoundaryKinds: Token["kind"][] = [];
  let trailingBoundaryKinds: Token["kind"][] = [];
  let lastBoundaryKind: Token["kind"] | null = null;

  for (const token of tokens) {
    if (token.kind === "CONTENT") {
      const classified = classifyContentFragment(token.raw);
      if (isMeaningfulContentFragment(classified.cleanedText)) {
        if (currentSpan.length === 0 && lastBoundaryKind) {
          leadingBoundaryKinds = [lastBoundaryKind];
        }
        currentSpan.push(classified);
        trailingBoundaryKinds = [];
      }
      continue;
    }

    if (currentSpan.length > 0) {
      trailingBoundaryKinds = [token.kind];
      spans.push({
        parts: currentSpan,
        leadingBoundaryKinds,
        trailingBoundaryKinds,
      });
      currentSpan = [];
      leadingBoundaryKinds = [];
      trailingBoundaryKinds = [];
    }

    lastBoundaryKind = token.kind;
  }

  if (currentSpan.length > 0) {
    spans.push({
      parts: currentSpan,
      leadingBoundaryKinds,
      trailingBoundaryKinds,
    });
  }

  return spans;
}

function scoreContentSpan(span: ContentSpanCandidate): number {
  const contentParts = span.parts
    .map((part) => part.cleanedText)
    .filter(isMeaningfulContentFragment);
  const text = contentParts.join("");
  if (text.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const contentDensity = text.replace(/\s+/g, "").length;
  const rolePenalty = span.parts.reduce((penalty, part) => {
    if (part.roles.has("control")) {
      penalty += 8;
    }
    if (part.roles.has("override-cue")) {
      penalty += 8;
    }
    if (part.roles.has("recurrence-cue")) {
      penalty += 8;
    }
    if (part.roles.has("set-count-cue")) {
      penalty += 8;
    }
    if (part.roles.has("connective")) {
      penalty += 8;
    }
    if (part.roles.has("instruction-tail")) {
      penalty += 4;
    }
    if (part.roles.has("context")) {
      penalty += 2;
    }
    return penalty;
  }, 0);

  const boundaryPenalty = [...span.leadingBoundaryKinds, ...span.trailingBoundaryKinds].reduce(
    (penalty, kind) => {
      if (
        kind === "CONTROL" ||
        kind === "OVERRIDE" ||
        kind === "CONNECTIVE" ||
        kind === "REPEAT" ||
        kind === "SET_COUNT"
      ) {
        return penalty + 6;
      }
      if (kind === "WEEKDAY" || kind === "WEEKDAY_GROUP" || kind === "DAYTYPE") {
        return penalty + 4;
      }
      if (kind === "DATE") {
        return penalty + 14;
      }
      return penalty;
    },
    0,
  );

  return contentDensity * 10 - rolePenalty - boundaryPenalty;
}

function mergedContent(tokens: Token[]): string | undefined {
  const spans = extractContentSpans(tokens);
  if (spans.length === 0) {
    return undefined;
  }

  const bestSpan = spans.reduce((best, current) => {
    const bestScore = scoreContentSpan(best);
    const currentScore = scoreContentSpan(current);

    if (currentScore > bestScore) {
      return current;
    }

    if (
      currentScore === bestScore &&
      current.parts.length >= best.parts.length
    ) {
      return current;
    }

    return best;
  });

  const candidate = bestSpan.parts
    .map((part) => part.cleanedText)
    .filter(isMeaningfulContentFragment)
    .join("");

  return candidate.length > 0 ? candidate : undefined;
}

function buildBaseNode(
  clause: Extract<ClauseNode, { kind: "EventClause" }>
): BaseScheduleNode {
  const weekdaySpecs = clause.tokens.flatMap((token) => {
    if (token.kind === "WEEKDAY") {
      return [token.value];
    }

    if (token.kind === "WEEKDAY_GROUP") {
      return token.value.weekdays.map((weekday) => ({
        raw: token.raw,
        weekday,
      }));
    }

    return [];
  });

  const dayTypeToken = clause.tokens.find((token) => token.kind === "DAYTYPE");
  const repeatToken = clause.tokens.find((token) => token.kind === "REPEAT");

  return {
    rawText: clause.spanText,
    contentText: mergedContent(clause.tokens),
    dateSpec: firstDate(clause.tokens),
    timeSpec: firstTime(clause.tokens, clause.spanText),
    durationSpec: firstDuration(clause.tokens),
    restDurationSpec: firstRest(clause.tokens),
    setCount: firstSetCount(clause.tokens),
    repeatSpec: repeatToken?.kind === "REPEAT" ? repeatToken.value : undefined,
    dayTypeSpec:
      dayTypeToken?.kind === "DAYTYPE" ? dayTypeToken.value : undefined,
    weekdaySpecs: weekdaySpecs.length > 0 ? weekdaySpecs : undefined,
  };
}

function buildSequenceNode(
  clause: Extract<ClauseNode, { kind: "EventClause" }>,
  connectiveRaw: string
): SequencedEventNode {
  return {
    rawText: clause.spanText,
    contentText: mergedContent(clause.tokens),
    dateSpec: firstDate(clause.tokens),
    timeSpec: firstTime(clause.tokens, clause.spanText),
    durationSpec: firstDuration(clause.tokens),
    relation: {
      kind: "after-previous-event",
      rawText: connectiveRaw,
    },
  };
}

function buildOverrideNode(
  clause: Extract<ClauseNode, { kind: "OverrideClause" }>
): OverrideScheduleNode {
  const weekdaySpecs = clause.tokens.flatMap((token) => {
    if (token.kind === "WEEKDAY") {
      return [token.value];
    }

    if (token.kind === "WEEKDAY_GROUP") {
      return token.value.weekdays.map((weekday) => ({
        raw: token.raw,
        weekday,
      }));
    }

    return [];
  });

  const dayTypeToken = clause.tokens.find((token) => token.kind === "DAYTYPE");

  return {
    rawText: clause.spanText,
    dateSpec: firstDate(clause.tokens),
    weekdaySpecs: weekdaySpecs.length > 0 ? weekdaySpecs : undefined,
    dayTypeSpec:
      dayTypeToken?.kind === "DAYTYPE" ? dayTypeToken.value : undefined,
    replaceTimeSpec: firstTime(clause.tokens, clause.spanText),
    replaceDurationSpec: firstDuration(clause.tokens),
  };
}

function buildAttachedTime(
  clause: Extract<ClauseNode, { kind: "TimeOnlyClause" }>
): AttachmentNode | null {
  const time = firstTime(clause.tokens);
  const durationSpec = firstDuration(clause.tokens);

  if (!time && !durationSpec) {
    return null;
  }

  return {
    kind: "AttachedTime",
    target: "nearest-event",
    time,
    durationSpec,
    rawText: clause.spanText,
  };
}

function buildAttachedControl(
  clause: Extract<ClauseNode, { kind: "InstructionClause" }>,
): AttachmentNode | null {
  const setCount = firstSetCount(clause.tokens);
  const hasControlToken = clause.tokens.some((token) => token.kind === "CONTROL");
  const contentText = mergedContent(clause.tokens);

  if (setCount == null && !hasControlToken) {
    return null;
  }

  if (setCount == null && !contentText) {
    return null;
  }

  return {
    kind: "AttachedControl",
    target: "nearest-event",
    setCount,
    contentText,
    rawText: clause.spanText,
  };
}

function parseEnumerationVariants(spanText: string): EnumerationVariantNode[] {
  const parts = spanText
    .split(/[、,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const variants = parts
    .map((part, index) => {
      const contentText = part
        .replace(/^(?:もう)?[0-9０-９一二三四五六七八九十]+回は\s*/, "")
        .replace(/[で。]+$/, "")
        .trim();

      if (contentText.length === 0) {
        return null;
      }

      return {
        rawText: part,
        contentText,
        index,
      } satisfies EnumerationVariantNode;
    })
    .filter((value): value is EnumerationVariantNode => value !== null);

  return variants;
}

function createGroup(base: BaseScheduleNode): EventGroupNode {
  return {
    base,
    sequences: [],
    overrides: [],
    attachments: [],
    enumerations: [],
  };
}

export function buildAST(clauses: ClauseNode[]): ScheduleAST {
  const ast: ScheduleAST = {
    groups: [],
    diagnostics: [],
  };

  let currentGroup: EventGroupNode | null = null;
  let currentSentenceIndex: number | null = null;
  const pendingOverrides: OverrideScheduleNode[] = [];

  for (const clause of clauses) {
    if (clause.kind === "EventClause") {
      const connectiveRaw = firstConnectiveRaw(clause.tokens);

      if (connectiveRaw) {
        if (!currentGroup) {
          ast.diagnostics.push(
            diag(
              "CONNECTIVE_WITHOUT_BASE",
              "sequence clause has no previous base event",
              clause.spanText
            )
          );
          continue;
        }

        currentGroup.sequences.push(buildSequenceNode(clause, connectiveRaw));
        continue;
      }

      const baseNode = buildBaseNode(clause);
      if (
        !baseNode.dateSpec &&
        currentGroup &&
        currentSentenceIndex === clause.sentenceIndex
      ) {
        baseNode.dateSpec = currentGroup.base.dateSpec;
      }

      currentGroup = createGroup(baseNode);
      if (pendingOverrides.length > 0) {
        currentGroup.overrides.push(...pendingOverrides.splice(0));
      }
      currentSentenceIndex = clause.sentenceIndex;
      ast.groups.push(currentGroup);
      continue;
    }

    if (clause.kind === "TimeOnlyClause") {
      const attachedTime = buildAttachedTime(clause);

      if (!currentGroup || !attachedTime) {
        ast.diagnostics.push(
          diag(
            "TIME_ONLY_WITHOUT_BASE",
            "time-only clause has no base event to attach to",
            clause.spanText
          )
        );
        continue;
      }

      currentGroup.attachments.push(attachedTime);
      continue;
    }

    if (clause.kind === "OverrideClause") {
      if (!currentGroup) {
        pendingOverrides.push(buildOverrideNode(clause));
        continue;
      }

      currentGroup.overrides.push(buildOverrideNode(clause));
      continue;
    }

    if (clause.kind === "EnumerationClause") {
      if (!currentGroup) {
        ast.diagnostics.push(
          diag(
            "ENUM_WITHOUT_BASE",
            "enumeration clause has no base event to expand from",
            clause.spanText
          )
        );
        continue;
      }

      const variants = parseEnumerationVariants(clause.spanText);

      if (variants.length === 0) {
        ast.diagnostics.push(
          diag(
            "ENUM_EMPTY",
            "enumeration clause did not produce any variants",
            clause.spanText
          )
        );
        continue;
      }

      currentGroup.enumerations.push(...variants);
      continue;
    }

    if (clause.kind === "InstructionClause" && currentGroup) {
      const attachedControl = buildAttachedControl(clause);
      if (attachedControl) {
        currentGroup.attachments.push(attachedControl);
        continue;
      }
    }

    ast.diagnostics.push(
      diag(
        "INSTRUCTION_IGNORED",
        "instruction clause is ignored",
        clause.spanText
      )
    );
  }

  for (const override of pendingOverrides) {
    ast.diagnostics.push(
      diag(
        "OVERRIDE_WITHOUT_BASE",
        "override clause has no base event to attach to",
        override.rawText,
      ),
    );
  }

  return ast;
}
