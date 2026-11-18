import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  EventId,
  type EventHook,
  type EventHookEvent,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  type ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as EventHooks from "./EventHooks.ts";
import { primeEventHookState, resolveEventHookTransition } from "./EventHooks.ts";

const THREAD_ID = ThreadId.make("hook-thread");
const PROJECT_ID = ProjectId.make("hook-project");
const ENVIRONMENT_ID = EnvironmentId.make("hook-environment");
const NOW = "2026-11-18T10:00:00.000Z";
const NOW_MS = DateTime.toEpochMillis(DateTime.makeUnsafe(NOW));
const RUN_A = RunId.make("run-a");
const RUN_B = RunId.make("run-b");

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Fix login",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: THREAD_ID, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "idle",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: DateTime.makeUnsafe(NOW),
    updatedAt: DateTime.makeUnsafe(NOW),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

const idle = () => shell();
const running = (runId: RunId) =>
  shell({
    status: "running",
    activityRunStatus: "running",
    activeRunId: runId,
    latestRunId: runId,
  });
const waiting = (runId: RunId, requestId: string, kind: "command" | "user_input" = "command") =>
  shell({
    ...running(runId),
    status: "waiting",
    pendingRuntimeRequest: {
      id: RuntimeRequestId.make(requestId),
      kind,
      createdAt: DateTime.makeUnsafe(NOW),
    },
  });
const finished = (
  runId: RunId,
  status: "completed" | "failed" = "completed",
  overrides: Partial<OrchestrationV2ThreadShell> = {},
) =>
  shell({
    status,
    latestRunId: runId,
    latestRunCompletedAt: DateTime.makeUnsafe(NOW),
    ...overrides,
  });

interface Step {
  readonly thread: OrchestrationV2ThreadShell;
  readonly afterMs?: number;
}

function replay(
  steps: ReadonlyArray<Step>,
  options: { readonly primed?: OrchestrationV2ThreadShell; readonly primedAt?: number } = {},
): ReadonlyArray<EventHookEvent | null> {
  let state =
    options.primed === undefined ? undefined : primeEventHookState(options.primed, ENVIRONMENT_ID);
  return steps.map((step) => {
    const transition = resolveEventHookTransition({
      state,
      thread: step.thread,
      environmentId: ENVIRONMENT_ID,
      now: NOW_MS + (step.afterMs ?? 0),
      primedAt: options.primedAt ?? NOW_MS,
    });
    state = transition.state;
    return transition.event;
  });
}

