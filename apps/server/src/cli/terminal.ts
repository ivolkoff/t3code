import {
  TerminalMcpCloseResult,
  TerminalMcpCursorResult,
  TerminalMcpListResult,
  TerminalMcpOpenResult,
  TerminalMcpReadResult,
  TerminalMcpWaitResult,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import { projectLocationFlags } from "./config.ts";
import { decodeThreadId, printJson, reportThreadErrors, withThreadTools } from "./thread.ts";

const threadFlag = Flag.String("thread").pipe(Flag.withDescription("Thread id."));
const terminalArgument = Argument.String("terminal").pipe(
  Argument.withDescription("Terminal id, from `t3 terminal list`."),
);
const sourceFlag = Flag.String("source").pipe(
  Flag.withDescription("visible, recent (default), or recent-unwrapped."),
  Flag.optional,
);
const linesFlag = Flag.Int("lines").pipe(Flag.withDescription("How many lines."), Flag.optional);

const optional = <K extends string, V>(key: K, value: Option.Option<V>) =>
  Option.match(value, { onNone: () => ({}), onSome: (v) => ({ [key]: v }) });

const callTool = Effect.fn("cli.terminal.callTool")(function* <S extends Schema.Decoder<unknown>>(
  flags: { readonly baseDir: Option.Option<string>; readonly thread: string },
  tool: string,
  args: Readonly<Record<string, unknown>>,
  schema: S,
  print: (result: S["Type"]) => Effect.Effect<void> = printJson,
) {
  const threadId = yield* decodeThreadId(flags.thread);
  yield* withThreadTools({ baseDir: flags.baseDir, json: true }, (tools) =>
    tools.call(tool, { threadId, ...args }, schema).pipe(Effect.flatMap(print)),
  );
}, reportThreadErrors);

const listCommand = Command.make("list", { ...projectLocationFlags, thread: threadFlag }).pipe(
  Command.withDescription("List a thread's terminals."),
  Command.withHandler((flags) => callTool(flags, "terminal_list", {}, TerminalMcpListResult)),
);

const openCommand = Command.make("open", {
  ...projectLocationFlags,
  thread: threadFlag,
  command: Flag.String("command").pipe(
    Flag.withDescription("Command to type once the shell is ready."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Open a terminal in the thread's worktree."),
  Command.withHandler((flags) =>
    callTool(flags, "terminal_open", optional("command", flags.command), TerminalMcpOpenResult),
  ),
);

const sendTextCommand = Command.make("send-text", {
  ...projectLocationFlags,
  thread: threadFlag,
  terminal: terminalArgument,
  text: Argument.String("text").pipe(
    Argument.withDescription("Literal text; include \\n for Enter."),
  ),
}).pipe(
  Command.withDescription("Type text into a terminal."),
  Command.withHandler((flags) =>
    callTool(
      flags,
      "terminal_send_text",
      { terminalId: flags.terminal, text: flags.text },
      TerminalMcpCursorResult,
    ),
  ),
);

const sendKeysCommand = Command.make("send-keys", {
  ...projectLocationFlags,
  thread: threadFlag,
  terminal: terminalArgument,
  keys: Argument.String("keys").pipe(
    Argument.withDescription("Key names such as enter, esc, ctrl-c."),
    Argument.atLeast(1),
  ),
}).pipe(
  Command.withDescription("Press keys in a terminal."),
  Command.withHandler((flags) =>
    callTool(
      flags,
      "terminal_send_keys",
      { terminalId: flags.terminal, keys: flags.keys },
      TerminalMcpCursorResult,
    ),
  ),
);

const readCommand = Command.make("read", {
  ...projectLocationFlags,
  thread: threadFlag,
  terminal: terminalArgument,
  source: sourceFlag,
  lines: linesFlag,
}).pipe(
  Command.withDescription("Print a terminal's screen or recent lines."),
  Command.withHandler((flags) =>
    callTool(
      flags,
      "terminal_read",
      {
        terminalId: flags.terminal,
        ...optional("source", flags.source),
        ...optional("lines", flags.lines),
      },
      TerminalMcpReadResult,
      (result) => Console.log(result.text),
    ),
  ),
);

const waitCommand = Command.make("wait", {
  ...projectLocationFlags,
  thread: threadFlag,
  terminal: terminalArgument,
  match: Flag.String("match").pipe(
    Flag.withDescription("Literal text to wait for."),
    Flag.optional,
  ),
  regex: Flag.String("regex").pipe(Flag.withDescription("Regex to wait for."), Flag.optional),
  source: sourceFlag,
  lines: linesFlag,
  timeout: Flag.Int("timeout").pipe(
    Flag.withDescription("Milliseconds, at most 45000. Default 30000."),
    Flag.optional,
  ),
  since: Flag.Int("since").pipe(
    Flag.withDescription("Cursor from an earlier call; match only newer output."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Wait for text in a terminal, the command's exit, or the timeout."),
  Command.withHandler((flags) =>
    callTool(
      flags,
      "terminal_wait",
      {
        terminalId: flags.terminal,
        ...optional("match", flags.match),
        ...optional("regex", flags.regex),
        ...optional("source", flags.source),
        ...optional("lines", flags.lines),
        ...optional("timeoutMs", flags.timeout),
        ...optional("since", flags.since),
      },
      TerminalMcpWaitResult,
    ),
  ),
);

const closeCommand = Command.make("close", {
  ...projectLocationFlags,
  thread: threadFlag,
  terminal: terminalArgument,
}).pipe(
  Command.withDescription("Close a terminal."),
  Command.withHandler((flags) =>
    callTool(flags, "terminal_close", { terminalId: flags.terminal }, TerminalMcpCloseResult),
  ),
);

export const terminalCommand = Command.make("terminal").pipe(
  Command.withDescription(
    "Open, type into, read, and wait on a thread's terminals on the running server.",
  ),
  Command.withSubcommands([
    listCommand,
    openCommand,
    sendTextCommand,
    sendKeysCommand,
    readCommand,
    waitCommand,
    closeCommand,
  ]),
);
