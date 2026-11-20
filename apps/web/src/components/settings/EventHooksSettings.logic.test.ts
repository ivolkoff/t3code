import type { EventHookRun } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { eventHookRunStatus } from "./EventHooksSettings.logic";

const run = (overrides: Partial<EventHookRun>): EventHookRun => ({
  hookId: "h1",
  event: "turn.completed",
  test: false,
  startedAt: "2026-11-18T10:00:00.000Z",
  durationMs: 120,
  outcome: { _tag: "Exited", code: 0 },
  stdoutTail: "",
  stderrTail: "",
  ...overrides,
});
// `useNowMinute` shape: UTC, truncated to the minute, no zone suffix.
const NOW_MINUTE = "2026-11-18T10:02";

describe("eventHookRunStatus", () => {
  it.each([
    [run({}), "exit 0 · 120 ms · 2m ago", "bg-success"],
    [
      run({ outcome: { _tag: "Exited", code: 3 }, durationMs: 1500 }),
      "exit 3 · 1.5 s · 2m ago",
      "bg-destructive",
    ],
    [
      run({ outcome: { _tag: "Exited", code: null } }),
      "Killed · 120 ms · 2m ago",
      "bg-destructive",
    ],
    [
      run({ outcome: { _tag: "TimedOut" }, test: true }),
      "Test · Timed out after 30 s · 2m ago",
      "bg-destructive",
    ],
    [
      run({ outcome: { _tag: "SpawnFailed", message: "nope" } }),
      "Failed to start · 2m ago",
      "bg-destructive",
    ],
  ])("%#", (value, label, dot) => {
    expect(eventHookRunStatus(value, NOW_MINUTE)).toEqual({ label, dot });
  });
});
