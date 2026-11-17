import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { TERMINAL_WRITE_MAX_LENGTH } from "./terminal.ts";

export const TerminalMcpSource = Schema.Literals([
  "visible",
  "recent",
  "recent-unwrapped",
]).annotate({
  description:
    "visible: current screen. recent (default): last lines. recent-unwrapped: wraps joined.",
});
export type TerminalMcpSource = typeof TerminalMcpSource.Type;

const threadIdField = {
  threadId: Schema.optional(
    ThreadId.annotate({ description: "Required outside a thread; inside, only your own." }),
  ),
};
const targetFields = {
  ...threadIdField,
  terminalId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
};
const linesField = Schema.optional(
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5_000 })),
);

export const TerminalMcpListInput = Schema.Struct(threadIdField);
export type TerminalMcpListInput = typeof TerminalMcpListInput.Type;

export const TerminalMcpOpenInput = Schema.Struct({
  ...threadIdField,
  command: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(TERMINAL_WRITE_MAX_LENGTH)).annotate({
      description: "Typed into the shell once it is ready.",
    }),
  ),
});
export type TerminalMcpOpenInput = typeof TerminalMcpOpenInput.Type;

export const TerminalMcpSendTextInput = Schema.Struct({
  ...targetFields,
  text: Schema.String.check(Schema.isNonEmpty())
    .check(Schema.isMaxLength(TERMINAL_WRITE_MAX_LENGTH))
    .annotate({ description: "Literal text; end with \\n to press Enter." }),
});
export type TerminalMcpSendTextInput = typeof TerminalMcpSendTextInput.Type;

export const TerminalMcpSendKeysInput = Schema.Struct({
  ...targetFields,
  keys: Schema.NonEmptyArray(TrimmedNonEmptyString).annotate({
    description:
      "enter, tab, esc, backspace, space, up, down, left, right, home, end, pageup, pagedown, delete, ctrl-a..ctrl-z.",
  }),
});
export type TerminalMcpSendKeysInput = typeof TerminalMcpSendKeysInput.Type;

export const TerminalMcpReadInput = Schema.Struct({
  ...targetFields,
  source: Schema.optional(TerminalMcpSource),
  lines: linesField,
});
export type TerminalMcpReadInput = typeof TerminalMcpReadInput.Type;

export const TerminalMcpWaitInput = Schema.Struct({
  ...targetFields,
  match: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  regex: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  source: Schema.optional(TerminalMcpSource),
  lines: linesField,
  timeoutMs: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 45_000 })).annotate({
      description: "Default 30000.",
    }),
  ),
  since: Schema.optional(
    NonNegativeInt.annotate({
      description: "Cursor from your last call; match only newer output.",
    }),
  ),
});
export type TerminalMcpWaitInput = typeof TerminalMcpWaitInput.Type;

export const TerminalMcpCloseInput = Schema.Struct(targetFields);
export type TerminalMcpCloseInput = typeof TerminalMcpCloseInput.Type;

export const TerminalMcpListResult = Schema.Struct({
  terminals: Schema.Array(
    Schema.Struct({
      terminalId: Schema.String,
      label: Schema.String,
      running: Schema.Boolean,
      hasRunningSubprocess: Schema.Boolean,
    }),
  ),
});
export type TerminalMcpListResult = typeof TerminalMcpListResult.Type;

export const TerminalMcpOpenResult = Schema.Struct({
  terminalId: Schema.String,
  cursor: NonNegativeInt,
});
export type TerminalMcpOpenResult = typeof TerminalMcpOpenResult.Type;

export const TerminalMcpCursorResult = Schema.Struct({ cursor: NonNegativeInt });
export type TerminalMcpCursorResult = typeof TerminalMcpCursorResult.Type;

export const TerminalMcpReadResult = Schema.Struct({
  text: Schema.String,
  cursor: NonNegativeInt,
});
export type TerminalMcpReadResult = typeof TerminalMcpReadResult.Type;

export const TerminalMcpWaitResult = Schema.Struct({
  status: Schema.Literals(["matched", "timedOut", "exited", "commandExited"]),
  text: Schema.String,
  cursor: NonNegativeInt,
  exitCode: Schema.optional(Schema.NullOr(Schema.Int)),
});
export type TerminalMcpWaitResult = typeof TerminalMcpWaitResult.Type;

export const TerminalMcpCloseResult = Schema.Struct({ closed: Schema.Literal(true) });
export type TerminalMcpCloseResult = typeof TerminalMcpCloseResult.Type;
