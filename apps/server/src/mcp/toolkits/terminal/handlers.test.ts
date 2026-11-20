import { describe, expect, it } from "@effect/vitest";
import {
  type AuthMcpClientAccess,
  EnvironmentId,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Project from "../../../project/ProjectService.ts";
import * as TerminalAgentService from "../../../terminal/TerminalAgentService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as TerminalHandlers from "./handlers.ts";
import { TerminalToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:terminal");
const ownThread = ThreadId.make("thread:own");
const otherThread = ThreadId.make("thread:other");

const threadScope = (): McpInvocationContext.McpInvocationScope => ({
  environmentId,
  requestNamespace: "provider:terminal",
  thread: {
    threadId: ownThread,
    providerSessionId: "provider:terminal",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration" as const]),
  issuedAt: 0,
});

const clientScope = (access: AuthMcpClientAccess): McpInvocationContext.McpInvocationScope => ({
  environmentId,
  requestNamespace: "client:terminal",
  thread: undefined,
  client: { sessionId: "session", label: "t3 CLI", access },
  capabilities: new Set(["orchestration" as const]),
  issuedAt: 0,
});

const listTerminals = (
  scope: McpInvocationContext.McpInvocationScope,
  params: { threadId?: ThreadId },
  runtimeMode: RuntimeMode = "full-access",
  options: { readonly open?: boolean; readonly deletedTarget?: boolean } = {},
) =>
  Effect.gen(function* () {
    const listed: string[] = [];
    const opened: string[] = [];
    const result = yield* Effect.gen(function* () {
      const toolkit = yield* TerminalToolkit;
      const results = options.open
        ? yield* toolkit.handle("terminal_open", params).pipe(Stream.unwrap, Stream.runCollect)
        : yield* toolkit.handle("terminal_list", params).pipe(Stream.unwrap, Stream.runCollect);
      return results.map((item) => item.result);
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(TerminalHandlers.layer).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Layer.succeed(McpInvocationContext.McpInvocationContext, scope),
              Layer.mock(ThreadManagement.ThreadManagementService)({
                getThreadShell: (threadId) => {
                  const shell = liveThreadShell(threadId, { runtimeMode });
                  return Effect.succeed(
                    options.deletedTarget && threadId === otherThread
                      ? { ...shell, deletedAt: shell.createdAt }
                      : shell,
                  );
                },
              }),
              Layer.mock(TerminalAgentService.TerminalAgentService)({
                list: (threadId) =>
                  Effect.sync(() => {
                    listed.push(threadId);
                    return { terminals: [] };
                  }),
                open: (input) =>
                  Effect.sync(() => {
                    opened.push(input.threadId);
                    return { terminalId: "agent-00000000", cursor: 0 };
                  }),
              }),
              Layer.mock(Project.ProjectService)({}),
            ),
          ),
        ),
      ),
    );
    return { result: result.at(-1), listed, opened };
  });

describe("terminal toolkit access", () => {
  it.effect("refuses to open a terminal in a deleted thread", () =>
    Effect.gen(function* () {
      const { result, opened } = yield* listTerminals(
        clientScope("full-access"),
        { threadId: otherThread },
        "full-access",
        { open: true, deletedTarget: true },
      );
      expect(result).toMatchObject({ code: "thread_not_found" });
      expect(opened).toEqual([]);
    }),
  );

  it.effect("refuses a thread caller below full access", () =>
    Effect.gen(function* () {
      const { result, listed } = yield* listTerminals(threadScope(), {}, "approval-required");
      expect(result).toMatchObject({ code: "capability_denied" });
      expect(listed).toEqual([]);
    }),
  );

  it.effect("refuses a thread caller reaching another thread", () =>
    Effect.gen(function* () {
      const { result, listed } = yield* listTerminals(threadScope(), { threadId: otherThread });
      expect(result).toMatchObject({ code: "capability_denied" });
      expect(listed).toEqual([]);
    }),
  );

  it.effect("asks a client caller for a thread", () =>
    Effect.gen(function* () {
      const { result } = yield* listTerminals(clientScope("full-access"), {});
      expect(result).toMatchObject({ code: "target_required" });
    }),
  );

  it.effect("lets a full-access client reach any thread and a thread its own", () =>
    Effect.gen(function* () {
      const client = yield* listTerminals(clientScope("full-access"), { threadId: otherThread });
      expect(client.listed).toEqual([otherThread]);
      const own = yield* listTerminals(threadScope(), {});
      expect(own.listed).toEqual([ownThread]);
    }),
  );
});
