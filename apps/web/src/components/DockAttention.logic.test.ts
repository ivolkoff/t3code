import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../test-fixtures";
import { selectDockAttention } from "./DockAttention.logic";

const local = EnvironmentId.make("local");
const NOW = "2026-03-09T12:00:00.000Z";
const VISITED_BEFORE_RUN = "2026-03-09T10:01:00.000Z";
const VISITED_AFTER_RUN = "2026-03-09T10:06:00.000Z";

function runtime(status: NonNullable<EnvironmentThreadShell["runtime"]>["status"]) {
  return {
    status,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: status === "failed" ? "boom" : null,
    updatedAt: "2026-03-09T10:05:00.000Z",
  };
}

function run(status: NonNullable<EnvironmentThreadShell["latestRun"]>["status"]) {
  return {
    runId: RunId.make("run-1"),
    status,
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: "2026-03-09T10:00:00.000Z",
    completedAt: "2026-03-09T10:05:00.000Z",
  };
}

function thread(id: string, overrides: ThreadFixtureOverrides = {}) {
  return makeThreadFixture({
    environmentId: local,
    id: ThreadId.make(id),
    projectId: ProjectId.make("project"),
    title: id,
    runtime: runtime("completed"),
    latestRun: run("completed"),
    lastVisitedAt: VISITED_BEFORE_RUN,
    ...overrides,
  });
}

function select(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  input: Partial<Parameters<typeof selectDockAttention>[0]> = {},
) {
  return selectDockAttention({
    threads,
    localLastVisitedAtById: {},
    liveEnvironmentIds: new Set([local]),
    projectName: () => undefined,
    now: NOW,
    ...input,
  });
}

const groupOf = (items: ReturnType<typeof select>) =>
  items.map((item) => `${item.group}:${item.threadId}`);

describe("selectDockAttention", () => {
  it("lists threads that need the user, and unseen completions as done", () => {
    const failed = { runtime: runtime("failed"), latestRun: run("failed") };
    const snoozed = { snoozedUntil: "2026-03-10T09:00:00.000Z", snoozedAt: VISITED_AFTER_RUN };
    const lineage = (extra: object) => ({
      lineage: {
        rootThreadId: ThreadId.make("root"),
        parentThreadId: ThreadId.make("root"),
        relationshipToParent: null,
        ...extra,
      },
    });
    const cases: ReadonlyArray<
      readonly [string, ThreadFixtureOverrides, "attention" | "done" | null]
    > = [
      ["approval", { hasPendingApprovals: true }, "attention"],
      ["input", { hasPendingUserInput: true }, "attention"],
      ["guest request", { pendingGuestMessageCount: 1 }, "attention"],
      [
        "usage limit",
        { runtime: { ...runtime("failed"), lastErrorClass: "usage_limit" } },
        "attention",
      ],
      ["unseen failure", failed, "attention"],
      ["seen failure", { ...failed, lastVisitedAt: VISITED_AFTER_RUN }, null],
      ["unseen completion", {}, "done"],
      ["seen completion", { lastVisitedAt: VISITED_AFTER_RUN }, null],
      ["never opened", { lastVisitedAt: null }, null],
      ["interrupted", { runtime: runtime("interrupted"), latestRun: run("interrupted") }, null],
      ["cancelled", { runtime: runtime("cancelled"), latestRun: run("cancelled") }, null],
      ["working", { runtime: runtime("running") }, null],
      ["archived", { hasPendingApprovals: true, archivedAt: NOW }, null],
      [
        "subagent",
        { hasPendingApprovals: true, ...lineage({ relationshipToParent: "subagent" }) },
        null,
      ],
      ["side chat", { hasPendingApprovals: true, ...lineage({ sideChat: true }) }, null],
      ["snoozed done", snoozed, null],
      [
        "snoozed question asked before the snooze",
        { ...snoozed, hasPendingUserInput: true, pendingUserInputAt: VISITED_BEFORE_RUN },
        null,
      ],
      [
        "snoozed thread that raised its hand",
        { ...snoozed, hasPendingApprovals: true },
        "attention",
      ],
    ];
    for (const [name, overrides, group] of cases) {
      expect(
        select([thread(name, overrides)]).map((item) => item.group),
        name,
      ).toEqual(group === null ? [] : [group]);
    }
  });

  it("uses a local visit only for servers that do not track visits", () => {
    const key = scopedThreadKey(scopeThreadRef(local, ThreadId.make("old-server")));
    const localLastVisitedAtById = { [key]: VISITED_BEFORE_RUN };
    const { lastVisitedAt: _untracked, ...oldServer } = thread("old-server");
    expect(select([oldServer], { localLastVisitedAtById })).toHaveLength(1);
    expect(
      select([thread("old-server", { lastVisitedAt: null })], { localLastVisitedAtById }),
    ).toEqual([]);
  });

  it("skips environments that are not live", () => {
    const remote = EnvironmentId.make("remote");
    expect(
      select([thread("offline", { environmentId: remote, hasPendingApprovals: true })]),
    ).toEqual([]);
  });

  it("puts needs-you first, newest first in each group, and fills the limit with needs-you", () => {
    const at = (hour: number) => `2026-03-09T${String(hour).padStart(2, "0")}:30:00.000Z`;
    expect(
      groupOf(
        select([
          thread("old-done", { updatedAt: at(1) }),
          thread("old-ask", { hasPendingApprovals: true, updatedAt: at(2) }),
          thread("new-done", { updatedAt: at(3) }),
          thread("new-ask", { hasPendingUserInput: true, updatedAt: at(4) }),
        ]),
      ),
    ).toEqual(["attention:new-ask", "attention:old-ask", "done:new-done", "done:old-done"]);

    const done = Array.from({ length: 12 }, (_, index) =>
      thread(`done-${index}`, { updatedAt: at(index + 10) }),
    );
    const asks = Array.from({ length: 3 }, (_, index) =>
      thread(`ask-${index}`, { hasPendingApprovals: true, updatedAt: at(index) }),
    );
    expect(groupOf(select([...done, ...asks]))).toEqual([
      "attention:ask-2",
      "attention:ask-1",
      "attention:ask-0",
      ...[21, 20, 19, 18, 17, 16, 15].map((hour) => `done:done-${hour - 10}`),
    ]);
  });

  it("labels items with the project and truncates long labels", () => {
    const projectName = (item: EnvironmentThreadShell) =>
      item.title === "orphan" ? undefined : "t3code";
    const long = "x".repeat(100);
    expect(
      select([thread("Fix login"), thread("orphan"), thread(long)], { projectName }).map(
        (item) => item.label,
      ),
    ).toEqual(["Fix login · t3code", "orphan", `${"x".repeat(79)}…`]);
  });
});
