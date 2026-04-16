import { diag } from "./shared/diagnostics";
import type {
  AttachmentNode,
  BaseScheduleNode,
  ClauseNode,
  DateSpec,
  DurationSpec,
  EnumerationVariantNode,
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

function mergedContent(tokens: Token[]): string | undefined {
  const text = tokens
    .filter((token) => token.kind === "CONTENT")
    .map((token) => token.raw.trim())
    .filter((textPart) => textPart.length > 0)
    .join("");

  return text.length > 0 ? text : undefined;
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

export function buildAST(clauses: ClauseNode[]): ScheduleAST {
  const ast: ScheduleAST = {
    base: null,
    sequences: [],
    overrides: [],
    attachments: [],
    enumerations: [],
    diagnostics: [],
  };

  for (const clause of clauses) {
    if (clause.kind === "EventClause") {
      const connectiveRaw = firstConnectiveRaw(clause.tokens);

      if (connectiveRaw) {
        if (!ast.base) {
          ast.diagnostics.push(
            diag(
              "CONNECTIVE_WITHOUT_BASE",
              "sequence clause has no previous base event",
              clause.spanText
            )
          );
          continue;
        }

        ast.sequences.push(buildSequenceNode(clause, connectiveRaw));
        continue;
      }

      if (!ast.base) {
        ast.base = buildBaseNode(clause);
        continue;
      }

      ast.diagnostics.push(
        diag(
          "MULTIPLE_BASE_EVENTS_NOT_IMPLEMENTED",
          "multiple independent base events are not implemented yet",
          clause.spanText
        )
      );
      continue;
    }

    if (clause.kind === "TimeOnlyClause") {
      const attachedTime = buildAttachedTime(clause);

      if (!ast.base || !attachedTime) {
        ast.diagnostics.push(
          diag(
            "TIME_ONLY_WITHOUT_BASE",
            "time-only clause has no base event to attach to",
            clause.spanText
          )
        );
        continue;
      }

      ast.attachments.push(attachedTime);
      continue;
    }

    if (clause.kind === "OverrideClause") {
      if (!ast.base) {
        ast.diagnostics.push(
          diag(
            "OVERRIDE_WITHOUT_BASE",
            "override clause has no base event to attach to",
            clause.spanText
          )
        );
        continue;
      }

      ast.overrides.push(buildOverrideNode(clause));
      continue;
    }

    if (clause.kind === "EnumerationClause") {
      if (!ast.base) {
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

      ast.enumerations.push(...variants);
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
