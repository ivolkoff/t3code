import { sortInboxThreadsByReturn } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import type { TimelineEntry } from "../../session-logic";
import { liveWorkEntryLabel } from "../chat/MessagesTimeline.logic";
import {
  filterSidebarV2VisibleThreads,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "../Sidebar.logic";
import { liveThoughtLine } from "@t3tools/client-runtime/work-log/presentation";

export const DASHBOARD_CARD_LIMIT = 9;
export const DASHBOARD_COMPLETED_WINDOW_MS = 12 * 60 * 60 * 1000;
const DASHBOARD_TAIL_LINES = 3;

// ThreadStatusPill labels are option-less msg() strings, which equal their English text.
const GROUP_BY_STATUS: Readonly<Record<string, number>> = {
  "Pending Approval": 0,
  "Awaiting Input": 0,
  "Guest Request": 0,
  Failed: 0,
  "Plan Ready": 0,
  Working: 1,
  Connecting: 1,
  Waiting: 1,
  Completed: 2,
};
const PINNED_GROUP = 3;

export function dashboardThreadStatus(
  thread: EnvironmentThreadShell,
  lastVisitedAt: string | undefined,
): ThreadStatusPill | null {
  return resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt } });
}

export function selectDashboardThreads<T extends EnvironmentThreadShell>(
  threads: readonly T[],
  options: {
    delegatedUnderParent: ReadonlySet<string>;
    lastVisitedAt: (thread: T) => string | undefined;
    now: number;
  },
): { cards: T[]; overflow: number } {
  const groupByThread = new Map<T, number>();
  for (const thread of filterSidebarV2VisibleThreads(threads, null, options.delegatedUnderParent)) {
    if (thread.deletedAt !== null) continue;
    const status = dashboardThreadStatus(thread, options.lastVisitedAt(thread));
    const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
    const recent =
      status?.label !== "Completed" || options.now - completedAt <= DASHBOARD_COMPLETED_WINDOW_MS;
    const group = status === null ? undefined : GROUP_BY_STATUS[status.label];
    if (group !== undefined && recent) groupByThread.set(thread, group);
    else if (thread.pinnedAt !== null) groupByThread.set(thread, PINNED_GROUP);
  }
  // sortInboxThreadsByReturn is stable within its keys, and those move only when a run starts or ends.
  const sorted = sortInboxThreadsByReturn([...groupByThread.keys()]).sort(
    (left, right) => groupByThread.get(left)! - groupByThread.get(right)!,
  );
  return {
    cards: sorted.slice(0, DASHBOARD_CARD_LIMIT),
    overflow: Math.max(0, sorted.length - DASHBOARD_CARD_LIMIT),
  };
}

function firstLine(text: string): string {
  return text.trimStart().split("\n", 1)[0]!.trim();
}

export function dashboardTailLines(
  entries: readonly TimelineEntry[],
  workspaceRoot: string | undefined,
  active: boolean,
): string[] {
  const lines: string[] = [];
  for (const [index, entry] of entries.entries()) {
    let line = "";
    if (entry.kind === "work") {
      const work = entry.entry;
      // liveWorkEntryLabel runs a regex over the whole reasoning text, which streams in.
      const detail = work.itemType === "reasoning" && work.detail ? firstLine(work.detail) : null;
      line = liveWorkEntryLabel(
        detail === null ? work : { ...work, detail },
        workspaceRoot,
        active && index === entries.length - 1,
      );
    } else if (entry.kind === "message" && entry.message.role === "user") {
      const text = firstLine(entry.message.text);
      if (text) line = `› ${text}`;
    } else if (entry.kind === "message" && entry.message.role === "assistant") {
      line = liveThoughtLine(entry.message.text);
    }
    if (line) lines.push(line);
  }
  return lines.slice(-DASHBOARD_TAIL_LINES);
}
