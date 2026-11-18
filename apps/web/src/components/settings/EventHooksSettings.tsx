import { useAtomValue } from "@effect/atom-react";
import { type EventHook, EventHookEvent, type EventHookRun } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { eventHookRunStatus } from "./EventHooksSettings.logic";
import { ExpandableText } from "./ExpandableText";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { SettingsSection } from "./settingsLayout";
import { useScopedSettings } from "./useScopedSettings";

const EVENT_LABELS: Record<EventHookEvent, string> = {
  "turn.started": msg("Turn started"),
  "turn.completed": msg("Turn completed"),
  "turn.failed": msg("Turn failed"),
  "approval.requested": msg("Approval requested"),
  "input.requested": msg("Input requested"),
};
const isEventHookEvent = Schema.is(EventHookEvent);
const MAX_HOOKS = 50;

export function EventHooksSettings() {
  const gt = useGT();
  const { environment, scope } = useSettingsScope();
  if (scope.kind !== "environment" || !environment) {
    return (
      <SettingsSection title={gt("Event hooks")} id="event-hooks">
        <SettingsScopeNotice target="environment">
          {gt("Choose one environment to configure its event hooks.")}
        </SettingsScopeNotice>
      </SettingsSection>
    );
  }
  if (environment.serverConfig?.environment.capabilities.eventHooks !== true) return null;
  return <EventHooksForm key={environment.environmentId} />;
}

function EventHooksForm() {
  const gt = useGT();
  const messages = useMessages();
  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const saved = useScopedSettings((settings) => settings.eventHooks);
  const [draft, setDraft] = useState<ReadonlyArray<EventHook> | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<ReadonlySet<string>>(new Set());
  const [runs, setRuns] = useState<ReadonlyMap<string, EventHookRun>>(new Map());
  const nowMinute = useNowMinute();
  const canEdit = useAtomValue(serverEnvironment.testEventHook.permissionAtom(environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: true });
  const testEventHook = useAtomCommand(serverEnvironment.testEventHook, { reportFailure: true });
  const getEventHookRuns = useAtomCommand(serverEnvironment.getEventHookRuns);
  const hooks = draft ?? saved;

  const loadRuns = useEffectEvent(async () => {
    if (!environmentId) return;
    const response = await getEventHookRuns({ environmentId, input: {} });
    if (response._tag !== "Success") return;
    setRuns(
      new Map(
        response.value.runs.flatMap((run) => (run.hookId === null ? [] : [[run.hookId, run]])),
      ),
    );
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the server's last hook runs when the section opens; the server does not push them
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- State changes only after the response arrives.
    if (canEdit) void loadRuns();
  }, [canEdit]);

  const update = (id: string, patch: Partial<EventHook>) =>
    setDraft(hooks.map((hook) => (hook.id === id ? { ...hook, ...patch } : hook)));

  const runTest = async (hook: EventHook) => {
    if (!environmentId) return;
    setTesting((previous) => new Set(previous).add(hook.id));
    await testEventHook({
      environmentId,
      input: { hookId: hook.id, event: hook.event, command: hook.command.trim() },
    });
    setTesting((previous) => {
      const next = new Set(previous);
      next.delete(hook.id);
      return next;
    });
    await loadRuns();
  };

  return (
    <SettingsSection title={gt("Event hooks")} id="event-hooks">
      <form
        className="grid gap-4 px-4 py-4 sm:px-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!environmentId || draft === null || saving) return;
          setSaving(true);
          const result = await updateSettings({
            environmentId,
            input: {
              patch: {
                eventHooks: draft
                  .filter((hook) => hook.command.trim() !== "")
                  .map((hook) => ({ ...hook, command: hook.command.trim() })),
              },
            },
          });
          setSaving(false);
          if (result._tag === "Success") setDraft(null);
        }}
      >
        <p className="text-xs text-muted-foreground">
          {environment ? (
            <T>
              Run a shell command on <Var>{environment.label}</Var> when a thread starts, finishes,
              fails, or needs approval or input. The event arrives as JSON on stdin and{" "}
              <code className="font-mono">T3_*</code> variables.
            </T>
          ) : (
            <T>
              Run a shell command on this environment when a thread starts, finishes, fails, or
              needs approval or input. The event arrives as JSON on stdin and{" "}
              <code className="font-mono">T3_*</code> variables.
            </T>
          )}
        </p>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            {environment
              ? gt("This connection lacks permission to change settings on {environment}.", {
                  environment: environment.label,
                })
              : gt(
                  "This connection lacks permission to change settings on the selected environment.",
                )}
          </p>
        )}
        {hooks.map((hook, index) => {
          const run = runs.get(hook.id);
          const status = run ? eventHookRunStatus(run, nowMinute, messages) : null;
          const output = !run
            ? ""
            : run.outcome._tag === "SpawnFailed"
              ? run.outcome.message
              : [run.stderrTail, run.stdoutTail].filter(Boolean).join("\n");
          return (
            <div key={hook.id} className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={hook.event}
                  disabled={!canEdit || saving}
                  onValueChange={(value) => {
                    if (isEventHookEvent(value)) update(hook.id, { event: value });
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-44"
                    aria-label={gt("Event for hook {number}", { number: index + 1 })}
                  >
                    <SelectValue>
                      {(value: EventHookEvent) => messages(EVENT_LABELS[value])}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {EventHookEvent.literals.map((event) => (
                      <SelectItem hideIndicator key={event} value={event}>
                        {messages(EVENT_LABELS[event])}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <div className="min-w-0 flex-1 basis-48">
                  <Input
                    size="sm"
                    font="mono"
                    // oxlint-disable-next-line t3code/no-untranslated-copy -- an example shell command
                    placeholder={'terminal-notifier -message "$T3_THREAD_TITLE"'}
                    aria-label={gt("Command for hook {number}", { number: index + 1 })}
                    value={hook.command}
                    maxLength={4000}
                    disabled={!canEdit || saving}
                    onChange={(event) => update(hook.id, { command: event.target.value })}
                  />
                </div>
                <Switch
                  checked={hook.enabled}
                  disabled={!canEdit || saving}
                  aria-label={gt("Enable hook {number}", { number: index + 1 })}
                  onCheckedChange={(checked) => update(hook.id, { enabled: Boolean(checked) })}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canEdit || testing.has(hook.id) || hook.command.trim() === ""}
                  onClick={() => void runTest(hook)}
                >
                  {testing.has(hook.id)
                    ? gt("Testing…")
                    : gt("Test", { $context: "verb, runs the hook once" })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={gt("Remove hook {number}", { number: index + 1 })}
                  disabled={!canEdit || saving}
                  onClick={() => setDraft(hooks.filter((entry) => entry.id !== hook.id))}
                >
                  <Trash2Icon />
                </Button>
              </div>
              {status && (
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ConnectionStatusDot dotClassName={status.dot} />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <span>{status.label}</span>
                    {output && (
                      <ExpandableText
                        text={output}
                        className="font-mono"
                        expandLabel={gt("Show output")}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!canEdit || saving || hooks.length >= MAX_HOOKS}
            onClick={() =>
              setDraft([
                ...hooks,
                { id: randomUUID(), event: "turn.completed", command: "", enabled: true },
              ])
            }
          >
            <PlusIcon />
            {gt("Add hook")}
          </Button>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={draft === null || saving}
              onClick={() => setDraft(null)}
            >
              {gt("Discard")}
            </Button>
            <Button type="submit" size="xs" disabled={draft === null || saving || !canEdit}>
              {saving ? gt("Saving…") : gt("Save")}
            </Button>
          </div>
        </div>
      </form>
    </SettingsSection>
  );
}
