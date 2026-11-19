import { ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { shouldOfferSettle, type WorkingOnOfferThread } from "./workingOnOffer.logic";

const threadId = ThreadId.make("thread:offer");
const runId = RunId.make("run:offer");

const offered: WorkingOnOfferThread = {
  workingOn: null,
  workingOnDoneAt: "2026-11-18T10:05:00.000Z",
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  settledOverride: null,
  unsettledAt: null,
  latestRun: {
    runId,
    status: "completed",
    requestedAt: "2026-11-18T10:00:00.000Z",
    startedAt: "2026-11-18T10:00:01.000Z",
    completedAt: "2026-11-18T10:06:00.000Z",
    assistantMessageId: null,
  },
  runtime: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingBackgroundTasks: [],
};

describe("shouldOfferSettle", () => {
  it("offers once the thread's agent cleared its line in the finished latest run", () => {
    expect(shouldOfferSettle(offered, { snoozed: false })).toBe(true);
  });

  it.each<[string, Partial<WorkingOnOfferThread>, boolean?]>([
    ["no done mark", { workingOnDoneAt: null }],
    ["a new line was set", { workingOn: "Next task" }],
    [
      "a subagent",
      {
        lineage: {
          parentThreadId: threadId,
          relationshipToParent: "subagent",
          rootThreadId: threadId,
        },
      },
    ],
    [
      "a side chat",
      {
        lineage: {
          parentThreadId: threadId,
          relationshipToParent: "fork",
          rootThreadId: threadId,
          sideChat: true,
        },
      },
    ],
    ["settled", { settledOverride: "settled" }],
    ["snoozed", {}, true],
    ["no run", { latestRun: null }],
    ["a running run", { latestRun: { ...offered.latestRun!, status: "running" } }],
    ["a failed run", { latestRun: { ...offered.latestRun!, status: "failed" } }],
    [
      "an active run",
      {
        runtime: {
          status: "queued",
          activeRunId: runId,
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerName: null,
          lastError: null,
          updatedAt: "2026-11-18T10:06:00.000Z",
        },
      },
    ],
    ["a pending approval", { hasPendingApprovals: true }],
    ["a pending question", { hasPendingUserInput: true }],
    [
      "awaited background work",
      { pendingBackgroundTasks: [{ kind: "command", taskId: "task:build", awaited: true }] },
    ],
    [
      "a later run, such as a wake",
      {
        latestRun: {
          ...offered.latestRun!,
          requestedAt: "2026-11-18T10:07:00.000Z",
          startedAt: "2026-11-18T10:07:01.000Z",
        },
      },
    ],
    [
      "a run queued before the mark that started after it",
      { latestRun: { ...offered.latestRun!, startedAt: "2026-11-18T10:07:00.000Z" } },
    ],
    ["un-settled after the mark", { unsettledAt: "2026-11-18T10:08:00.000Z" }],
  ])("not with %s", (_, change, snoozed = false) => {
    expect(shouldOfferSettle({ ...offered, ...change }, { snoozed })).toBe(false);
  });

  it("still offers while a background command such as a dev server keeps running", () => {
    expect(
      shouldOfferSettle(
        { ...offered, pendingBackgroundTasks: [{ kind: "command", taskId: "task:dev" }] },
        { snoozed: false },
      ),
    ).toBe(true);
  });

  it("still offers after an un-settle that came before the mark", () => {
    expect(
      shouldOfferSettle(
        { ...offered, unsettledAt: "2026-11-18T09:00:00.000Z" },
        { snoozed: false },
      ),
    ).toBe(true);
  });
});
