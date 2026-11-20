import type { EventHookRun } from "@t3tools/contracts";

import { formatRelativeTimeLabel } from "../../timestampFormat";

const formatDuration = (ms: number) => (ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`);

/** `nowMinute` is `useNowMinute()`: UTC truncated to the minute, without a zone suffix. */
export function eventHookRunStatus(run: EventHookRun, nowMinute: string) {
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const { outcome } = run;
  const result =
    outcome._tag === "TimedOut"
      ? "Timed out after 30 s"
      : outcome._tag === "SpawnFailed"
        ? "Failed to start"
        : `${outcome.code === null ? "Killed" : `exit ${outcome.code}`} · ${formatDuration(run.durationMs)}`;
  const parts = [run.test ? "Test" : null, result, formatRelativeTimeLabel(run.startedAt, nowMs)];
  return {
    label: parts.filter(Boolean).join(" · "),
    dot: outcome._tag === "Exited" && outcome.code === 0 ? "bg-success" : "bg-destructive",
  };
}
