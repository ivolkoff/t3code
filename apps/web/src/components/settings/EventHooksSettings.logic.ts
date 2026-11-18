import type { EventHookRun } from "@t3tools/contracts";

import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import { formatRelativeTimeLabel } from "../../timestampFormat";

const formatDuration = (ms: number, resolve: MessageResolver) =>
  ms < 1_000
    ? resolve(msg("{ms} ms", { ms, $context: "milliseconds, abbreviated" }))
    : resolve(
        msg("{seconds} s", { seconds: (ms / 1_000).toFixed(1), $context: "seconds, abbreviated" }),
      );

/** `nowMinute` is `useNowMinute()`: UTC truncated to the minute, without a zone suffix. */
export function eventHookRunStatus(
  run: EventHookRun,
  nowMinute: string,
  resolve: MessageResolver = m,
) {
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const { outcome } = run;
  const result =
    outcome._tag === "TimedOut"
      ? resolve(msg("Timed out after 30 s"))
      : outcome._tag === "SpawnFailed"
        ? resolve(msg("Failed to start", { $context: "a hook command did not start" }))
        : `${outcome.code === null ? resolve(msg("Killed", { $context: "process was killed" })) : resolve(msg("exit {code}", { code: outcome.code, $context: "process exit code" }))} · ${formatDuration(run.durationMs, resolve)}`;
  const parts = [
    run.test ? resolve(msg("Test", { $context: "a test run of a hook" })) : null,
    result,
    formatRelativeTimeLabel(run.startedAt, nowMs, resolve),
  ];
  return {
    label: parts.filter(Boolean).join(" · "),
    dot: outcome._tag === "Exited" && outcome.code === 0 ? "bg-success" : "bg-destructive",
  };
}
