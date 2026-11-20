import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  ThreadId,
  type TerminalAttachStreamEvent,
  type TerminalEvent,
  type TerminalMetadataStreamEvent,
  type TerminalOpenInput,
  type TerminalSessionSnapshot,
} from "@t3tools/contracts";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  projectScriptTerminalInput,
} from "@t3tools/shared/projectScripts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import { TestClock } from "effect/testing";

import * as TerminalManager from "./Manager.ts";
import * as TerminalAgentService from "./TerminalAgentService.ts";

const threadId = ThreadId.make("thread-1");
const otherThreadId = ThreadId.make("thread-2");
const terminalId = "term-1";
const target = { threadId, terminalId };

const snapshotOf = (
  input: Partial<TerminalSessionSnapshot> & { threadId: string; terminalId: string },
): TerminalSessionSnapshot => ({
  cwd: "/repo",
  worktreePath: null,
  status: "running",
  pid: 123,
  history: "",
  exitCode: null,
  exitSignal: null,
  label: "zsh",
  updatedAt: "2026-01-01T00:00:00.000Z",
  sequence: 0,
  ...input,
});

const summaryOf = (snapshot: TerminalSessionSnapshot) => ({
  threadId: snapshot.threadId,
  terminalId: snapshot.terminalId,
  cwd: snapshot.cwd,
  worktreePath: snapshot.worktreePath,
  status: snapshot.status,
  pid: snapshot.pid,
  exitCode: snapshot.exitCode,
  exitSignal: snapshot.exitSignal,
  hasRunningSubprocess: false,
  label: snapshot.label,
  updatedAt: snapshot.updatedAt,
});

