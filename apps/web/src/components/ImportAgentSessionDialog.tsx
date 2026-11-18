import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  ProviderDriverKind,
  type AgentSessionListItem,
  type AgentSessionSource,
  type ScopedProjectRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";
import { create } from "zustand";

import { agentSessionImportOne, agentSessionList } from "../state/agentSessions";
import { readProject, subscribeProject, useProject } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { toastManager } from "./ui/toast";

const PROVIDER_LABELS: Record<AgentSessionSource, string> = {
  claudeAgent: "Claude Code",
  codex: "Codex",
  pi: "Pi",
};

const useRequest = create<{ projectRef: ScopedProjectRef | null; session: number }>(() => ({
  projectRef: null,
  session: 0,
}));

let endRequestWithProject: (() => void) | null = null;

/** Opens the picker that imports one terminal conversation into a project. */
export function openImportAgentSessionDialog(projectRef: ScopedProjectRef) {
  if (readProject(projectRef) === null) return;
  endRequestWithProject?.();
  endRequestWithProject = subscribeProject(projectRef, (project) => {
    if (project === null) close();
  });
  useRequest.setState((state) => ({ projectRef, session: state.session + 1 }));
}

function close() {
  endRequestWithProject?.();
  endRequestWithProject = null;
  useRequest.setState({ projectRef: null });
}

export function ImportAgentSessionDialogHost() {
  const projectRef = useRequest((state) => state.projectRef);
  const session = useRequest((state) => state.session);
  return projectRef ? <ImportAgentSessionDialog key={session} projectRef={projectRef} /> : null;
}

function ImportAgentSessionDialog({ projectRef }: { projectRef: ScopedProjectRef }) {
  const navigate = useNavigate();
  const project = useProject(projectRef);
  const canImport = useAtomValue(agentSessionImportOne.permissionAtom(projectRef.environmentId));
  const list = useEnvironmentQuery(
    project && canImport
      ? agentSessionList({
          environmentId: projectRef.environmentId,
          input: { projectId: projectRef.projectId, expectedWorkspaceRoot: project.workspaceRoot },
        })
      : null,
  );
  const importOne = useAtomCommand(agentSessionImportOne);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState<string | null>(null);

  const sessions = list.data?.sessions ?? [];
  const needle = query.trim().toLowerCase();
  const shown =
    needle.length === 0
      ? sessions
      : sessions.filter((session) => session.title.toLowerCase().includes(needle));

  const openThread = (threadId: ThreadId) => {
    close();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(projectRef.environmentId, threadId)),
    });
  };

  const importSession = async (session: AgentSessionListItem) => {
    if (!project || importing !== null) return;
    const key = sessionKey(session);
    setImporting(key);
    const result = await importOne({
      environmentId: projectRef.environmentId,
      input: {
        projectId: projectRef.projectId,
        providerInstanceId: session.providerInstanceId,
        providerSessionId: session.providerSessionId,
        expectedWorkspaceRoot: project.workspaceRoot,
      },
    });
    setImporting(null);
    if (result._tag !== "Success") return;
    if (!result.value.imported) toastManager.add({ type: "info", title: "Already in T3 Code" });
    openThread(result.value.threadId);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import CLI conversation</DialogTitle>
          <DialogDescription>
            Continue a Claude Code, Codex or Pi conversation from {project?.title ?? "this project"}{" "}
            in T3 Code.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {!canImport ? (
            <p className="text-muted-foreground text-sm">
              You need permission to run agents on this machine to import conversations.
            </p>
          ) : list.error ? (
            <p className="text-destructive-foreground text-sm">{list.error}</p>
          ) : list.data === null ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner className="size-4" />
              Finding conversations…
            </p>
          ) : sessions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No Claude Code, Codex or Pi conversations found for this folder.
            </p>
          ) : (
            <div className="flex min-h-0 flex-col gap-2">
              <Input
                size="sm"
                type="search"
                aria-label="Filter conversations"
                placeholder="Filter conversations"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <div className="max-h-96 overflow-y-auto rounded-md border">
                {shown.map((session) => (
                  <SessionRow
                    key={sessionKey(session)}
                    session={session}
                    importing={importing === sessionKey(session)}
                    busy={importing !== null}
                    onImport={() => void importSession(session)}
                    onOpen={openThread}
                  />
                ))}
                {shown.length === 0 ? (
                  <p className="px-2.5 py-2 text-muted-foreground text-xs">
                    No conversations match.
                  </p>
                ) : null}
              </div>
              {sessions.length >= 200 ? (
                <p className="text-muted-foreground text-xs">Showing the 200 most recent.</p>
              ) : null}
              {list.data.truncated ? (
                <p className="text-muted-foreground text-xs">Some conversations may be missing.</p>
              ) : null}
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function sessionKey(session: AgentSessionListItem) {
  return `${session.providerInstanceId}:${session.providerSessionId}`;
}

function SessionRow({
  session,
  importing,
  busy,
  onImport,
  onOpen,
}: {
  session: AgentSessionListItem;
  importing: boolean;
  busy: boolean;
  onImport: () => void;
  onOpen: (threadId: ThreadId) => void;
}) {
  const ownerThreadId = session.threadDeleted ? null : session.threadId;
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5 not-last:border-b">
      <ProviderInstanceIcon
        driverKind={ProviderDriverKind.make(session.provider)}
        displayName={PROVIDER_LABELS[session.provider]}
        size="compact"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{session.title}</span>
        <span className="truncate text-muted-foreground text-xs">
          {formatRelativeTimeLabel(session.lastActiveAt)}
          {session.branch ? ` · ${session.branch}` : ""}
          {session.threadDeleted ? " · Its T3 thread was deleted" : ""}
        </span>
      </div>
      {ownerThreadId !== null ? (
        <Button type="button" variant="outline" size="xs" onClick={() => onOpen(ownerThreadId)}>
          Open
        </Button>
      ) : session.threadDeleted ? null : (
        <Button type="button" size="xs" disabled={busy} onClick={onImport}>
          {importing ? "Importing…" : "Import"}
        </Button>
      )}
    </div>
  );
}