describe("resolveEventHookTransition", () => {
  it.each([
    {
      name: "a run starts once, and each new approval fires again",
      primed: idle(),
      steps: [
        { thread: running(RUN_A) },
        { thread: waiting(RUN_A, "r1") },
        { thread: running(RUN_A) },
        { thread: waiting(RUN_A, "r2") },
      ],
      events: ["turn.started", "approval.requested", null, "approval.requested"],
    },
    {
      name: "a run first seen waiting for approval counts as started",
      primed: idle(),
      steps: [{ thread: waiting(RUN_A, "r1") }, { thread: running(RUN_A) }],
      events: ["approval.requested", null],
    },
    {
      name: "user input fires once per request",
      primed: running(RUN_A),
      steps: [
        { thread: waiting(RUN_A, "r3", "user_input") },
        { thread: waiting(RUN_A, "r3", "user_input") },
      ],
      events: ["input.requested", null],
    },
    {
      name: "a completion fires after the hold, once",
      primed: running(RUN_A),
      steps: [
        { thread: finished(RUN_A) },
        { thread: finished(RUN_A), afterMs: 5_000 },
        { thread: finished(RUN_A), afterMs: 6_000 },
      ],
      events: [null, "turn.completed", null],
    },
    {
      name: "a run that starts inside the hold cancels the completion",
      primed: running(RUN_A),
      steps: [
        { thread: finished(RUN_A) },
        { thread: running(RUN_B), afterMs: 1_000 },
        { thread: running(RUN_B), afterMs: 5_000 },
      ],
      events: [null, "turn.started", null],
    },
    {
      name: "a failure fires at once",
      primed: running(RUN_A),
      steps: [{ thread: finished(RUN_A, "failed") }, { thread: finished(RUN_A, "failed") }],
      events: ["turn.failed", null],
    },
    {
      name: "settling inside the hold does not swallow the completion",
      primed: running(RUN_A),
      steps: [
        { thread: finished(RUN_A) },
        { thread: finished(RUN_A, "completed", { settledOverride: "settled" }), afterMs: 2_000 },
        { thread: finished(RUN_A, "completed", { settledOverride: "settled" }), afterMs: 5_000 },
      ],
      events: [null, null, "turn.completed"],
    },
    {
      name: "archiving and restoring a finished thread stays silent",
      primed: running(RUN_A),
      steps: [
        { thread: finished(RUN_A) },
        { thread: finished(RUN_A), afterMs: 5_000 },
        {
          thread: finished(RUN_A, "completed", { archivedAt: DateTime.makeUnsafe(NOW) }),
          afterMs: 6_000,
        },
        { thread: finished(RUN_A), afterMs: 7_000 },
        { thread: finished(RUN_A), afterMs: 13_000 },
      ],
      events: [null, "turn.completed", null, null, null],
    },
    {
      name: "subagents and side chats never fire",
      primed: undefined,
      steps: [
        {
          thread: shell({
            ...running(RUN_A),
            lineage: {
              rootThreadId: ThreadId.make("parent"),
              parentThreadId: ThreadId.make("parent"),
              relationshipToParent: "subagent",
            },
          }),
        },
      ],
      events: [null],
    },
  ] satisfies ReadonlyArray<{
    name: string;
    primed: OrchestrationV2ThreadShell | undefined;
    steps: ReadonlyArray<Step>;
    events: ReadonlyArray<EventHookEvent | null>;
  }>)("$name", ({ primed, steps, events }) => {
    assert.deepStrictEqual(replay(steps, primed === undefined ? {} : { primed }), events);
  });

  it("holds a first completion and asks for a recheck at the deadline", () => {
    const transition = resolveEventHookTransition({
      state: primeEventHookState(running(RUN_A), ENVIRONMENT_ID),
      thread: finished(RUN_A),
      environmentId: ENVIRONMENT_ID,
      now: NOW_MS,
      primedAt: NOW_MS,
    });
    assert.strictEqual(transition.event, null);
    assert.strictEqual(transition.recheckAt, NOW_MS + 5_000);
  });

  it("fires an unknown thread's terminal run only when it ended after priming", () => {
    const steps = [{ thread: finished(RUN_A) }, { thread: finished(RUN_A), afterMs: 5_000 }];
    assert.deepStrictEqual(replay(steps, { primedAt: NOW_MS + 1 }), [null, null]);
    assert.deepStrictEqual(replay(steps, { primedAt: NOW_MS }), [null, "turn.completed"]);
    assert.deepStrictEqual(
      replay([{ thread: finished(RUN_A, "failed") }], { primedAt: NOW_MS + 1 }),
      [null],
    );
  });
});

const hook = (event: EventHookEvent, overrides: Partial<EventHook> = {}): EventHook => ({
  id: `hook-${event}`,
  event,
  command: `notify ${event}`,
  enabled: true,
  ...overrides,
});

const output = (
  overrides: Partial<ProcessRunner.ProcessRunOutput> = {},
): ProcessRunner.ProcessRunOutput => ({
  stdout: "",
  stderr: "",
  code: ChildProcessSpawner.ExitCode(0),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
  ...overrides,
});

