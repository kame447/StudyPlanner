import { diag } from "./shared/diagnostics";
import type {
  AttachmentNode,
  BaseScheduleNode,
  ClauseNode,
  DurationSpec,
  OverrideScheduleNode,
  ScheduleAST,
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

function firstDuration(tokens: Token[]): DurationSpec | undefined {
  const token = tokens.find((current) => current.kind === "DURATION");
  return token?.kind === "DURATION" ? token.value : undefined;
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
    timeSpec: firstTime(clause.tokens),
    durationSpec: firstDuration(clause.tokens),
    repeatSpec: repeatToken?.kind === "REPEAT" ? repeatToken.value : undefined,
    dayTypeSpec:
      dayTypeToken?.kind === "DAYTYPE" ? dayTypeToken.value : undefined,
    weekdaySpecs: weekdaySpecs.length > 0 ? weekdaySpecs : undefined,
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

export function buildAST(clauses: ClauseNode[]): ScheduleAST {
  const ast: ScheduleAST = {
    base: null,
    overrides: [],
    attachments: [],
    enumerations: [],
    diagnostics: [],
  };

  for (const clause of clauses) {
    if (clause.kind === "EventClause") {
      ast.base = buildBaseNode(clause);
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
      ast.diagnostics.push(
        diag(
          "ENUM_NOT_IMPLEMENTED",
          "enumeration is not implemented yet",
          clause.spanText
        )
      );
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