const makeHarness = Effect.fn(function* (
  options: {
    readonly sessions?: ReadonlyArray<TerminalSessionSnapshot>;
    /** Holds `observeStream` back, as the manager's thread lock can. */
    readonly observeGate?: Deferred.Deferred<void>;
  } = {},
) {
  const sessions = new Map(
    (options.sessions ?? [snapshotOf(target)]).map((s) => [`${s.threadId}/${s.terminalId}`, s]),
  );
  const listeners = new Set<(event: TerminalEvent) => Effect.Effect<void>>();
  const metadataListeners = new Set<(event: TerminalMetadataStreamEvent) => Effect.Effect<void>>();
  const observers = new Set<{
    key: string;
    listener: (event: TerminalAttachStreamEvent) => Effect.Effect<void>;
  }>();
  const opened = yield* Queue.unbounded<TerminalOpenInput>();
  const writes = yield* Queue.unbounded<string>();
  let sequence = 0;

  const terminals = Layer.mock(TerminalManager.TerminalManager)({
    subscribe: (listener) =>
      Effect.sync(() => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    subscribeMetadata: (listener: (event: TerminalMetadataStreamEvent) => Effect.Effect<void>) =>
      listener({ type: "snapshot", terminals: [...sessions.values()].map(summaryOf) }).pipe(
        Effect.andThen(
          Effect.sync(() => {
            metadataListeners.add(listener);
            return () => metadataListeners.delete(listener);
          }),
        ),
      ),
    observeStream: (input, listener) =>
      Effect.gen(function* () {
        const key = `${input.threadId}/${input.terminalId}`;
        const session = sessions.get(key);
        if (!session) return yield* Effect.die(`unknown ${key}`);
        if (options.observeGate) yield* Deferred.await(options.observeGate);
        yield* listener({ type: "snapshot", snapshot: session });
        const entry = { key, listener };
        observers.add(entry);
        return () => observers.delete(entry);
      }),
    open: (input) =>
      Effect.gen(function* () {
        yield* Queue.offer(opened, input);
        const session = snapshotOf({
          threadId: input.threadId,
          terminalId: input.terminalId,
          cwd: input.cwd,
        });
        sessions.set(`${input.threadId}/${input.terminalId}`, session);
        return session;
      }),
    write: (input) => Queue.offer(writes, input.data).pipe(Effect.asVoid),
    close: () => Effect.void,
  });

  const service = yield* TerminalAgentService.make.pipe(
    Effect.provide(Layer.mergeAll(terminals, NodeCrypto.layer)),
  );

  const emit = (
    event: { type: TerminalEvent["type"] } & Record<string, unknown>,
    on: { threadId: string; terminalId: string } = target,
  ) =>
    Effect.gen(function* () {
      sequence += 1;
      const full = { ...on, sequence, ...event } as TerminalEvent;
      const key = `${on.threadId}/${on.terminalId}`;
      const session = sessions.get(key);
      if (session && full.type === "output") {
        sessions.set(key, { ...session, history: session.history + full.data, sequence });
      }
      for (const listener of listeners) yield* listener(full);
      for (const observer of observers) {
        if (observer.key === `${on.threadId}/${on.terminalId}` && full.type !== "started") {
          yield* observer.listener(full as TerminalAttachStreamEvent);
        }
      }
    });
  const output = (data: string, on?: { threadId: string; terminalId: string }) =>
    emit({ type: "output", data }, on);

  const upsertSubprocess = (hasRunningSubprocess: boolean) =>
    Effect.forEach(
      metadataListeners,
      (listener) =>
        listener({
          type: "upsert",
          terminal: {
            ...summaryOf(sessions.get(`${threadId}/${terminalId}`)!),
            hasRunningSubprocess,
          },
        }),
      { discard: true },
    );

  // A relaunched session reaches an attached stream as a fresh snapshot.
  const observeSnapshot = (history: string) =>
    Effect.forEach(
      observers,
      (observer) =>
        observer.listener({ type: "snapshot", snapshot: snapshotOf({ ...target, history }) }),
      { discard: true },
    );

  const removeFromRoster = () =>
    Effect.forEach(
      metadataListeners,
      (listener) => listener({ type: "remove", threadId, terminalId }),
      { discard: true },
    );

  // xterm parses on a real macrotask; a read flushes after any flush a waiter already queued.
  const settle = service.read(target, {}).pipe(Effect.asVoid);

  return {
    service,
    emit,
    output,
    settle,
    upsertSubprocess,
    removeFromRoster,
    observeSnapshot,
    opened,
    writes,
    sessions,
  };
});

const historyHarness = (history: string) =>
  makeHarness({ sessions: [snapshotOf({ ...target, history })] });

describe("TerminalAgentService.wait", () => {
  it.effect("matches existing output without since", () =>
    Effect.gen(function* () {
      const { service } = yield* historyHarness("db=> ");
      const result = yield* service.wait(target, { regex: "=> $" });
      assert.strictEqual(result.status, "matched");
    }),
  );

  it.effect("with since ignores the old prompt until new output", () =>
    Effect.gen(function* () {
      const { service, output } = yield* historyHarness("db=> ");
      const { cursor } = yield* service.read(target, {});
      const fiber = yield* service
        .wait(target, { regex: "=> $", since: cursor })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("200 millis");
      assert.isUndefined(fiber.pollUnsafe());
      yield* output("select 1;\r\n 1\r\ndb=> ");
      yield* TestClock.adjust("100 millis");
      const result = yield* Fiber.join(fiber);
      assert.strictEqual(result.status, "matched");
      expect(result.text).toContain(" 1");
    }),
  );

  it.effect("with since ignores matching text that was already on screen", () =>
    Effect.gen(function* () {
      const { service, output, settle } = yield* historyHarness("Tests passed\r\n❯ ");
      const { cursor } = yield* service.sendText(target, "npm test\n");
      const fiber = yield* service
        .wait(target, { match: "Tests passed", since: cursor })
        .pipe(Effect.forkChild);
      yield* settle;
      yield* output("npm test\r\nrunning\r\n");
      yield* settle;
      // Let the debounced check finish its real-time flush before the timeout can fire.
      yield* TestClock.adjust("600 millis");
      yield* settle;
      yield* TestClock.adjust("30 seconds");
      assert.strictEqual((yield* Fiber.join(fiber)).status, "timedOut");

      const { cursor: again } = yield* service.sendText(target, "npm test\n");
      const next = yield* service
        .wait(target, { match: "Tests passed", since: again })
        .pipe(Effect.forkChild);
      yield* settle;
      yield* output("npm test\r\nTests passed\r\n❯ ");
      yield* settle;
      yield* TestClock.adjust("600 millis");
      assert.strictEqual((yield* Fiber.join(next)).status, "matched");
    }),
  );

  it.effect("a resize after a relaunch is not a command exit", () =>
    Effect.gen(function* () {
      const { service, emit, settle } = yield* makeHarness();
      yield* emit({ type: "activity", hasRunningSubprocess: true, label: "vim" });
      // The shell dies mid-command; the manager clears the flag without an activity event.
      yield* emit({ type: "started", snapshot: snapshotOf(target) });
      const fiber = yield* service.wait(target, { match: "never" }).pipe(Effect.forkChild);
      yield* settle;
      yield* emit({
        type: "activity",
        hasRunningSubprocess: false,
        label: "zsh",
        cols: 100,
        rows: 30,
      });
      yield* settle;
      yield* TestClock.adjust("30 seconds");
      assert.strictEqual((yield* Fiber.join(fiber)).status, "timedOut");
    }),
  );

  it.effect("returns exited when the terminal exits or closes", () =>
    Effect.gen(function* () {
      const { service, emit } = yield* makeHarness();
      const exited = yield* service.wait(target, { match: "never" }).pipe(Effect.forkChild);
      yield* TestClock.adjust("1 millis");
      yield* emit({ type: "exited", exitCode: 2, exitSignal: null });
      const result = yield* Fiber.join(exited);
      assert.strictEqual(result.status, "exited");
      assert.strictEqual(result.exitCode, 2);

      const second = yield* makeHarness();
      const closed = yield* second.service.wait(target, { match: "never" }).pipe(Effect.forkChild);
      yield* TestClock.adjust("1 millis");
      // The manager drops the roster entry before it publishes `closed`.
      yield* second.removeFromRoster();
      yield* second.emit({ type: "closed" });
      const closedResult = yield* Fiber.join(closed);
      assert.strictEqual(closedResult.status, "exited");
      assert.strictEqual(closedResult.exitCode, null);
    }),
  );

  it.effect("returns exited at once for a terminal that already exited", () =>
    Effect.gen(function* () {
      const { service } = yield* makeHarness({
        sessions: [snapshotOf({ ...target, status: "exited", exitCode: 0 })],
      });
      const result = yield* service.wait(target, { match: "never" });
      assert.strictEqual(result.status, "exited");
    }),
  );

  it.effect("returns commandExited only for a transition after since", () =>
    Effect.gen(function* () {
      const { service, emit, output, settle, upsertSubprocess } = yield* makeHarness();
      const activity = (hasRunningSubprocess: boolean) =>
        emit({ type: "activity", hasRunningSubprocess, label: "psql" });
      const first = yield* service.wait(target, { match: "never" }).pipe(Effect.forkChild);
      yield* settle;
      yield* activity(true);
      yield* upsertSubprocess(true);
      yield* output("bye\r\n");
      // The manager can publish the roster change before the activity event.
      yield* upsertSubprocess(false);
      yield* activity(false);
      yield* settle;
      yield* TestClock.adjust("500 millis");
      const result = yield* Fiber.join(first);
      assert.strictEqual(result.status, "commandExited");

      const again = yield* service
        .wait(target, { match: "never", since: result.cursor })
        .pipe(Effect.forkChild);
      yield* settle;
      yield* TestClock.adjust("30 seconds");
      assert.strictEqual((yield* Fiber.join(again)).status, "timedOut");
    }),
  );

  it.effect("times out with the current cursor", () =>
    Effect.gen(function* () {
      const { service, output } = yield* makeHarness();
      yield* output("abc");
      const fiber = yield* service.wait(target, { match: "never" }).pipe(Effect.forkChild);
      yield* TestClock.adjust("30 seconds");
      const result = yield* Fiber.join(fiber);
      assert.strictEqual(result.status, "timedOut");
      assert.strictEqual(result.cursor, 3);
    }),
  );

  it.effect("rejects a missing or invalid pattern", () =>
    Effect.gen(function* () {
      const { service } = yield* makeHarness();
      const invalid = yield* service.wait(target, { regex: "(" }).pipe(Effect.exit);
      const missing = yield* service.wait(target, {}).pipe(Effect.exit);
      const both = yield* service.wait(target, { match: "a", regex: "a" }).pipe(Effect.exit);
      for (const exit of [invalid, missing, both]) {
        assert.isTrue(Exit.isFailure(exit));
        expect(JSON.stringify(exit)).toContain("invalid_request");
      }
    }),
  );

  it.effect("still checks while output never goes quiet", () =>
    Effect.gen(function* () {
      const { service, output, settle } = yield* makeHarness();
      const fiber = yield* service.wait(target, { match: "READY" }).pipe(Effect.forkChild);
      yield* settle;
      yield* output(".");
      yield* settle;
      yield* TestClock.adjust("50 millis");
      yield* output("READY");
      yield* settle;
      for (let i = 0; i < 9; i += 1) {
        yield* TestClock.adjust("50 millis");
        yield* output(".");
        yield* settle;
      }
      const result = yield* Fiber.join(fiber);
      assert.strictEqual(result.status, "matched");
    }),
  );
});

describe("TerminalAgentService.read", () => {
  it.effect("visible shows only the latest TUI frame", () =>
    Effect.gen(function* () {
      const { service, output } = yield* makeHarness();
      yield* output("frame1\r\n");
      yield* output("\x1b[2J\x1b[Hframe2");
      const { text } = yield* service.read(target, { source: "visible" });
      expect(text).toContain("frame2");
      expect(text).not.toContain("frame1");
    }),
  );

  it.effect("recent-unwrapped joins wrapped lines and recent ends at the last text", () =>
    Effect.gen(function* () {
      const { service, emit, output } = yield* makeHarness();
      yield* service.read(target, {});
      yield* emit({
        type: "activity",
        hasRunningSubprocess: false,
        label: "zsh",
        cols: 10,
        rows: 5,
      });
      yield* output("abcdefghijklmno\r\n");
      assert.deepStrictEqual(
        (yield* service.read(target, { source: "recent" })).text,
        "abcdefghij\nklmno",
      );
      assert.strictEqual(
        (yield* service.read(target, { source: "recent-unwrapped" })).text,
        "abcdefghijklmno",
      );
    }),
  );

  it.effect("keeps printed trailing spaces and resets on clear", () =>
    Effect.gen(function* () {
      const { service, emit, output } = yield* makeHarness();
      yield* output(">>> ");
      assert.strictEqual((yield* service.read(target, {})).text, ">>> ");
      yield* emit({ type: "cleared" });
      assert.strictEqual((yield* service.read(target, { source: "visible" })).text, "");
    }),
  );
});

describe("TerminalAgentService relaunch", () => {
  it.effect("output queued just before a clear or relaunch does not leak", () =>
    Effect.gen(function* () {
      const { service, emit, output, observeSnapshot } = yield* makeHarness();
      yield* service.read(target, {});
      yield* output("OLD-PENDING");
      yield* emit({ type: "cleared" });
      yield* output("NEW$ ");
      assert.strictEqual((yield* service.read(target, {})).text, "NEW$ ");
      yield* output("OLDER");
      yield* observeSnapshot("FRESH$ ");
      assert.strictEqual((yield* service.read(target, {})).text, "FRESH$ ");
    }),
  );

  it.effect("concurrent first reads both see the loaded screen", () =>
    Effect.gen(function* () {
      const observeGate = yield* Deferred.make<void>();
      const { service } = yield* makeHarness({
        sessions: [snapshotOf({ ...target, history: "ready$ " })],
        observeGate,
      });
      const first = yield* service.read(target, {}).pipe(Effect.forkChild);
      const second = yield* service.read(target, {}).pipe(Effect.forkChild);
      yield* TestClock.adjust("1 millis");
      yield* Deferred.succeed(observeGate, undefined);
      assert.strictEqual((yield* Fiber.join(first)).text, "ready$ ");
      assert.strictEqual((yield* Fiber.join(second)).text, "ready$ ");
    }),
  );

  it.effect("a relaunched shell's snapshot replaces the old screen", () =>
    Effect.gen(function* () {
      const { service, output, observeSnapshot } = yield* makeHarness();
      yield* output("OLD-SHELL$ ");
      assert.strictEqual((yield* service.read(target, {})).text, "OLD-SHELL$ ");
      yield* observeSnapshot("NEW$ ");
      assert.strictEqual((yield* service.read(target, {})).text, "NEW$ ");
    }),
  );
});

describe("TerminalAgentService.open", () => {
  it.effect("uses agent ids, settle cleanup and the client's launch context", () =>
    Effect.gen(function* () {
      const { service, opened, writes, output, emit, settle } = yield* makeHarness();
      const fiber = yield* service
        .open({ threadId, workspaceRoot: "/repo", worktreePath: "/repo/wt", command: "psql" })
        .pipe(Effect.forkChild);
      const input = yield* Queue.take(opened);
      expect(input.terminalId).toMatch(/^agent-[0-9a-f]{8}$/);
      assert.strictEqual(input.stopOnSettle, true);
      assert.strictEqual(input.worktreePath, "/repo/wt");
      assert.strictEqual(
        input.cwd,
        projectScriptCwd({ project: { cwd: "/repo" }, worktreePath: "/repo/wt" }),
      );
      assert.deepStrictEqual(
        input.env,
        projectScriptRuntimeEnv({ project: { cwd: "/repo" }, worktreePath: "/repo/wt" }),
      );
      assert.strictEqual(yield* Queue.size(writes), 0);
      const agent = { threadId, terminalId: input.terminalId };
      // An rc-file child (nvm, fnm) starts and ends before the shell reads input.
      yield* emit({ type: "activity", hasRunningSubprocess: true, label: "nvm" }, agent);
      yield* output("loading\r\n", agent);
      yield* emit({ type: "activity", hasRunningSubprocess: false, label: "zsh" }, agent);
      yield* output("% \x1b[?2004h", agent);
      const result = yield* Fiber.join(fiber);
      assert.strictEqual(result.terminalId, input.terminalId);
      assert.strictEqual(yield* Queue.take(writes), projectScriptTerminalInput("psql"));
      const wait = yield* service
        .wait(agent, { regex: "=> $", since: result.cursor })
        .pipe(Effect.forkChild);
      yield* settle;
      yield* TestClock.adjust("30 seconds");
      assert.strictEqual((yield* Fiber.join(wait)).status, "timedOut");
    }),
  );

  it.effect("opens in the project root when the thread has no worktree", () =>
    Effect.gen(function* () {
      const { service, opened } = yield* makeHarness();
      yield* service.open({ threadId, workspaceRoot: "/repo", worktreePath: null });
      const input = yield* Queue.take(opened);
      assert.strictEqual(input.cwd, "/repo");
      assert.isFalse("worktreePath" in input);
    }),
  );
});

describe("TerminalAgentService targets", () => {
  it.effect("unknown terminals are terminal_not_found", () =>
    Effect.gen(function* () {
      const { service } = yield* makeHarness();
      const attempts = [
        service.read({ threadId, terminalId: "term-404" }, {}),
        service.wait({ threadId, terminalId: "term-404" }, { match: "x" }),
        service.sendText({ threadId: otherThreadId, terminalId }, "x"),
      ];
      for (const attempt of attempts) {
        const exit = yield* attempt.pipe(Effect.exit);
        expect(JSON.stringify(exit)).toContain("terminal_not_found");
      }
    }),
  );

  it.effect("send_keys rejects unknown keys and writes known ones", () =>
    Effect.gen(function* () {
      const { service, writes } = yield* makeHarness();
      const exit = yield* service.sendKeys(target, ["hyper-x"]).pipe(Effect.exit);
      expect(JSON.stringify(exit)).toContain("invalid_request");
      yield* service.sendKeys(target, ["ctrl-c", "enter"]);
      assert.strictEqual(yield* Queue.take(writes), "\x03\r");
      yield* service.sendText(target, "a\nb\r\n");
      assert.strictEqual(yield* Queue.take(writes), "a\rb\r");
    }),
  );

  it.effect("writing to an exited terminal is refused", () =>
    Effect.gen(function* () {
      const { service, emit } = yield* makeHarness();
      yield* emit({ type: "exited", exitCode: 0, exitSignal: null });
      const exit = yield* service.sendText(target, "x").pipe(Effect.exit);
      expect(JSON.stringify(exit)).toContain("invalid_request");
    }),
  );
});