const harness = Effect.fnUntraced(function* (options: {
  readonly hooks: ReadonlyArray<EventHook>;
  readonly thread?: OrchestrationV2ThreadShell;
  readonly run?: (
    input: ProcessRunner.ProcessRunInput,
  ) => Effect.Effect<ProcessRunner.ProcessRunOutput, ProcessRunner.ProcessRunError>;
  readonly processRunner?: Layer.Layer<ProcessRunner.ProcessRunner>;
}) {
  const thread = yield* Ref.make<OrchestrationV2ThreadShell | null>(options.thread ?? idle());
  const settings = yield* Ref.make<ServerSettings>({
    ...DEFAULT_SERVER_SETTINGS,
    eventHooks: options.hooks,
  });
  const events = yield* Queue.unbounded<OrchestrationV2ThreadShell>();
  const eventPulls = yield* Queue.unbounded<void>();
  const settingsChanges = yield* Queue.unbounded<ServerSettings>();
  const settingsPulls = yield* Queue.unbounded<void>();
  const calls: Array<ProcessRunner.ProcessRunInput> = [];
  const reads = { snapshots: 0 };

  const layer = EventHooks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getAgentAwarenessSnapshot: () =>
            Effect.sync(() => void reads.snapshots++).pipe(
              Effect.andThen(Ref.get(thread)),
              Effect.map((current) => ({
                snapshotSequence: 1,
                threads: current === null ? [] : [current],
              })),
            ),
          getThreadShell: () => Ref.get(thread),
          streamDomainEvents: Stream.fromEffectRepeat(
            Queue.offer(eventPulls, undefined).pipe(
              Effect.andThen(Queue.take(events)),
              Effect.map((payload): OrchestrationV2DomainEvent => ({
                id: EventId.make(`event:${payload.updatedAt}`),
                type: "thread.settled",
                threadId: payload.id,
                occurredAt: payload.updatedAt,
                payload: { ...payload, lastVisitedAt: null },
              })),
            ),
          ),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeedSome({
              id: PROJECT_ID,
              title: "web",
              workspaceRoot: "/workspace/web",
              defaultModelSelection: null,
              scripts: [],
              createdAt: NOW,
              updatedAt: NOW,
              deletedAt: null,
            }),
        }),
        Layer.mock(ServerSettingsService.ServerSettingsService)({
          getSettings: Ref.get(settings),
          subscribeChanges: Effect.succeed(
            Stream.fromEffectRepeat(
              Queue.offer(settingsPulls, undefined).pipe(
                Effect.andThen(Queue.take(settingsChanges)),
              ),
            ),
          ),
        }),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(ENVIRONMENT_ID),
        }),
        options.processRunner ??
          Layer.succeed(
            ProcessRunner.ProcessRunner,
            ProcessRunner.ProcessRunner.of({
              run: (input) =>
                Effect.sync(() => void calls.push(input)).pipe(
                  Effect.andThen(options.run?.(input) ?? Effect.succeed(output())),
                ),
            }),
          ),
      ),
    ),
  );

  return {
    layer,
    calls,
    reads,
    /** Moves the thread to a new state and waits until its event is queued. */
    update: (next: OrchestrationV2ThreadShell) =>
      Ref.set(thread, next).pipe(
        Effect.andThen(Queue.offer(events, next)),
        Effect.andThen(Queue.take(eventPulls)),
      ),
    setHooks: (hooks: ReadonlyArray<EventHook>) =>
      Ref.updateAndGet(settings, (current) => ({ ...current, eventHooks: hooks })).pipe(
        Effect.flatMap((next) => Queue.offer(settingsChanges, next)),
        Effect.andThen(Queue.take(settingsPulls)),
      ),
    /** Waits for the service to prime and subscribe. */
    started: Queue.take(eventPulls).pipe(Effect.andThen(Queue.take(settingsPulls))),
  };
});

const decodeStdin = (input: ProcessRunner.ProcessRunInput | undefined) =>
  JSON.parse(input?.stdin ?? "null") as Record<string, unknown>;

