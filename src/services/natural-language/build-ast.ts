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

function firstTime(tokens: Token[]): TimeSpec | TimeRangeSpec | undefined {
  const token = tokens.find(
    (current) => current.kind === "TIME" || current.kind === "TIME_RANGE"
  );

  if (!token) {
    return undefined;
  }

  return token.value;
}

function firstDate(tokens: Token[]): DateSpec | undefined {
  const token = tokens.find((current) => current.kind === "DATE");
  return token?.kind === "DATE" ? token.value : undefined;
}

function firstDuration(tokens: Token[]): DurationSpec | undefined {
  const token = tokens.find((current) => current.kind === "DURATION");
  return token?.kind === "DURATION" ? token.value : undefined;
}

function firstConnectiveRaw(tokens: Token[]): string | undefined {
  return tokens.find((token) => token.kind === "CONNECTIVE")?.raw;
}

function normalizeContentText(text: string): string | undefined {
  let normalized = text.trim();

  normalized = normalized.replace(
    /^(?:(?:寝る前|授業後|放課後|帰宅後)(?:に|は)?)+/,
    ""
  );

  normalized = normalized.replace(
    /^(?:(?:今日|明日|明後日|今週|来週)(?:の|は)?|(?:朝|昼|夜)(?:は)?|の|は|から|まで)+/,
    ""
  );

  normalized = normalized.replace(/^(?:(?:軽く|少し|ちょっと)(?:だけ)?|だけ|のみ)+/, "");
  normalized = normalized.replace(/^(?:だけ|のみ)+/, "");

  normalized = normalized.replace(
    /(?:を(?:やる|する|入れる|入れて|進める|勉強する|学習する|解く|見直す|確認する|修正する)|(?:を)?書く|やる|する|入れる|入れて)$/,
    ""
  );

  normalized = normalized.replace(/^(?:の|は|を)+/, "");
  normalized = normalized.replace(/(?:の|は|を)+$/, "");
  normalized = normalized.trim();

  return normalized.length > 0 ? normalized : undefined;
}

function mergedContent(tokens: Token[]): string | undefined {
  const text = tokens
    .filter((token) => token.kind === "CONTENT")
    .map((token) => token.raw.trim())
    .filter((textPart) => textPart.length > 0)
    .join("");

  return text.length > 0 ? normalizeContentText(text) : undefined;
}

function buildBaseNode(
  clause: Extract<ClauseNode, { kind: "EventClause" }>
): BaseScheduleNode {
  const weekdaySpecs = clause.tokens
    .filter((token) => token.kind === "WEEKDAY")
    .map((token) => token.value);

  const dayTypeToken = clause.tokens.find((token) => token.kind === "DAYTYPE");
  const repeatToken = clause.tokens.find((token) => token.kind === "REPEAT");

  return {
    rawText: clause.spanText,
    contentText: mergedContent(clause.tokens),
    dateSpec: firstDate(clause.tokens),
    timeSpec: firstTime(clause.tokens),
    durationSpec: firstDuration(clause.tokens),
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
    timeSpec: firstTime(clause.tokens),
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
  const weekdaySpecs = clause.tokens
    .filter((token) => token.kind === "WEEKDAY")
    .map((token) => token.value);

  const dayTypeToken = clause.tokens.find((token) => token.kind === "DAYTYPE");

  return {
    rawText: clause.spanText,
    dateSpec: firstDate(clause.tokens),
    weekdaySpecs: weekdaySpecs.length > 0 ? weekdaySpecs : undefined,
    dayTypeSpec:
      dayTypeToken?.kind === "DAYTYPE" ? dayTypeToken.value : undefined,
    replaceTimeSpec: firstTime(clause.tokens),
    replaceDurationSpec: firstDuration(clause.tokens),
  };
}

function buildAttachedTime(
  clause: Extract<ClauseNode, { kind: "TimeOnlyClause" }>
): AttachmentNode | null {
  const time = firstTime(clause.tokens);
  if (!time) {
    return null;
  }

  return {
    kind: "AttachedTime",
    target: "nearest-event",
    time,
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
        ast.diagnostics.push(
          diag(
            "OVERRIDE_WITHOUT_BASE",
            "override clause has no base event to attach to",
            clause.spanText
          )
        );
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

    ast.diagnostics.push(
      diag(
        "INSTRUCTION_IGNORED",
        "instruction clause is ignored",
        clause.spanText
      )
    );
  }

  return ast;
}
