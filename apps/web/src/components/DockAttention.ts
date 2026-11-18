import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { AtomRegistry } from "effect/reactivity";

import { liveShellEnvironmentIdsAtom } from "../state/shell";
import { readProject } from "../state/entities";
import { environmentThreadShells } from "../state/threads";
import { useUiStateStore } from "../uiStateStore";
import { selectDockAttention } from "./DockAttention.logic";

/** Keeps the macOS Dock icon's menu listing the threads that need the user. */
export function startDockAttention(registry: AtomRegistry.AtomRegistry): () => void {
  const setDockAttention = window.desktopBridge?.setDockAttention;
  if (!setDockAttention) return () => undefined;
  let sent: string | null = null;

  const update = () => {
    const items = selectDockAttention({
      threads: registry.get(environmentThreadShells.quietThreadShellsAtom),
      localLastVisitedAtById: useUiStateStore.getState().threadLastVisitedAtById,
      liveEnvironmentIds: registry.get(liveShellEnvironmentIdsAtom),
      projectName: (thread) =>
        readProject(scopeProjectRef(thread.environmentId, thread.projectId))?.title,
      now: new Date().toISOString(),
    });
    const serialized = JSON.stringify(items);
    if (serialized === sent) return;
    sent = serialized;
    void setDockAttention(items).catch(() => {
      sent = null;
    });
  };

  const unsubscribes = [
    registry.subscribe(environmentThreadShells.quietThreadShellsAtom, update),
    registry.subscribe(liveShellEnvironmentIdsAtom, update),
    // The store also changes on folder toggles and project reordering.
    useUiStateStore.subscribe((state, previous) => {
      if (state.threadLastVisitedAtById !== previous.threadLastVisitedAtById) update();
    }),
  ];
  update();
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
