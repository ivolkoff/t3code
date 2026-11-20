import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";

/** Adds or removes one tag, with the same failure toast from every entry point. */
export function useSetThreadTag() {
  const setTag = useOrchestrationCommand(threadEnvironment.setTag, { reportFailure: false });
  return async (threadRef: ScopedThreadRef, tag: string, tagged: boolean) => {
    const result = await setTag({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, tag, tagged },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: tagged ? m(msg("Failed to add tag")) : m(msg("Failed to remove tag")),
          description: cause instanceof Error ? cause.message : m(msg("An error occurred.")),
        }),
      );
    }
  };
}
