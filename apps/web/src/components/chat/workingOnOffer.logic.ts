import { isListedThreadLineage } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

export type WorkingOnOfferThread = Pick<
  EnvironmentThreadShell,
  | "workingOn"
  | "workingOnDoneAt"
  | "lineage"
  | "settledOverride"
  | "unsettledAt"
  | "latestRun"
  | "runtime"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingBackgroundTasks"
>;

/** "Task looks done": the thread's agent cleared its line during the run that just finished. */
export function shouldOfferSettle(
  thread: WorkingOnOfferThread,
  options: { readonly snoozed: boolean },
): boolean {
  const doneAt = Date.parse(thread.workingOnDoneAt ?? "");
  const latestRun = thread.latestRun;
  return (
    !Number.isNaN(doneAt) &&
    thread.workingOn == null &&
    isListedThreadLineage(thread.lineage) &&
    thread.settledOverride !== "settled" &&
    !options.snoozed &&
    latestRun?.status === "completed" &&
    (thread.runtime?.activeRunId ?? null) === null &&
    !thread.hasPendingApprovals &&
    !thread.hasPendingUserInput &&
    // Settling drops a thread's wake, so background work still owes it one.
    !backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks) &&
    // A queued run is requested before the previous one ends, so compare with its start.
    doneAt >= Date.parse(latestRun.startedAt ?? latestRun.requestedAt ?? "") &&
    (thread.unsettledAt === null || doneAt > Date.parse(thread.unsettledAt))
  );
}
