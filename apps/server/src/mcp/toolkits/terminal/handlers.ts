import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as Project from "../../../project/ProjectService.ts";
import * as TerminalAgentService from "../../../terminal/TerminalAgentService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { assertFullAccess, loadCaller, resolveThreadId, unavailable } from "../../threadAccess.ts";
import { TerminalToolkit } from "./tools.ts";

const resolveThread = Effect.fn("mcp.terminal.resolveThread")(function* (
  threadId: ThreadId | undefined,
) {
  const context = yield* loadCaller();
  const own = context.scope.thread?.threadId;
  if (own !== undefined && threadId !== undefined && threadId !== own) {
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "Terminal tools reach only your own thread.",
    });
  }
  const target = yield* resolveThreadId(context, threadId);
  yield* assertFullAccess(context, "Terminal control needs full access.");
  return { context, threadId: target };
});

const service = TerminalAgentService.TerminalAgentService;

export const layer = McpToolAccess.toLayer(TerminalToolkit, {
  terminal_list: McpToolAccess.writesThreads(
    (params) => [params.threadId],
    (params) =>
      Effect.gen(function* () {
        const { threadId } = yield* resolveThread(params.threadId);
        return yield* (yield* service).list(threadId);
      }),
  ),
  terminal_open: McpToolAccess.writesThreads(
    (params) => [params.threadId],
    (params) =>
      Effect.gen(function* () {
        const { context, threadId } = yield* resolveThread(params.threadId);
        const shell = yield* context.threads
          .getThreadShell(threadId)
          .pipe(Effect.mapError(unavailable));
        if (shell === null || shell.deletedAt !== null || shell.archivedAt !== null) {
          return yield* new OrchestratorMcpFailure({
            code: "thread_not_found",
            message: `Thread ${threadId} was not found or is archived.`,
          });
        }
        const projects = yield* Project.ProjectService;
        const project = yield* projects.getById(shell.projectId).pipe(Effect.mapError(unavailable));
        if (Option.isNone(project)) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "The project was not found.",
          });
        }
        return yield* (yield* service).open({
          threadId,
          workspaceRoot: project.value.workspaceRoot,
          worktreePath: shell.worktreePath,
          ...(params.command ? { command: params.command } : {}),
        });
      }),
  ),
  terminal_send_text: McpToolAccess.writesThreads(
    (params) => [params.threadId],
    ({ threadId, terminalId, text }) =>
      Effect.gen(function* () {
        const resolved = yield* resolveThread(threadId);
        return yield* (yield* service).sendText({ threadId: resolved.threadId, terminalId }, text);
      }),
  ),
  terminal_send_keys: McpToolAccess.writesThreads(
    (params) => [params.threadId],
    ({ threadId, terminalId, keys }) =>
      Effect.gen(function* () {
        const resolved = yield* resolveThread(threadId);
        return yield* (yield* service).sendKeys({ threadId: resolved.threadId, terminalId }, keys);
      }),
  ),
  terminal_read: McpToolAccess.writesThreads(
    (params) => [params.threadId],
    ({ threadId, terminalId, ...options }) =>
      Effect.gen(function* () {
        const resolved = yield* resolveThread(threadId);
        return yield* (yield* service).read({ threadId: resolved.threadId, terminalId }, options);
      }),
  ),
  terminal_wait: McpToolAccess.writesThreads(
    (params) => [params.threadId],
    ({ threadId, terminalId, ...options }) =>
      Effect.gen(function* () {
        const resolved = yield* resolveThread(threadId);
        return yield* (yield* service).wait({ threadId: resolved.threadId, terminalId }, options);
      }),
  ),
  terminal_close: McpToolAccess.writesThreads(
    (params) => [params.threadId],
    ({ threadId, terminalId }) =>
      Effect.gen(function* () {
        const resolved = yield* resolveThread(threadId);
        return yield* (yield* service).close({ threadId: resolved.threadId, terminalId });
      }),
  ),
});
