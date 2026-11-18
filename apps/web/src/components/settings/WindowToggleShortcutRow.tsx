import { useAtomValue } from "@effect/atom-react";
import {
  isModifierPairShortcut,
  type DesktopSnapShotShortcutAvailability,
  type SnapShotKeyChord,
} from "@t3tools/contracts";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { getDesktopSnapShotBridge } from "../../lib/desktopSnapShot";
import { sameSnapShotShortcut, snapShotKeybindingConflict } from "../../lib/snapShotShortcut";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Button } from "../ui/button";
import { commandLabel } from "./KeybindingsSettings.logic";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSnapShotShortcutRecorder } from "./useSnapShotShortcutRecorder";

type ShortcutCheck =
  | { readonly status: "checking"; readonly shortcut: SnapShotKeyChord }
  | {
      readonly status: "checked";
      readonly shortcut: SnapShotKeyChord;
      readonly availability: DesktopSnapShotShortcutAvailability;
    };

function windowToggleShortcutSupported(): boolean {
  const platform = isElectron ? window.desktopBridge?.getClientPlatform() : undefined;
  return platform === "darwin" || platform === "win32";
}

export function WindowToggleShortcutRow() {
  if (!windowToggleShortcutSupported()) return null;
  return <WindowToggleShortcutSetting />;
}

function WindowToggleShortcutSetting() {
  const settings = useClientSettings((current) => ({
    saved: current.windowToggleShortcut,
    snapShotEnabled: current.snapShotEnabled,
    snapShotShortcut: current.snapShotShortcut,
  }));
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const bridge = getDesktopSnapShotBridge();
  const [candidate, setCandidate] = useState<SnapShotKeyChord | null>(null);
  const [check, setCheck] = useState<ShortcutCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const checkIdRef = useRef(0);

  const keybindingConflict = candidate ? snapShotKeybindingConflict(candidate, keybindings) : null;
  // The SnapShot probe reports its own shortcut as available, so this needs its own check.
  const snapShotConflict =
    candidate !== null &&
    settings.snapShotEnabled &&
    sameSnapShotShortcut(candidate, settings.snapShotShortcut);
  const currentCheck =
    candidate !== null && check !== null && sameSnapShotShortcut(check.shortcut, candidate)
      ? check
      : null;
  const canSave =
    !saving &&
    keybindingConflict === null &&
    !snapShotConflict &&
    currentCheck?.status === "checked" &&
    currentCheck.availability.available;

  const reset = () => {
    checkIdRef.current++;
    setCandidate(null);
    setCheck(null);
  };

  const checkShortcut = async (shortcut: SnapShotKeyChord) => {
    const checkId = ++checkIdRef.current;
    setCandidate(shortcut);
    setCheck(null);
    if (
      !bridge ||
      snapShotKeybindingConflict(shortcut, keybindings) !== null ||
      (settings.snapShotEnabled && sameSnapShotShortcut(shortcut, settings.snapShotShortcut))
    ) {
      return;
    }
    setCheck({ status: "checking", shortcut });
    const availability = await bridge
      .checkSnapShotShortcut(shortcut)
      .catch((cause: unknown): DesktopSnapShotShortcutAvailability => ({
        available: false,
        message: cause instanceof Error ? cause.message : "Could not check this shortcut.",
      }));
    if (checkId === checkIdRef.current) setCheck({ status: "checked", shortcut, availability });
  };

  const { recording, stopRecording, input } = useSnapShotShortcutRecorder({
    shortcut: candidate ?? settings.saved,
    disabled: saving,
    // Modifier pairs need SnapShot's native helper; Electron's global shortcuts can't hold them.
    allowModifierPairs: false,
    name: "show/hide shortcut",
    onStart: () => {
      checkIdRef.current++;
      setError(null);
    },
    onRecord: (shortcut) => {
      if (isModifierPairShortcut(shortcut)) return;
      // The saved shortcut is registered by this app, so probing it would report it taken.
      if (settings.saved !== null && sameSnapShotShortcut(shortcut, settings.saved)) reset();
      else void checkShortcut(shortcut);
    },
    onError: setError,
  });

  const save = async (windowToggleShortcut: SnapShotKeyChord | null) => {
    setSaving(true);
    const saved = await updateClientSettings({ windowToggleShortcut }).then(
      () => true,
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not save the shortcut.");
        return false;
      },
    );
    setSaving(false);
    if (saved) reset();
  };

  const status = recording
    ? "Press your shortcut. Esc cancels."
    : error
      ? error
      : keybindingConflict
        ? `T3 Code already uses this for "${commandLabel(keybindingConflict)}".`
        : snapShotConflict
          ? "SnapShots already use this shortcut."
          : currentCheck?.status === "checking"
            ? "Checking shortcut…"
            : currentCheck
              ? currentCheck.availability.available
                ? "Ready to save."
                : currentCheck.availability.message
              : undefined;

  return (
    <SettingsRow
      {...searchableSetting("window-toggle-shortcut")}
      description="Show or hide T3 Code from any app."
      status={status}
      control={
        <>
          {input}
          {candidate !== null ? (
            <>
              <Button size="xs" disabled={!canSave} onClick={() => void save(candidate)}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  stopRecording();
                  reset();
                }}
              >
                Cancel
              </Button>
            </>
          ) : settings.saved !== null ? (
            <Button size="xs" variant="ghost" disabled={saving} onClick={() => void save(null)}>
              Clear
            </Button>
          ) : null}
        </>
      }
    />
  );
}
