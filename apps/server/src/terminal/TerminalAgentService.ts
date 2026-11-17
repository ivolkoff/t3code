import {
  OrchestratorMcpFailure,
  type TerminalMcpCloseResult,
  type TerminalMcpCursorResult,
  type TerminalMcpListResult,
  type TerminalMcpOpenResult,
  type TerminalMcpReadResult,
  type TerminalMcpSource,
  type TerminalMcpWaitInput,
  type TerminalMcpWaitResult,
  type TerminalSessionStatus,
} from "@t3tools/contracts";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  projectScriptTerminalInput,
} from "@t3tools/shared/projectScripts";
import xtermHeadless, { type IMarker, type Terminal } from "@xterm/headless";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

import * as TerminalManager from "./Manager.ts";
import { watchShellReadiness } from "./shellReadiness.ts";
import { encodeTerminalKey } from "./terminalKeys.ts";

export interface TerminalTarget {
  readonly threadId: string;
  readonly terminalId: string;
}

type WaitOptions = Omit<TerminalMcpWaitInput, "threadId" | "terminalId">;

type Signal =
  | { readonly _tag: "output" }
  | { readonly _tag: "exited"; readonly exitCode: number | null }
  | { readonly _tag: "commandExited" };

interface Screen {
  readonly term: Terminal;
  readonly ready: Deferred.Deferred<void, OrchestratorMcpFailure>;
  stop: () => void;
}

/** Where the screen's cursor stood when an input returned this cursor value. */
interface InputMark {
  readonly marker: IMarker;
  readonly col: number;
}

interface TerminalState {
  label: string;
  status: TerminalSessionStatus | "closed";
  exitCode: number | null;
  hasRunningSubprocess: boolean;
  /** Length of live output seen since the service started; never resets. */
  cursor: number;
  lastCommandExitCursor: number | null;
  readonly waiters: Set<Queue.Queue<Signal>>;
  screen: Screen | undefined;
  readonly marks: Map<number, InputMark>;
}

// The package is CommonJS without named exports Node ESM can see.
const XtermTerminal = xtermHeadless.Terminal;

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const SCROLLBACK = 5_000;
const DEFAULT_READ_LINES = 50;
const DEFAULT_WAIT_TEXT_LINES = 20;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const QUIET_MS = 100;
const MAX_QUIET_WAIT_MS = 500;
const SHELL_READY_TIMEOUT = "10 seconds";
const MAX_INPUT_MARKS = 16;
// RIS, queued with the output so a reset cannot overtake chunks xterm has not parsed yet.
const RESET = "\x1bc";

const failure = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });

const keyOf = (target: TerminalTarget) => `${target.threadId}/${target.terminalId}`;

function screenLines(
  term: Terminal,
  source: TerminalMcpSource,
  lines: number,
  from?: InputMark,
): string {
  const buffer = term.buffer.active;
  if (source === "visible") {
    const rows: string[] = [];
    for (let y = buffer.baseY; y < buffer.baseY + term.rows; y += 1) {
      rows.push(buffer.getLine(y)?.translateToString(true) ?? "");
    }
    while (rows.length > 0 && rows.at(-1) === "") rows.pop();
    return rows.slice(-lines).join("\n");
  }
  let last = buffer.length - 1;
  while (last >= 0 && (buffer.getLine(last)?.translateToString(true) ?? "") === "") last -= 1;
  // A marker trimmed out of the scrollback means everything left is newer than it.
  const start = from && !from.marker.isDisposed ? from.marker.line : 0;
  const startCol = from && !from.marker.isDisposed ? from.col : 0;
  const out: string[] = [];
  for (let y = start; y <= last; y += 1) {
    const line = buffer.getLine(y);
    const text = line?.translateToString(true, y === start ? startCol : 0) ?? "";
    if (source === "recent-unwrapped" && line?.isWrapped && out.length > 0 && y !== start) {
      out[out.length - 1] += text;
    } else {
      out.push(text);
    }
  }
  return out.slice(-lines).join("\n");
}

