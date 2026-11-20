import type { AgentAwarenessThread } from "../orchestration-v2/ProjectionStore.ts";
import type {
  EnvironmentId,
  EventHook,
  EventHookEvent,
  EventHookRun,
  EventHookRunOutcome,
  EventHookRunsResult,
  EventHookTestInput,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { type AgentAwarenessPhase, projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { shouldPublishAgentAwarenessEvent } from "../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";

export class EventHooks extends Context.Service<
  EventHooks,
  {
    readonly test: (input: EventHookTestInput) => Effect.Effect<EventHookRun>;
    readonly listRuns: Effect.Effect<EventHookRunsResult>;
    /** Waits for queued thread work and the hook runs it started. */
    readonly drain: Effect.Effect<void>;
  }
>()("t3/eventHooks/EventHooks") {}

// Same hold as the push relay: a run can end moments before its continuation starts.
const COMPLETION_HOLD_MS = 5_000;
const RUN_TIMEOUT = "30 seconds";
const MAX_OUTPUT_BYTES = 64 * 1024;
const OUTPUT_TAIL_CHARS = 2_048;
const MAX_CONCURRENT_RUNS = 4;

export interface EventHookThreadState {
  readonly lastStartedRunId: RunId | null;
  readonly lastKey: string | null;
  readonly pendingCompletion?: { readonly key: string; readonly deadline: number };
}

const EVENT_BY_PHASE: Partial<Record<AgentAwarenessPhase, EventHookEvent>> = {
  waiting_for_approval: "approval.requested",
  waiting_for_input: "input.requested",
  completed: "turn.completed",
  failed: "turn.failed",
};

// Triage state (settled, snoozed, archived) is automation-irrelevant, so it never hides a phase.
function eventHookPhase(thread: AgentAwarenessThread, environmentId: EnvironmentId) {
  return (
    projectThreadAwarenessV2({
      environmentId,
      project: { title: "" },
      thread: { ...thread, settledOverride: null },
    })?.phase ?? null
  );
}

function phaseKey(phase: AgentAwarenessPhase | null, thread: AgentAwarenessThread): string | null {
  switch (phase) {
    case "waiting_for_approval":
      return `approval:${thread.pendingRuntimeRequest?.id}`;
    case "waiting_for_input":
      return `input:${thread.pendingRuntimeRequest?.id}`;
    case "completed":
      return `completed:${thread.latestRunId}`;
    case "failed":
      return `failed:${thread.latestRunId}`;
    default:
      return null;
  }
}

export function primeEventHookState(
  thread: AgentAwarenessThread,
  environmentId: EnvironmentId,
): EventHookThreadState {
  return {
    lastStartedRunId: thread.activeRunId ?? thread.latestRunId,
    lastKey: phaseKey(eventHookPhase(thread, environmentId), thread),
  };
}

export function resolveEventHookTransition(input: {
  readonly state: EventHookThreadState | undefined;
  readonly thread: AgentAwarenessThread;
  readonly environmentId: EnvironmentId;
  readonly now: number;
  readonly primedAt: number;
}): {
  readonly state: EventHookThreadState;
  readonly event: EventHookEvent | null;
  readonly recheckAt?: number;
} {
  const { thread, now } = input;
  const phase = eventHookPhase(thread, input.environmentId);
  const current = input.state ?? { lastStartedRunId: null, lastKey: null };
  const runId = thread.activeRunId ?? thread.latestRunId;
  // Thread work coalesces, so a run first seen waiting or finished counts as started: its
  // `turn.started` is lost rather than arriving after the approval or completion.
  const base = {
    lastStartedRunId: phase === null || runId === null ? current.lastStartedRunId : runId,
    lastKey: current.lastKey,
  };
  if (phase === "starting" || phase === "running") {
    const started = runId !== null && runId !== current.lastStartedRunId;
    return { state: base, event: started ? "turn.started" : null };
  }
  const key = phaseKey(phase, thread);
  const event = phase === null ? undefined : EVENT_BY_PHASE[phase];
  if (key === null || event === undefined || key === current.lastKey) {
    return { state: base, event: null };
  }
  // A thread first seen after priming, such as one restored from the archive, reports only new results.
  if (
    input.state === undefined &&
    (phase === "completed" || phase === "failed") &&
    !(
      thread.latestRunCompletedAt != null &&
      DateTime.toEpochMillis(thread.latestRunCompletedAt) >= input.primedAt
    )
  ) {
    return { state: { ...base, lastKey: key }, event: null };
  }
  if (phase === "completed") {
    const pending = current.pendingCompletion;
    if (pending?.key !== key) {
      const deadline = now + COMPLETION_HOLD_MS;
      return {
        state: { ...base, pendingCompletion: { key, deadline } },
        event: null,
        recheckAt: deadline,
      };
    }
    if (now < pending.deadline)
      return { state: { ...base, pendingCompletion: pending }, event: null };
  }
  return { state: { ...base, lastKey: key }, event };
}

interface EventHookPayload {
  readonly version: 1;
  readonly event: EventHookEvent;
  readonly test: boolean;
  readonly occurredAt: string;
  readonly environmentId: string;
  readonly thread: {
    readonly id: string;
    readonly title: string;
    readonly projectId: string;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly runId: string | null;
  };
  readonly project: {
    readonly id: string;
    readonly title: string;
    readonly workspaceRoot: string | null;
  } | null;
  readonly request: { readonly id: string; readonly kind: string } | null;
  readonly error: { readonly message: string } | null;
}

const hookEnv = (payload: EventHookPayload) => ({
  T3_EVENT: payload.event,
  T3_THREAD_ID: payload.thread.id,
  T3_THREAD_TITLE: payload.thread.title,
  T3_PROJECT_ID: payload.thread.projectId,
  T3_PROJECT_TITLE: payload.project?.title ?? "",
  T3_CWD: payload.thread.worktreePath ?? payload.project?.workspaceRoot ?? "",
  T3_ENVIRONMENT_ID: payload.environmentId,
  T3_TEST: payload.test ? "1" : "",
});

const runOutcome = (output: ProcessRunner.ProcessRunOutput): EventHookRunOutcome =>
  output.timedOut ? { _tag: "TimedOut" } : { _tag: "Exited", code: output.code };

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const isRunnable = (hook: EventHook) => hook.enabled && hook.command.trim() !== "";

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const scope = yield* Effect.scope;
  const platform = yield* HostProcess.Platform;
  const hostEnv = yield* HostProcess.Environment;
  const shellInvocation = (command: string) =>
    platform === "win32"
      ? { command: hostEnv.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", command] }
      : { command: "/bin/sh", args: ["-c", command] };
  const runs = yield* FiberSet.make<void, never>();
  const slots = yield* Semaphore.make(MAX_CONCURRENT_RUNS);
  const lastRuns = yield* Ref.make(new Map<string, EventHookRun>());
  const threadStates = new Map<ThreadId, EventHookThreadState>();
  // Null until the current threads are recorded; events before that would replay old state.
  let primedAt: number | null = null;

  const runnableHooks = settings.getSettings.pipe(
    Effect.map((current) => current.eventHooks.filter(isRunnable)),
  );

  const execute = Effect.fn("EventHooks.execute")(function* (
    hookId: string | null,
    command: string,
    payload: EventHookPayload,
  ) {
    const startedAt = yield* DateTime.now;
    const result = yield* processRunner
      .run({
        ...shellInvocation(command),
        stdin: `${encodeJson(payload)}\n`,
        env: hookEnv(payload),
        timeout: RUN_TIMEOUT,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: MAX_OUTPUT_BYTES,
        outputMode: "truncate",
        ignoreUnreadStdin: true,
      })
      .pipe(
        Effect.match({
          onFailure: (error) => ({
            outcome: { _tag: "SpawnFailed", message: error.message } satisfies EventHookRunOutcome,
            stdout: "",
            stderr: "",
          }),
          onSuccess: (output) => ({
            outcome: runOutcome(output),
            stdout: output.stdout,
            stderr: output.stderr,
          }),
        }),
        slots.withPermits(1),
      );
    const durationMs = (yield* DateTime.now).epochMilliseconds - startedAt.epochMilliseconds;
    const run: EventHookRun = {
      hookId,
      event: payload.event,
      test: payload.test,
      startedAt: DateTime.formatIso(startedAt),
      durationMs,
      outcome: result.outcome,
      stdoutTail: result.stdout.slice(-OUTPUT_TAIL_CHARS),
      stderrTail: result.stderr.slice(-OUTPUT_TAIL_CHARS),
    };
    if (hookId !== null) {
      yield* Ref.update(lastRuns, (previous) => new Map(previous).set(hookId, run));
    }
    const annotations = {
      hookId,
      event: payload.event,
      threadId: payload.thread.id,
      exitCode: result.outcome._tag === "Exited" ? result.outcome.code : null,
      timedOut: result.outcome._tag === "TimedOut",
      durationMs,
    };
    yield* result.outcome._tag === "Exited" && result.outcome.code === 0
      ? Effect.logInfo("event hook finished", annotations)
      : Effect.logWarning("event hook failed", annotations);
    return run;
  });

  // Per-event work below stays untraced; each hook run has its own span.
  const buildPayload = Effect.fnUntraced(function* (
    event: EventHookEvent,
    thread: AgentAwarenessThread,
    environmentId: EnvironmentId,
  ) {
    const shell = yield* threads.getThreadShell(thread.id);
    const project = yield* projects.getById(thread.projectId);
    const request = thread.pendingRuntimeRequest;
    return {
      version: 1,
      event,
      test: false,
      occurredAt: DateTime.formatIso(yield* DateTime.now),
      environmentId,
      thread: {
        id: thread.id,
        title: thread.title,
        projectId: thread.projectId,
        branch: shell?.branch ?? null,
        worktreePath: shell?.worktreePath ?? null,
        runId:
          event === "turn.started"
            ? (thread.activeRunId ?? thread.latestRunId)
            : thread.latestRunId,
      },
      project: Option.match(project, {
        onNone: () => null,
        onSome: (value) => ({
          id: value.id,
          title: value.title,
          workspaceRoot: value.workspaceRoot,
        }),
      }),
      request:
        (event === "approval.requested" || event === "input.requested") && request !== null
          ? { id: request.id, kind: request.kind }
          : null,
      error: event === "turn.failed" ? { message: shell?.lastError ?? "" } : null,
    } satisfies EventHookPayload;
  });

  const queuedThreads = new Set<ThreadId>();
  let enqueueThread: (threadId: ThreadId) => Effect.Effect<void> = () => Effect.void;

  const processThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const hooks = yield* runnableHooks;
    const primed = primedAt;
    if (hooks.length === 0) return;
    // A failed prime leaves this null; retry it here, in queue order, instead of staying silent.
    if (primed === null) return yield* prime();
    const thread = (yield* threads.getAgentAwarenessSnapshot(threadId)).threads[0];
    if (thread === undefined) {
      threadStates.delete(threadId);
      return;
    }
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const now = (yield* DateTime.now).epochMilliseconds;
    const transition = resolveEventHookTransition({
      state: threadStates.get(threadId),
      thread,
      environmentId,
      now,
      primedAt: primed,
    });
    threadStates.set(threadId, transition.state);
    if (transition.recheckAt !== undefined) {
      yield* Effect.sleep(transition.recheckAt - now).pipe(
        Effect.andThen(Effect.suspend(() => enqueueThread(threadId))),
        Effect.forkIn(scope),
      );
    }
    const event = transition.event;
    if (event === null) return;
    const matching = hooks.filter((hook) => hook.event === event);
    if (matching.length === 0) return;
    const payload = yield* buildPayload(event, thread, environmentId);
    yield* Effect.forEach(
      matching,
      (hook) =>
        FiberSet.run(
          runs,
          execute(hook.id, hook.command, payload).pipe(
            Effect.asVoid,
            Effect.catchCause((cause) =>
              Effect.logWarning("event hook run crashed", {
                hookId: hook.id,
                cause: Cause.pretty(cause),
              }),
            ),
          ),
        ),
      { discard: true },
    );
  });

  const prime = Effect.fn("EventHooks.prime")(function* () {
    if (primedAt !== null || (yield* runnableHooks).length === 0) return;
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const startedAt = (yield* DateTime.now).epochMilliseconds;
    const snapshot = yield* threads.getAgentAwarenessSnapshot();
    threadStates.clear();
    for (const thread of snapshot.threads) {
      threadStates.set(thread.id, primeEventHookState(thread, environmentId));
    }
    primedAt = startedAt;
  });

  // `null` is the prime task; it shares the queue so no thread work runs against a half-built map.
  const worker = yield* makeDrainableWorker((task: ThreadId | null) =>
    task === null
      ? prime()
      : Effect.sync(() => queuedThreads.delete(task)).pipe(Effect.andThen(processThread(task))),
  );
  enqueueThread = (threadId) =>
    Effect.suspend(() => {
      if (queuedThreads.has(threadId)) return Effect.void;
      queuedThreads.add(threadId);
      return worker.enqueue(threadId);
    }).pipe(Effect.uninterruptible);

  const settingsChanges = yield* settings.subscribeChanges;
  yield* forkParked(
    Stream.runForEach(settingsChanges, (next) => {
      if (!next.eventHooks.some(isRunnable)) {
        primedAt = null;
        threadStates.clear();
        return Effect.void;
      }
      return primedAt === null ? worker.enqueue(null) : Effect.void;
    }),
  );
  // Prime before reading events: the stream delivers committed events, so a snapshot taken on
  // arrival would already hold the state the first event created.
  yield* forkParked(
    worker
      .enqueue(null)
      .pipe(
        Effect.andThen(worker.drain),
        Effect.andThen(
          Stream.runForEach(threads.streamDomainEvents, (event) =>
            shouldPublishAgentAwarenessEvent(event) ? enqueueThread(event.threadId) : Effect.void,
          ),
        ),
      ),
  );

  const test: EventHooks["Service"]["test"] = Effect.fn("EventHooks.test")(function* (input) {
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    return yield* execute(input.hookId ?? null, input.command, {
      version: 1,
      event: input.event,
      test: true,
      occurredAt: DateTime.formatIso(yield* DateTime.now),
      environmentId,
      thread: {
        id: "test",
        title: "test",
        projectId: "test",
        branch: null,
        worktreePath: null,
        runId: null,
      },
      project: { id: "test", title: "test", workspaceRoot: null },
      request: null,
      error: null,
    });
  });

  return EventHooks.of({
    test,
    listRuns: Ref.get(lastRuns).pipe(Effect.map((current) => ({ runs: [...current.values()] }))),
    drain: worker.drain.pipe(Effect.andThen(FiberSet.awaitEmpty(runs))),
  });
});

export const layer = Layer.effect(EventHooks, make);
