import { settingsScopeEnvironmentLabels } from "./settingsScopeAxis";
import { Spinner } from "~/components/ui/spinner";
import { ArchiveIcon, ArchiveX, Trash2Icon } from "lucide-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { presentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useSettingsScope } from "./SettingsScopeContext";
import { useThreadActions } from "../../hooks/useThreadActions";
import { deleteSelectedThreadEntries } from "../Sidebar.logic";
import { readLocalApi } from "../../localApi";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { RelativeTime } from "../RelativeTime";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { ProjectFavicon } from "../ProjectFavicon";

import { useRef, useState } from "react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

const ARCHIVE_ACTIONS = [
  { action: "unarchive", label: "Unarchive", Icon: ArchiveX },
  { action: "delete", label: "Delete", Icon: Trash2Icon },
] as const;
type ArchiveAction = (typeof ARCHIVE_ACTIONS)[number]["action"];

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function ArchivedThreadsPanel() {
  const { scope, groups: projectGroups, environments } = useSettingsScope();
  const { unarchiveThread, confirmAndDeleteThread, deleteThread } = useThreadActions();
  const pendingActionsRef = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const {
    snapshots: archivedSnapshots,
    error: archiveError,
    isLoading: isLoadingArchive,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(scope.environmentIds);

  const { groups: archivedGroups, hasMultipleEnvironments } = (() => {
    const selectedProjectKeys =
      scope.kind === "project" || scope.kind === "checkout"
        ? new Set(scope.members.map((member) => `${member.environmentId}:${member.id}`))
        : null;
    const projectsByEnvironmentAndId = new Map(
      archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
        snapshot.projects
          .filter(
            (project) =>
              selectedProjectKeys === null ||
              selectedProjectKeys.has(`${environmentId}:${project.id}`),
          )
          .map(
            (project) => [`${environmentId}:${project.id}`, { ...project, environmentId }] as const,
          ),
      ),
    );
    const environmentLabels = new Map(
      environments.map((environment) => {
        const { primary, secondary } = settingsScopeEnvironmentLabels(environment, environments);
        return [environment.environmentId, secondary ? `${primary} (${secondary})` : primary];
      }),
    );
    const threads = archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.map((thread) => ({
        ...presentThreadShell(environmentId, thread),
        environmentLabel: environmentLabels.get(environmentId) ?? environmentId,
      })),
    );
    const hasMultipleEnvironments =
      new Set(
        threads
          .filter((thread) =>
            projectsByEnvironmentAndId.has(`${thread.environmentId}:${thread.projectId}`),
          )
          .map((thread) => thread.environmentId),
      ).size > 1;
    const logicalGroupsByProjectKey = new Map(
      projectGroups.flatMap((group) =>
        group.memberProjectRefs.map(
          (member) => [`${member.environmentId}:${member.projectId}`, group] as const,
        ),
      ),
    );

    const archivedProjects = Array.from(projectsByEnvironmentAndId.values());
    const groups = new Map<
      string,
      {
        readonly project: (typeof archivedProjects)[number];
        readonly title: string;
        readonly threads: Array<(typeof threads)[number]>;
      }
    >();
    for (const project of archivedProjects) {
      const projectThreads: Array<(typeof threads)[number]> = [];
      for (const thread of threads) {
        if (thread.projectId === project.id && thread.environmentId === project.environmentId) {
          projectThreads.push(thread);
        }
      }
      if (projectThreads.length > 0) {
        const physicalProjectKey = `${project.environmentId}:${project.id}` as const;
        const logicalGroup = hasMultipleEnvironments
          ? logicalGroupsByProjectKey.get(physicalProjectKey)
          : undefined;
        const groupKey = logicalGroup?.projectKey ?? physicalProjectKey;
        const group = groups.get(groupKey);
        if (group) {
          group.threads.push(...projectThreads);
        } else {
          groups.set(groupKey, {
            project,
            title: logicalGroup?.displayName ?? project.title,
            threads: projectThreads,
          });
        }
      }
    }
    const sortedGroups = Array.from(groups, ([key, group]) => ({
      ...group,
      key,
      threads: group.threads.toSorted((left, right) => {
        const leftKey = left.archivedAt ?? left.createdAt;
        const rightKey = right.archivedAt ?? right.createdAt;
        return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
      }),
    }));
    return { groups: sortedGroups, hasMultipleEnvironments };
  })();

  type ArchivedThread = (typeof archivedGroups)[number]["threads"][number];
  const archivedThreadCount = archivedGroups.reduce((sum, group) => sum + group.threads.length, 0);

  const reportFailure = (result: AtomCommandResult<unknown, unknown> | null, title: string) => {
    if (result?._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  };

  const handleThreadAction = async (action: ArchiveAction, thread: ArchivedThread) => {
    const target = scopeThreadRef(thread.environmentId, thread.id);
    const key = scopedThreadKey(target);
    // Context menus can outlive their render, so checks and cleanup use the live set.
    const pending = pendingActionsRef.current;
    if (pending.has(key)) return;
    pending.add(key);
    setPendingKeys(new Set(pending));
    const result = await settlePromise(async () => {
      const result = await (action === "unarchive"
        ? unarchiveThread(target)
        : confirmAndDeleteThread(target, thread.title));
      if (result._tag === "Success") refreshArchivedThreads();
      return result;
    }).finally(() => {
      pending.delete(key);
      setPendingKeys(new Set(pending));
    });
    reportFailure(result._tag === "Failure" ? result : result.value, `Failed to ${action} thread`);
  };

  const threadKeyOf = (thread: ArchivedThread) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

  const deleteArchivedThreads = async (threads: ReadonlyArray<ArchivedThread>, label: string) => {
    const pending = pendingActionsRef.current;
    const entries = threads
      .map((thread) => ({ thread, threadKey: threadKeyOf(thread) }))
      .filter((entry) => !pending.has(entry.threadKey));
    const localApi = readLocalApi();
    if (entries.length === 0 || !localApi) return;
    const count = entries.length;
    // Always confirmed, even when single deletes skip it: this clears many histories at once.
    const confirmed = await settlePromise(() =>
      localApi.dialogs.confirm(
        [
          `Delete ${plural(count, "archived thread")} in ${label}?`,
          "This permanently clears conversation history for these threads. Their worktrees are kept unless worktree cleanup on delete is on.",
        ].join("\n"),
        { variant: "destructive" },
      ),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    for (const { threadKey } of entries) pending.add(threadKey);
    setPendingKeys(new Set(pending));
    const result = await settlePromise(() =>
      deleteSelectedThreadEntries({
        entries,
        delete: ({ thread }, deletedThreadKeys) =>
          deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
            deletedThreadKeys,
            askAboutWorktree: false,
          }),
      }),
    ).finally(() => {
      for (const { threadKey } of entries) pending.delete(threadKey);
      setPendingKeys(new Set(pending));
    });
    refreshArchivedThreads();
    reportFailure(
      result._tag === "Failure" ? result : result.value.firstFailure,
      "Failed to delete archived threads",
    );
  };

  const deleteAllButton = (threads: ReadonlyArray<ArchivedThread>, label: string) => (
    <Button
      type="button"
      variant="destructive-outline"
      size="compact"
      disabled={threads.some((thread) => pendingKeys.has(threadKeyOf(thread)))}
      onClick={() => void deleteArchivedThreads(threads, label)}
    >
      <Trash2Icon />
      Delete all
    </Button>
  );

  const handleContextMenu = async (thread: ArchivedThread, position: { x: number; y: number }) => {
    const pending = pendingActionsRef.current;
    if (pending.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))) return;
    const result = await settlePromise(async () => {
      const clicked = await readLocalApi()?.contextMenu.show(
        ARCHIVE_ACTIONS.map(({ action, label }) => ({
          id: action,
          label,
          destructive: action === "delete",
        })),
        position,
      );
      if (clicked === "unarchive" || clicked === "delete")
        await handleThreadAction(clicked, thread);
    });
    reportFailure(result, "Archived thread action failed");
  };

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection
          id={isLoadingArchive ? undefined : searchableSetting("archive").id}
          title={searchableSetting("archive").title}
        >
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                {isLoadingArchive ? (
                  <Spinner size="sm" tone="muted" />
                ) : (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                )}
                {isLoadingArchive
                  ? "Loading archived threads"
                  : archiveError
                    ? "Could not load archived threads"
                    : "No archived threads"}
              </span>
            }
            description={
              isLoadingArchive
                ? "Checking connected environments."
                : (archiveError ?? "Archived threads will appear here.")
            }
          />
        </SettingsSection>
      ) : (
        <>
          <SettingsSection
            id={searchableSetting("archive").id}
            title={searchableSetting("archive").title}
          >
            <SettingsRow
              title="Delete all archived threads"
              description={`${plural(archivedThreadCount, "thread")} in ${plural(archivedGroups.length, "project")}.`}
              control={deleteAllButton(
                archivedGroups.flatMap((group) => group.threads),
                "all projects",
              )}
            />
          </SettingsSection>
          {archivedGroups.map(({ key, project, title, threads: projectThreads }) => (
            <SettingsSection
              key={key}
              title={title}
              icon={<ProjectFavicon project={project} />}
              headerAction={deleteAllButton(projectThreads, title)}
            >
              {projectThreads.map((thread) => {
                const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
                return (
                  <SettingsRow
                    key={`${thread.environmentId}:${thread.id}`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      void handleContextMenu(thread, { x: event.clientX, y: event.clientY });
                    }}
                    title={thread.title}
                    description={
                      <span className={hasMultipleEnvironments ? "block truncate" : undefined}>
                        {hasMultipleEnvironments ? `${thread.environmentLabel} · ` : null}
                        Archived <RelativeTime timestamp={thread.archivedAt ?? thread.createdAt} />
                        {" \u00b7 Created "}
                        <RelativeTime timestamp={thread.createdAt} />
                      </span>
                    }
                    control={
                      <div className="flex shrink-0 items-center gap-2">
                        {ARCHIVE_ACTIONS.map(({ action, label, Icon }) => (
                          <Tooltip key={action}>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  variant={action === "delete" ? "destructive-outline" : "outline"}
                                  size="icon-sm"
                                  aria-label={`${label} ${thread.title}`}
                                  disabled={pendingKeys.has(threadKey)}
                                  onClick={() => void handleThreadAction(action, thread)}
                                />
                              }
                            >
                              <Icon className="size-3.5" />
                            </TooltipTrigger>
                            <TooltipPopup>{label}</TooltipPopup>
                          </Tooltip>
                        ))}
                      </div>
                    }
                  />
                );
              })}
            </SettingsSection>
          ))}
        </>
      )}
    </SettingsPageContainer>
  );
}
