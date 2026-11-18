import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { liveThoughtLine } from "@t3tools/client-runtime/work-log/presentation";
import { Link } from "@tanstack/react-router";
import { T, useGT, useMessages, Var } from "gt-react";
import { memo } from "react";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { deriveTimelineEntriesFromVisibleTurnItems } from "../../session-logic";
import {
  useAllEnvironmentShellsBootstrapped,
  useAssistantMessageText,
  useDelegatedUnderParent,
  useProject,
  useQuietThreadShells,
  useTimelineVisibleTurnItems,
} from "../../state/entities";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { SidebarThreadSummary } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import { resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { RelativeTimeLabel } from "../sidebar/SidebarThreadRow";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  dashboardTailLines,
  dashboardThreadStatus,
  selectDashboardThreads,
} from "./ThreadDashboard.logic";

const TAIL_ITEM_WINDOW = 12;
const TAIL_LINES = 3;

export function ThreadDashboardPage() {
  const gt = useGT();
  const shells = useQuietThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const delegatedUnderParent = useDelegatedUnderParent();
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  // The minute tick only ages unseen completions out of the 12-hour window.
  const nowMinute = useNowMinute();
  const lastVisitedAt = (thread: SidebarThreadSummary) =>
    resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      localLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
    );
  const { cards, overflow } = selectDashboardThreads(shells, {
    delegatedUnderParent,
    lastVisitedAt,
    now: Date.parse(`${nowMinute}:00.000Z`),
  });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="relative bg-background">
          <WorkspaceBreadcrumb ariaLabel={gt("Dashboard breadcrumb")}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">
                <T>Dashboard</T>
              </h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!bootstrapped ? null : cards.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyTitle>
                  <T>No threads are working or waiting for you.</T>
                </EmptyTitle>
                <EmptyDescription>
                  <T>Pinned threads also show here.</T>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3 px-5 pt-4 pb-12 sm:px-6">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-3">
                {cards.map((thread) => (
                  <DashboardCard
                    key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
                    thread={thread}
                    lastVisitedAt={lastVisitedAt(thread)}
                  />
                ))}
              </div>
              {overflow > 0 ? (
                <p className="text-xs text-muted-foreground">
                  <T>
                    +<Var>{overflow}</Var> more
                  </T>
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

const DashboardCard = memo(function DashboardCard({
  thread,
  lastVisitedAt,
}: {
  thread: SidebarThreadSummary;
  lastVisitedAt: string | undefined;
}) {
  const gt = useGT();
  const m = useMessages();
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const status = dashboardThreadStatus(thread, lastVisitedAt);
  const project = useProject(scopeProjectRef(thread.environmentId, thread.projectId));
  const environment = useEnvironment(thread.environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentLabel =
    thread.environmentId === primaryEnvironmentId ? null : (environment?.label ?? gt("Remote"));
  return (
    <Link
      to="/$environmentId/$threadId"
      params={buildThreadRouteParams(threadRef)}
      draggable={false}
      className="flex h-32 min-w-0 flex-col gap-1 overflow-hidden rounded-lg border border-border bg-card p-3 text-card-foreground no-underline outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="flex min-w-0 items-center gap-2 text-sm">
        {status ? (
          <span className={`inline-flex shrink-0 items-center gap-1 text-xs ${status.colorClass}`}>
            <span className={`size-1.5 rounded-full ${status.dotClass}`} />
            {m(status.label)}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-medium">{thread.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
          <RelativeTimeLabel timestamp={resolveThreadActivityTimestamp(thread)} />
        </span>
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {[project?.title, environmentLabel].filter(Boolean).join(" · ")}
      </span>
      <DashboardTail
        thread={thread}
        workspaceRoot={thread.worktreePath ?? project?.workspaceRoot}
      />
    </Link>
  );
});

function DashboardTail({
  thread,
  workspaceRoot,
}: {
  thread: SidebarThreadSummary;
  workspaceRoot: string | undefined;
}) {
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const active = threadRuntimeIsActive(thread.runtime);
  const items = useTimelineVisibleTurnItems(threadRef);
  const last = items.at(-1)?.item;
  const liveItemId = last?.type === "assistant_message" ? last.id : undefined;
  const tailItems =
    liveItemId === undefined ? items.slice(-TAIL_ITEM_WINDOW) : items.slice(-TAIL_ITEM_WINDOW, -1);
  const lines = dashboardTailLines(
    deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems: tailItems,
      optimisticMessages: [],
    }),
    workspaceRoot,
    // A streaming reply means the tool before it has already finished.
    active && liveItemId === undefined,
  );
  const liveText = useAssistantMessageText(threadRef, liveItemId);
  const liveLine = liveText ? liveThoughtLine(liveText) : "";
  const shown = liveLine ? [...lines, liveLine].slice(-TAIL_LINES) : lines;
  return (
    <span className="mt-auto flex min-w-0 flex-col font-mono text-2xs leading-4 text-muted-foreground">
      {shown.map((line, index) => (
        // Lines have no stable identity; the tail is rebuilt whole on each change.
        // oxlint-disable-next-line react/no-array-index-key
        <span key={index} className="truncate">
          {line}
        </span>
      ))}
    </span>
  );
}
