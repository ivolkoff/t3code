import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { isListedThreadLineage, type DesktopDockAttentionItem } from "@t3tools/contracts";

import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
} from "./Sidebar.logic";

const DOCK_ATTENTION_LIMIT = 10;
const LABEL_MAX_LENGTH = 80;
const NEEDS_YOU_STATUSES = new Set(["approval", "input", "request", "limited", "failed"]);

function dockLabel(title: string, projectName: string | undefined): string {
  const characters = Array.from(projectName ? `${title} · ${projectName}` : title);
  return characters.length > LABEL_MAX_LENGTH
    ? `${characters.slice(0, LABEL_MAX_LENGTH - 1).join("")}…`
    : characters.join("");
}

const newestFirst = (left: EnvironmentThreadShell, right: EnvironmentThreadShell) =>
  left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0;

/** The Dock menu's threads: what the sidebar shows as needing the user, then unseen Done. */
export function selectDockAttention(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly localLastVisitedAtById: Readonly<Record<string, string>>;
  readonly liveEnvironmentIds: ReadonlySet<string>;
  readonly projectName: (thread: EnvironmentThreadShell) => string | undefined;
  readonly now: string;
}): DesktopDockAttentionItem[] {
  const attention: EnvironmentThreadShell[] = [];
  const done: EnvironmentThreadShell[] = [];
  for (const thread of input.threads) {
    // Subagents and side chats have no row of their own; their requests surface on the parent.
    if (thread.archivedAt !== null || !isListedThreadLineage(thread.lineage)) continue;
    if (!input.liveEnvironmentIds.has(thread.environmentId)) continue;
    if (effectiveSnoozed(thread, { now: input.now })) continue;
    const visited = {
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        input.localLastVisitedAtById[
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
        ],
      ),
    };
    const status = resolveSidebarRowStatus(visited);
    if (NEEDS_YOU_STATUSES.has(status)) attention.push(thread);
    else if (status === "ready" && hasUnseenCompletion(visited)) done.push(thread);
  }
  const toItem =
    (group: DesktopDockAttentionItem["group"]) =>
    (thread: EnvironmentThreadShell): DesktopDockAttentionItem => ({
      environmentId: thread.environmentId,
      threadId: thread.id,
      label: dockLabel(thread.title, input.projectName(thread)),
      group,
    });
  return [
    ...attention.toSorted(newestFirst).map(toItem("attention")),
    ...done.toSorted(newestFirst).map(toItem("done")),
  ].slice(0, DOCK_ATTENTION_LIMIT);
}
