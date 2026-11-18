import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { EnvironmentId, MessageId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import type { Thread } from "../../types";
import {
  DASHBOARD_CARD_LIMIT,
  DASHBOARD_COMPLETED_WINDOW_MS,
  dashboardTailLines,
  selectDashboardThreads,
} from "./ThreadDashboard.logic";

const environmentId = EnvironmentId.make("environment-local");
const NOW = Date.parse("2026-03-09T12:00:00.000Z");
const VISITED_BEFORE_RUN = "2026-03-09T09:00:00.000Z";

const runtime = (status: NonNullable<Thread["runtime"]>["status"]) => ({
  status,
  providerName: "Codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  activeRunId: status === "idle" ? null : ("run-1" as never),
  lastError: null,
  updatedAt: "2026-03-09T10:00:00.000Z",
});

const completedRun = (completedAt: string): NonNullable<Thread["latestRun"]> => ({
  runId: "run-1" as never,
  status: "completed",
  assistantMessageId: null,
  requestedAt: "2026-03-09T10:00:00.000Z",
  startedAt: "2026-03-09T10:00:00.000Z",
  completedAt,
});

function thread(id: string, overrides: ThreadFixtureOverrides = {}): Thread {
  return makeThreadFixture({
    id: ThreadId.make(id),
    environmentId,
    lastVisitedAt: VISITED_BEFORE_RUN,
    ...overrides,
  });
}

const working = (id: string, overrides: ThreadFixtureOverrides = {}) =>
  thread(id, { runtime: runtime("running"), ...overrides });

function select(threads: readonly Thread[], delegatedUnderParent: ReadonlySet<string> = new Set()) {
  return selectDashboardThreads(threads, {
    delegatedUnderParent,
    lastVisitedAt: (t) => t.lastVisitedAt ?? undefined,
    now: NOW,
  });
}

const ids = (result: ReturnType<typeof select>) => result.cards.map((t) => t.id);

describe("selectDashboardThreads", () => {
  it.each([
    ["archived", working("t", { archivedAt: "2026-03-09T11:00:00.000Z" })],
    ["deleted", working("t", { deletedAt: "2026-03-09T11:00:00.000Z" })],
    ["idle and unpinned", thread("t", { runtime: runtime("idle") })],
    [
      "seen completion",
      thread("t", {
        latestRun: completedRun("2026-03-09T11:00:00.000Z"),
        lastVisitedAt: "2026-03-09T11:30:00.000Z",
      }),
    ],
    [
      "unseen completion older than the window",
      thread("t", {
        latestRun: completedRun(new Date(NOW - DASHBOARD_COMPLETED_WINDOW_MS - 1).toISOString()),
        lastVisitedAt: "2026-03-07T00:00:00.000Z",
      }),
    ],
  ])("leaves out a %s thread", (_name, candidate) => {
    expect(select([candidate]).cards).toEqual([]);
  });

  it("leaves out a thread shown under its parent", () => {
    const delegated = working("child");
    expect(
      select([delegated], new Set([threadKey(scopeThreadRef(environmentId, delegated.id))])).cards,
    ).toEqual([]);
  });

  it("orders waiting-for-you, then working, then unseen completions, then pinned idle", () => {
    const result = select([
      thread("pinned", { pinnedAt: "2026-03-09T11:00:00.000Z" }),
      thread("completed", { latestRun: completedRun("2026-03-09T11:00:00.000Z") }),
      working("working"),
      working("approval", { hasPendingApprovals: true }),
    ]);
    expect(ids(result)).toEqual(["approval", "working", "completed", "pinned"]);
  });

  it("keeps the order inside a group when only updatedAt moves", () => {
    const older = working("older", { createdAt: "2026-03-09T10:00:00.000Z" });
    const newer = working("newer", { createdAt: "2026-03-09T10:30:00.000Z" });
    const before = ids(select([older, newer]));
    const after = ids(select([{ ...older, updatedAt: "2026-03-09T11:59:00.000Z" }, newer]));
    expect(before).toEqual(["newer", "older"]);
    expect(after).toEqual(before);
  });

  it("caps the grid and counts the rest", () => {
    const result = select(Array.from({ length: 12 }, (_, index) => working(`t-${index}`)));
    expect(result.cards).toHaveLength(DASHBOARD_CARD_LIMIT);
    expect(result.overflow).toBe(3);
  });
});

const workEntry = (id: string, entry: Record<string, unknown>): TimelineEntry =>
  ({
    id,
    kind: "work",
    createdAt: "2026-03-09T10:00:00.000Z",
    entry: { id, createdAt: "2026-03-09T10:00:00.000Z", label: id, tone: "tool", ...entry },
  }) as TimelineEntry;

const userMessage = (id: string, text: string): TimelineEntry => ({
  id,
  kind: "message",
  createdAt: "2026-03-09T10:00:00.000Z",
  message: {
    id: MessageId.make(id),
    role: "user",
    text,
    runId: null,
    streaming: false,
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
  },
});

describe("dashboardTailLines", () => {
  it("returns nothing for an empty timeline", () => {
    expect(dashboardTailLines([], undefined, true)).toEqual([]);
  });

  it("keeps the last three lines", () => {
    expect(
      dashboardTailLines(
        [
          userMessage("m1", "first"),
          userMessage("m2", "second\nmore"),
          workEntry("w1", { command: "vp test run", toolLifecycleStatus: "inProgress" }),
          workEntry("w2", { command: "git status", toolLifecycleStatus: "completed" }),
        ],
        undefined,
        false,
      ),
    ).toEqual(["› second", "Running vp", "Ran git"]);
  });

  it("shows only the first line of reasoning", () => {
    expect(
      dashboardTailLines(
        [workEntry("r", { itemType: "reasoning", tone: "thinking", detail: "Plan  it\nthen go" })],
        undefined,
        true,
      ),
    ).toEqual(["Plan it"]);
  });
});