export class TerminalAgentService extends Context.Service<
  TerminalAgentService,
  {
    readonly list: (threadId: string) => Effect.Effect<TerminalMcpListResult>;
    readonly open: (input: {
      readonly threadId: string;
      readonly workspaceRoot: string;
      readonly worktreePath: string | null;
      readonly command?: string;
    }) => Effect.Effect<TerminalMcpOpenResult, OrchestratorMcpFailure>;
    readonly sendText: (
      target: TerminalTarget,
      text: string,
    ) => Effect.Effect<TerminalMcpCursorResult, OrchestratorMcpFailure>;
    readonly sendKeys: (
      target: TerminalTarget,
      keys: ReadonlyArray<string>,
    ) => Effect.Effect<TerminalMcpCursorResult, OrchestratorMcpFailure>;
    readonly read: (
      target: TerminalTarget,
      options: {
        readonly source?: TerminalMcpSource | undefined;
        readonly lines?: number | undefined;
      },
    ) => Effect.Effect<TerminalMcpReadResult, OrchestratorMcpFailure>;
    readonly wait: (
      target: TerminalTarget,
      options: WaitOptions,
    ) => Effect.Effect<TerminalMcpWaitResult, OrchestratorMcpFailure>;
    readonly close: (
      target: TerminalTarget,
    ) => Effect.Effect<TerminalMcpCloseResult, OrchestratorMcpFailure>;
  }
>()("t3/terminal/TerminalAgentService") {}