describe("EventHooks", () => {
  it.effect("runs a matching hook once with the event on stdin and in T3_ variables", () =>
    Effect.gen(function* () {
      const h = yield* harness({
        hooks: [
          hook("turn.started"),
          hook("turn.started", { id: "off", enabled: false }),
          hook("turn.failed"),
        ],
      });
      yield* Effect.gen(function* () {
        const hooks = yield* EventHooks.EventHooks;
        yield* h.started;
        yield* h.update(running(RUN_A));
        yield* h.update(running(RUN_A));
        yield* hooks.drain;

        assert.strictEqual(h.calls.length, 1);
        const call = h.calls[0];
        assert.strictEqual(call?.command, "/bin/sh");
        assert.deepStrictEqual(call?.args, ["-c", "notify turn.started"]);
        assert.deepStrictEqual(call?.env, {
          T3_EVENT: "turn.started",
          T3_THREAD_ID: THREAD_ID,
          T3_THREAD_TITLE: "Fix login",
          T3_PROJECT_ID: PROJECT_ID,
          T3_PROJECT_TITLE: "web",
          T3_CWD: "/workspace/web",
          T3_ENVIRONMENT_ID: ENVIRONMENT_ID,
          T3_TEST: "",
        });
        const payload = decodeStdin(call);
        assert.deepStrictEqual(payload, {
          version: 1,
          event: "turn.started",
          test: false,
          occurredAt: payload.occurredAt,
          environmentId: ENVIRONMENT_ID,
          thread: {
            id: THREAD_ID,
            title: "Fix login",
            projectId: PROJECT_ID,
            branch: null,
            worktreePath: null,
            runId: RUN_A,
          },
          project: { id: PROJECT_ID, title: "web", workspaceRoot: "/workspace/web" },
          request: null,
          error: null,
        });
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect("reads no thread state while no hook is enabled", () =>
    Effect.gen(function* () {
      const h = yield* harness({ hooks: [hook("turn.started", { enabled: false })] });
      yield* Effect.gen(function* () {
        const hooks = yield* EventHooks.EventHooks;
        yield* h.started;
        yield* h.update(running(RUN_A));
        yield* hooks.drain;
        assert.strictEqual(h.reads.snapshots, 0);
        assert.strictEqual(h.calls.length, 0);
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect("fires on the first event after start, and not for a wait that predates it", () =>
    Effect.gen(function* () {
      const h = yield* harness({ hooks: [hook("turn.started"), hook("approval.requested")] });
      yield* Effect.gen(function* () {
        const hooks = yield* EventHooks.EventHooks;
        yield* h.started;
        yield* h.update(running(RUN_A));
        yield* hooks.drain;
        assert.deepStrictEqual(
          h.calls.map((call) => call.env?.T3_EVENT),
          ["turn.started"],
        );
      }).pipe(Effect.provide(h.layer));

      const waitingAtStart = yield* harness({
        hooks: [hook("approval.requested")],
        thread: waiting(RUN_A, "r1"),
      });
      yield* Effect.gen(function* () {
        const hooks = yield* EventHooks.EventHooks;
        yield* waitingAtStart.started;
        yield* waitingAtStart.update(shell({ ...waiting(RUN_A, "r1"), title: "Renamed" }));
        yield* hooks.drain;
        assert.strictEqual(waitingAtStart.calls.length, 0);
      }).pipe(Effect.provide(waitingAtStart.layer));
    }),
  );

  it.effect("primes when the first hook is added, so an older wait stays silent", () =>
    Effect.gen(function* () {
      const h = yield* harness({ hooks: [], thread: waiting(RUN_A, "r1") });
      yield* Effect.gen(function* () {
        const hooks = yield* EventHooks.EventHooks;
        yield* h.started;
        yield* h.setHooks([hook("approval.requested"), hook("turn.started")]);
        yield* hooks.drain;
        yield* h.update(shell({ ...waiting(RUN_A, "r1"), title: "Renamed" }));
        yield* hooks.drain;
        assert.strictEqual(h.calls.length, 0);

        yield* h.update(running(RUN_B));
        yield* hooks.drain;
        assert.deepStrictEqual(
          h.calls.map((call) => call.env?.T3_EVENT),
          ["turn.started"],
        );
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect("runs a completion hook only after the hold", () =>
    Effect.gen(function* () {
      const h = yield* harness({ hooks: [hook("turn.completed")], thread: running(RUN_A) });
      yield* Effect.gen(function* () {
        const hooks = yield* EventHooks.EventHooks;
        yield* h.started;
        yield* h.update(finished(RUN_A));
        yield* hooks.drain;
        assert.strictEqual(h.calls.length, 0);
        yield* TestClock.adjust("5 seconds");
        yield* hooks.drain;
        assert.strictEqual(h.calls.length, 1);
        assert.strictEqual(h.calls[0]?.env?.T3_EVENT, "turn.completed");
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect("records timeouts, exit codes and spawn failures, and keeps listening", () =>
    Effect.gen(function* () {
      const results = [
        Effect.succeed(output({ timedOut: true, code: null })),
        Effect.succeed(output({ code: ChildProcessSpawner.ExitCode(1), stderr: "boom" })),
        Effect.fail(
          new ProcessRunner.ProcessSpawnError({
            command: "/bin/sh",
            argumentCount: 2,
            cause: "ENOENT",
          }),
        ),
      ];
      const h = yield* harness({
        hooks: [hook("turn.started")],
        run: () => results.shift() ?? Effect.succeed(output()),
      });
      yield* Effect.gen(function* () {
        const hooks = yield* EventHooks.EventHooks;
        yield* h.started;
        const outcomes: Array<string> = [];
        for (const runId of [RUN_A, RUN_B, RunId.make("run-c")]) {
          yield* h.update(running(runId));
          yield* hooks.drain;
          const { runs } = yield* hooks.listRuns;
          outcomes.push(
            runs[0]?.outcome._tag === "Exited"
              ? `exit ${runs[0].outcome.code}`
              : (runs[0]?.outcome._tag ?? "none"),
          );
        }
        assert.deepStrictEqual(outcomes, ["TimedOut", "exit 1", "SpawnFailed"]);
        assert.strictEqual(h.calls.length, 3);
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.effect("tests a command with a test event and records it under its hook", () =>
    Effect.gen(function* () {
      const h = yield* harness({
        hooks: [],
        run: () => Effect.succeed(output({ stdout: "hello" })),
      });
      yield* Effect.gen(function* () {
        const hooks = yield* EventHooks.EventHooks;
        const run = yield* hooks.test({
          hookId: "h1",
          event: "turn.completed",
          command: "echo hello",
        });
        assert.deepStrictEqual(run.outcome, { _tag: "Exited", code: 0 });
        assert.strictEqual(run.stdoutTail, "hello");
        assert.strictEqual(h.calls[0]?.env?.T3_TEST, "1");
        assert.strictEqual(decodeStdin(h.calls[0]).test, true);
        assert.deepStrictEqual((yield* hooks.listRuns).runs, [run]);
      }).pipe(Effect.provide(h.layer));
    }),
  );

  it.live("hands a real shell the payload on stdin and the event in its environment", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const out = `${directory}/out`;
      const h = yield* harness({
        hooks: [],
        processRunner: ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)),
      });
      const run = yield* Effect.gen(function* () {
        const hooks = yield* EventHooks.EventHooks;
        return yield* hooks.test({
          event: "turn.failed",
          command: `cat > "${out}"; printf %s "$T3_EVENT" > "${out}.env"`,
        });
      }).pipe(Effect.provide(h.layer));
      assert.deepStrictEqual(run.outcome, { _tag: "Exited", code: 0 });
      assert.strictEqual(JSON.parse(yield* fileSystem.readFileString(out)).event, "turn.failed");
      assert.strictEqual(yield* fileSystem.readFileString(`${out}.env`), "turn.failed");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
