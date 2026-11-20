import {
  OrchestratorMcpFailure,
  TerminalMcpCloseInput,
  TerminalMcpCloseResult,
  TerminalMcpCursorResult,
  TerminalMcpListInput,
  TerminalMcpListResult,
  TerminalMcpOpenInput,
  TerminalMcpOpenResult,
  TerminalMcpReadInput,
  TerminalMcpReadResult,
  TerminalMcpSendKeysInput,
  TerminalMcpSendTextInput,
  TerminalMcpWaitInput,
  TerminalMcpWaitResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as TerminalAgentService from "../../../terminal/TerminalAgentService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
    TerminalAgentService.TerminalAgentService,
    Project.ProjectService,
  ],
};

const TerminalListTool = Tool.make("terminal_list", {
  ...shared,
  description: "List the thread's terminals, including ones the user opened.",
  parameters: TerminalMcpListInput,
  success: TerminalMcpListResult,
}).annotate(Tool.Readonly, true);

const TerminalOpenTool = Tool.make("terminal_open", {
  ...shared,
  description:
    "Open a terminal in the thread's worktree, visible to the user in its terminal drawer. When the user must type (a password), say which terminal.",
  parameters: TerminalMcpOpenInput,
  success: TerminalMcpOpenResult,
});

const TerminalSendTextTool = Tool.make("terminal_send_text", {
  ...shared,
  description: "Type literal text into a terminal. Returns the cursor before it.",
  parameters: TerminalMcpSendTextInput,
  success: TerminalMcpCursorResult,
});

const TerminalSendKeysTool = Tool.make("terminal_send_keys", {
  ...shared,
  description: "Press keys in a terminal. Returns the cursor before them.",
  parameters: TerminalMcpSendKeysInput,
  success: TerminalMcpCursorResult,
});

const TerminalReadTool = Tool.make("terminal_read", {
  ...shared,
  description: "Read a terminal's screen or recent lines.",
  parameters: TerminalMcpReadInput,
  success: TerminalMcpReadResult,
}).annotate(Tool.Readonly, true);

const TerminalWaitTool = Tool.make("terminal_wait", {
  ...shared,
  description:
    "Wait until a terminal shows `match` or `regex`, the command exits, or the timeout. Pick a pattern your own input cannot contain (a prompt anchored with $) and pass `since` from your last call; on timedOut, wait again.",
  parameters: TerminalMcpWaitInput,
  success: TerminalMcpWaitResult,
}).annotate(Tool.Readonly, true);

const TerminalCloseTool = Tool.make("terminal_close", {
  ...shared,
  description: "Close a terminal and stop what runs in it.",
  parameters: TerminalMcpCloseInput,
  success: TerminalMcpCloseResult,
}).annotate(Tool.Destructive, true);

export const TerminalToolkit = Toolkit.make(
  TerminalListTool,
  TerminalOpenTool,
  TerminalSendTextTool,
  TerminalSendKeysTool,
  TerminalReadTool,
  TerminalWaitTool,
  TerminalCloseTool,
);