export const make = Effect.gen(function* () {
  const terminalManager = yield* TerminalManager.TerminalManager;
  const random = yield* SecureRandom.SecureRandom;
  const states = new Map<string, TerminalState>();

  const upsertState = (
    target: TerminalTarget,
    fields: { label: string; status: TerminalSessionStatus; exitCode: number | null },
    hasRunningSubprocess = false,
  ) => {
    const existing = states.get(keyOf(target));
    if (existing) {
      existing.label = fields.label;
      existing.status = fields.status;
      existing.exitCode = fields.exitCode;
      // Activity events own this flag: a roster update can land first and hide the transition.
      return existing;
    }
    const state: TerminalState = {
      ...fields,
      hasRunningSubprocess,
      cursor: 0,
      lastCommandExitCursor: null,
      waiters: new Set(),
      screen: undefined,
      marks: new Map(),
    };
    states.set(keyOf(target), state);
    return state;
  };

  const dropScreen = (state: TerminalState) => {
    state.screen?.stop();
    state.screen?.term.dispose();
    state.screen = undefined;
    state.marks.clear();
  };

  const signal = (state: TerminalState, value: Signal) =>
    Effect.forEach([...state.waiters], (queue) => Queue.offer(queue, value), { discard: true });

  const unsubscribeMetadata = yield* terminalManager.subscribeMetadata((event) =>
    Effect.sync(() => {
      // The manager removes the roster entry before publishing `closed`; that event cleans up.
      if (event.type === "remove") return;
      const summaries = event.type === "snapshot" ? event.terminals : [event.terminal];
      for (const summary of summaries) upsertState(summary, summary, summary.hasRunningSubprocess);
    }),
  );

  const unsubscribeEvents = yield* terminalManager.subscribe((event) => {
    if (event.type === "started" || event.type === "restarted") {
      // The manager resets the subprocess flag for a new shell without an activity event.
      upsertState(event, event.snapshot).hasRunningSubprocess = false;
      return Effect.void;
    }
    const state = states.get(keyOf(event));
    if (!state) return Effect.void;
    switch (event.type) {
      case "output":
        state.cursor += event.data.length;
        return signal(state, { _tag: "output" });
      case "exited":
        state.status = "exited";
        state.exitCode = event.exitCode;
        state.hasRunningSubprocess = false;
        return signal(state, { _tag: "exited", exitCode: event.exitCode });
      case "closed":
        dropScreen(state);
        states.delete(keyOf(event));
        state.status = "closed";
        return signal(state, { _tag: "exited", exitCode: null });
      case "activity": {
        const finished = state.hasRunningSubprocess && !event.hasRunningSubprocess;
        state.hasRunningSubprocess = event.hasRunningSubprocess;
        state.label = event.label;
        if (!finished) return Effect.void;
        state.lastCommandExitCursor = state.cursor;
        return signal(state, { _tag: "commandExited" });
      }
      default:
        return Effect.void;
    }
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unsubscribeMetadata();
      unsubscribeEvents();
      for (const state of states.values()) dropScreen(state);
    }),
  );

  const requireState = (target: TerminalTarget) =>
    Effect.suspend(() => {
      const state = states.get(keyOf(target));
      return state
        ? Effect.succeed(state)
        : Effect.fail(
            failure("terminal_not_found", `No terminal ${target.terminalId} in this thread.`),
          );
    });

  const requireWritable = (target: TerminalTarget) =>
    requireState(target).pipe(
      Effect.filterOrFail(
        (state) => state.status !== "exited" && state.status !== "closed",
        () => failure("invalid_request", `Terminal ${target.terminalId} has exited.`),
      ),
    );

  const ensureScreen = Effect.fn("TerminalAgentService.ensureScreen")(function* (
    target: TerminalTarget,
    state: TerminalState,
  ) {
    if (state.screen) {
      yield* Deferred.await(state.screen.ready);
      return state.screen;
    }
    const term = new XtermTerminal({
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
    const screen: Screen = {
      term,
      ready: Deferred.makeUnsafe<void, OrchestratorMcpFailure>(),
      stop: () => {},
    };
    state.screen = screen;
    // Listeners run in turn inside the manager's fan-out, so parsing is never awaited here.
    screen.stop = yield* terminalManager
      .observeStream(target, (event) =>
        Effect.sync(() => {
          switch (event.type) {
            case "snapshot":
            case "restarted":
              // A relaunched session arrives as a fresh snapshot with cleared history.
              if (event.snapshot.cols && event.snapshot.rows) {
                term.resize(event.snapshot.cols, event.snapshot.rows);
              }
              term.write(RESET + event.snapshot.history);
              return;
            case "output":
              term.write(event.data);
              return;
            case "cleared":
              term.write(RESET);
              return;
            case "activity":
              if (event.cols && event.rows) term.resize(event.cols, event.rows);
              return;
            default:
              return;
          }
        }),
      )
      .pipe(
        Effect.mapError((cause) => failure("orchestration_error", cause.message)),
        Effect.tapError((error) => Deferred.fail(screen.ready, error)),
        Effect.onError(() =>
          Effect.sync(() => {
            term.dispose();
            state.screen = undefined;
          }),
        ),
      );
    yield* Deferred.succeed(screen.ready, undefined);
    return screen;
  });

  const flushedScreen = Effect.fnUntraced(function* (target: TerminalTarget, state: TerminalState) {
    const { term } = yield* ensureScreen(target, state);
    yield* Effect.callback<void>((resume) => {
      term.write("", () => resume(Effect.void));
    });
    return term;
  });

  // Untraced: runs on every wait check.
  const render = Effect.fnUntraced(function* (
    target: TerminalTarget,
    state: TerminalState,
    source: TerminalMcpSource,
    lines: number,
    from?: InputMark,
  ) {
    if (state.status === "closed") return "";
    const term = yield* flushedScreen(target, state);
    return screenLines(term, source, lines, from);
  });

  const write = Effect.fn("TerminalAgentService.write")(function* (
    target: TerminalTarget,
    data: string,
  ) {
    const state = yield* requireWritable(target);
    // Mark where this input lands, so `wait` with its cursor skips text already on screen.
    const term = yield* flushedScreen(target, state);
    const cursor = state.cursor;
    // No marker on the alternate screen: `wait` then falls back to "any output after since".
    const marker = term.registerMarker(0);
    if (marker && !state.marks.has(cursor)) {
      state.marks.set(cursor, { marker, col: term.buffer.active.cursorX });
      for (const [key, mark] of state.marks) {
        if (state.marks.size <= MAX_INPUT_MARKS) break;
        mark.marker.dispose();
        state.marks.delete(key);
      }
    } else {
      marker?.dispose();
    }
    yield* terminalManager
      .write({ threadId: target.threadId, terminalId: target.terminalId, data })
      .pipe(Effect.mapError((cause) => failure("orchestration_error", cause.message)));
    return { cursor };
  });

  const list: TerminalAgentService["Service"]["list"] = (threadId) =>
    Effect.sync(() => ({
      terminals: [...states.entries()]
        .filter(([key]) => key.startsWith(`${threadId}/`))
        .map(([key, state]) => ({
          terminalId: key.slice(threadId.length + 1),
          label: state.label,
          running: state.status === "running" || state.status === "starting",
          hasRunningSubprocess: state.hasRunningSubprocess,
        })),
    }));

  const open: TerminalAgentService["Service"]["open"] = Effect.fn("TerminalAgentService.open")(
    function* (input) {
      const terminalId = `agent-${(yield* random.uuidV4()).slice(0, 8)}`;
      const target = { threadId: input.threadId, terminalId };
      const project = { cwd: input.workspaceRoot };
      const readiness = input.command
        ? yield* watchShellReadiness(terminalManager, { ...target, onStartupPrompt: Effect.void })
        : undefined;
      const snapshot = yield* terminalManager
        .open({
          ...target,
          cwd: projectScriptCwd({ project, worktreePath: input.worktreePath }),
          ...(input.worktreePath ? { worktreePath: input.worktreePath } : {}),
          env: projectScriptRuntimeEnv({ project, worktreePath: input.worktreePath }),
          stopOnSettle: true,
        })
        .pipe(
          Effect.mapError((cause) => failure("orchestration_error", cause.message)),
          Effect.onError(() => Effect.sync(() => readiness?.unsubscribe())),
        );
      let { cursor } = upsertState(target, snapshot);
      if (input.command && readiness) {
        const outcome = yield* readiness.wait.pipe(
          Effect.timeoutOption(SHELL_READY_TIMEOUT),
          Effect.ensuring(Effect.sync(() => readiness.unsubscribe())),
        );
        if (Option.getOrUndefined(outcome) === "exited") {
          return yield* failure("invalid_request", "The shell exited during startup.");
        }
        // Startup children (nvm, fnm) end before this point; their exit is not the command's.
        cursor = (yield* write(target, projectScriptTerminalInput(input.command))).cursor;
      }
      return { terminalId, cursor };
    },
  );

  // Enter is CR on a terminal; LF only works where the line discipline translates it.
  const sendText: TerminalAgentService["Service"]["sendText"] = Effect.fn(
    "TerminalAgentService.sendText",
  )(function* (target, text) {
    return yield* write(target, text.replace(/\r?\n/g, "\r"));
  });

  const sendKeys: TerminalAgentService["Service"]["sendKeys"] = Effect.fn(
    "TerminalAgentService.sendKeys",
  )(function* (target, keys) {
    const encoded = keys.map(encodeTerminalKey);
    const unknown = keys.filter((_, index) => encoded[index] === undefined);
    if (unknown.length > 0) {
      return yield* failure("invalid_request", `Unknown keys: ${unknown.join(", ")}.`);
    }
    return yield* write(target, encoded.join(""));
  });

  const read: TerminalAgentService["Service"]["read"] = Effect.fn("TerminalAgentService.read")(
    function* (target, options) {
      const state = yield* requireState(target);
      const text = yield* render(
        target,
        state,
        options.source ?? "recent",
        options.lines ?? DEFAULT_READ_LINES,
      );
      return { text, cursor: state.cursor };
    },
  );

  const compileMatcher = (options: WaitOptions) =>
    Effect.suspend(() => {
      if ((options.match === undefined) === (options.regex === undefined)) {
        return Effect.fail(failure("invalid_request", "Pass exactly one of match or regex."));
      }
      if (options.match !== undefined) {
        const literal = options.match;
        return Effect.succeed((text: string) => text.includes(literal));
      }
      try {
        const pattern = new RegExp(options.regex!, "m");
        return Effect.succeed((text: string) => pattern.test(text));
      } catch (cause) {
        return Effect.fail(failure("invalid_request", `Invalid regex: ${String(cause)}`));
      }
    });

  const wait: TerminalAgentService["Service"]["wait"] = Effect.fn("TerminalAgentService.wait")(
    function* (target, options) {
      const matches = yield* compileMatcher(options);
      const state = yield* requireState(target);
      const source = options.source ?? "recent";
      const finish = (status: TerminalMcpWaitResult["status"], exitCode?: number | null) =>
        render(target, state, source, options.lines ?? DEFAULT_WAIT_TEXT_LINES).pipe(
          Effect.map((text) => ({
            status,
            text,
            cursor: state.cursor,
            ...(exitCode === undefined ? {} : { exitCode }),
          })),
        );
      if (state.status === "exited" || state.status === "closed") {
        return yield* finish("exited", state.exitCode);
      }
      const since =
        options.since === undefined ? undefined : options.since > state.cursor ? 0 : options.since;
      const mark = since !== undefined && source !== "visible" ? state.marks.get(since) : undefined;
      const isMatch = Effect.gen(function* () {
        if (since !== undefined && state.cursor <= since) return false;
        return matches(
          yield* render(target, state, source, options.lines ?? DEFAULT_READ_LINES, mark),
        );
      });

      const queue = yield* Queue.unbounded<Signal>();
      state.waiters.add(queue);
      const loop = Effect.gen(function* () {
        if (yield* isMatch) return { status: "matched" as const };
        if (
          since !== undefined &&
          state.lastCommandExitCursor !== null &&
          state.lastCommandExitCursor > since
        ) {
          return { status: "commandExited" as const };
        }
        while (true) {
          const first = yield* Queue.take(queue);
          if (first._tag === "exited")
            return { status: "exited" as const, exitCode: first.exitCode };
          let commandExited = first._tag === "commandExited";
          if (first._tag === "output") {
            const startedAt = yield* Clock.currentTimeMillis;
            while (true) {
              const remaining = MAX_QUIET_WAIT_MS - ((yield* Clock.currentTimeMillis) - startedAt);
              if (remaining <= 0) break;
              const next = yield* Queue.take(queue).pipe(
                Effect.timeoutOption(Math.min(QUIET_MS, remaining)),
              );
              if (Option.isNone(next)) break;
              if (next.value._tag === "exited") {
                return { status: "exited" as const, exitCode: next.value.exitCode };
              }
              if (next.value._tag === "commandExited") commandExited = true;
            }
          }
          if (yield* isMatch) return { status: "matched" as const };
          if (commandExited) return { status: "commandExited" as const };
        }
      });
      const outcome = yield* loop.pipe(
        Effect.timeoutOption(options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS),
        Effect.ensuring(Effect.sync(() => state.waiters.delete(queue))),
      );
      if (Option.isNone(outcome)) return yield* finish("timedOut");
      const value = outcome.value;
      return yield* finish(value.status, "exitCode" in value ? value.exitCode : undefined);
    },
  );

  const close: TerminalAgentService["Service"]["close"] = (target) =>
    requireState(target).pipe(
      Effect.andThen(
        terminalManager
          .close({ threadId: target.threadId, terminalId: target.terminalId })
          .pipe(Effect.mapError((cause) => failure("orchestration_error", cause.message))),
      ),
      Effect.as({ closed: true as const }),
    );

  return TerminalAgentService.of({
    list,
    open,
    sendText,
    sendKeys,
    read,
    wait,
    close,
  });
});

export const layer = Layer.effect(TerminalAgentService, make);
