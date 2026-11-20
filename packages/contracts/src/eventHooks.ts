import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const EventHookEvent = Schema.Literals([
  "turn.started",
  "turn.completed",
  "turn.failed",
  "approval.requested",
  "input.requested",
]);
export type EventHookEvent = typeof EventHookEvent.Type;

const EventHookCommand = Schema.String.check(Schema.isMaxLength(4000));

export const EventHook = Schema.Struct({
  id: TrimmedNonEmptyString,
  event: EventHookEvent,
  command: EventHookCommand,
  enabled: Schema.Boolean,
});
export type EventHook = typeof EventHook.Type;

export const EventHookTestInput = Schema.Struct({
  hookId: Schema.optionalKey(TrimmedNonEmptyString),
  event: EventHookEvent,
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
});
export type EventHookTestInput = typeof EventHookTestInput.Type;

export const EventHookRunOutcome = Schema.Union([
  Schema.TaggedStruct("Exited", { code: Schema.NullOr(Schema.Number) }),
  Schema.TaggedStruct("TimedOut", {}),
  Schema.TaggedStruct("SpawnFailed", { message: Schema.String }),
]);
export type EventHookRunOutcome = typeof EventHookRunOutcome.Type;

export const EventHookRun = Schema.Struct({
  hookId: Schema.NullOr(TrimmedNonEmptyString),
  event: EventHookEvent,
  test: Schema.Boolean,
  startedAt: IsoDateTime,
  durationMs: Schema.Number,
  outcome: EventHookRunOutcome,
  stdoutTail: Schema.String,
  stderrTail: Schema.String,
});
export type EventHookRun = typeof EventHookRun.Type;

export const EventHookRunsResult = Schema.Struct({ runs: Schema.Array(EventHookRun) });
export type EventHookRunsResult = typeof EventHookRunsResult.Type;
