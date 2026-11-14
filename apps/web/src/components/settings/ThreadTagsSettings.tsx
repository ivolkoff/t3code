import { useAtomValue } from "@effect/atom-react";
import {
  presetThreadTag,
  resolveThreadTagStyles,
  swapThreadTagStyles,
  withPresetThreadTags,
} from "@t3tools/client-runtime/state/threadTagStyles";
import {
  AuthSettingsWriteScope,
  THREAD_TAG_COLORS,
  threadTagKey,
  type EnvironmentId,
  type ThreadTagColor,
  type ThreadTagStyle,
} from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useServerConfigs } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { serverEnvironment } from "../../state/server";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import { checkTagRename } from "./ThreadTagsSettings.logic";
import { threadTagColorStyle } from "../ThreadTagChips";

type Pending = { readonly kind: "rename" | "delete"; readonly tag: string; readonly count: number };

const COLLAPSED_TAG_COUNT = 5;

const threadLabel = (count: number) => `${count} ${count === 1 ? "thread" : "threads"}`;

/** Rename and delete reach every thread on the environment, archived ones included. */
export function ThreadTagsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  const environmentId = environment?.environmentId ?? null;
  if (
    environmentId === null ||
    configs.get(environmentId)?.environment.capabilities.threadTags !== true
  ) {
    return null;
  }
  return <ThreadTagsList key={environmentId} environmentId={environmentId} />;
}

function ThreadTagsList({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(
    orchestrationEnvironment.threadTagUsage({ environmentId, input: {} }),
  );
  const renameTag = useAtomCommand(orchestrationEnvironment.renameThreadTag, {
    reportFailure: false,
  });
  const deleteTag = useAtomCommand(orchestrationEnvironment.deleteThreadTag, {
    reportFailure: false,
  });
  const canRename = useAtomValue(
    orchestrationEnvironment.renameThreadTag.permissionAtom(environmentId),
  );
  const canDelete = useAtomValue(
    orchestrationEnvironment.deleteThreadTag.permissionAtom(environmentId),
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const hiddenTags = useAtomValue(serverEnvironment.hiddenThreadTagsAtom(environmentId));
  const storedStyles = useAtomValue(serverEnvironment.threadTagStylesAtom(environmentId));
  const canStyle = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const saveSettings = useAtomCommand(serverEnvironment.updateSettings, "Could not save tag");
  const hiddenKeys = new Set((hiddenTags ?? []).map(threadTagKey));
  const counts = new Map((query.data ?? []).map((entry) => [threadTagKey(entry.tag), entry]));
  // Presets show before any thread carries them; every edit writes the whole ordered list.
  const styles = resolveThreadTagStyles(
    withPresetThreadTags((query.data ?? []).map((entry) => entry.tag)),
    storedStyles,
  );
  const tags = styles
    .filter((style) => !hiddenKeys.has(threadTagKey(style.tag)))
    .map((style) => ({
      ...style,
      threadCount: counts.get(threadTagKey(style.tag))?.threadCount ?? 0,
    }));
  const saveStyles = (next: ReadonlyArray<ThreadTagStyle>) =>
    void saveSettings({ environmentId, input: { patch: { threadTagStyles: next } } });
  const move = (index: number, offset: -1 | 1) => {
    const neighbour = tags[index + offset];
    const from = tags[index];
    if (neighbour === undefined || from === undefined) return;
    const indexOf = (tag: string) => styles.findIndex((style) => style.tag === tag);
    saveStyles(swapThreadTagStyles(styles, indexOf(from.tag), indexOf(neighbour.tag)));
  };
  const recolor = (tag: string, color: ThreadTagColor) =>
    saveStyles(styles.map((style) => (style.tag === tag ? { ...style, color } : style)));
  const hiddenCount = Math.max(0, tags.length - COLLAPSED_TAG_COUNT);
  const shownTags = showAll ? tags : tags.slice(0, COLLAPSED_TAG_COUNT);
  // Hidden tags still count: renaming onto one merges, and the dialog should say so.
  const names = (query.data ?? []).map((entry) => entry.tag);
  const rename = pending?.kind === "rename" ? checkTagRename(pending.tag, draft, names) : null;

  const submit = async () => {
    if (pending === null || busy) return;
    if (pending.kind === "rename" && rename?.kind !== "ok") return;
    setBusy(true);
    const result =
      pending.kind === "rename" && rename?.kind === "ok"
        ? await renameTag({ environmentId, input: { tag: pending.tag, to: rename.to } })
        : await deleteTag({ environmentId, input: { tag: pending.tag } });
    setBusy(false);
    setPending(null);
    query.refresh();
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: pending.kind === "rename" ? "Could not rename tag" : "Could not delete tag",
        description: formatEnvironmentQueryError(result.cause),
      });
    }
  };

  return (
    <SettingsSection {...searchableSetting("thread-tags")}>
      {query.error !== null && query.data === null ? (
        <SettingsRow
          title="Could not load tags"
          description={query.error}
          control={
            <Button size="xs" variant="outline" onClick={query.refresh}>
              Retry
            </Button>
          }
        />
      ) : query.data === null ? (
        <SettingsRow title="Loading tags…" />
      ) : tags.length === 0 ? (
        <SettingsRow title="No tags yet." />
      ) : (
        shownTags.map((entry, index) => (
          <SettingsRow
            key={entry.tag}
            title={entry.tag}
            description={[threadLabel(entry.threadCount), presetThreadTag(entry.tag)?.description]
              .filter(Boolean)
              .join(" · ")}
            control={
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <Select
                  value={entry.color}
                  disabled={!canStyle}
                  onValueChange={(color) => {
                    if (color !== null) recolor(entry.tag, color);
                  }}
                >
                  <SelectTrigger aria-label={`Color of “${entry.tag}”`} size="xs" className="w-28">
                    <SelectValue>
                      <TagColorSwatch color={entry.color} />
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {THREAD_TAG_COLORS.map((color) => (
                      <SelectItem key={color} value={color}>
                        <TagColorSwatch color={color} />
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label={`Move “${entry.tag}” up`}
                  disabled={!canStyle || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon aria-hidden />
                </Button>
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label={`Move “${entry.tag}” down`}
                  disabled={!canStyle || index === tags.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon aria-hidden />
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canRename || entry.threadCount === 0}
                  onClick={() => {
                    setDraft(entry.tag);
                    setPending({ kind: "rename", tag: entry.tag, count: entry.threadCount });
                  }}
                >
                  Rename
                </Button>
                {/* Presets always come back, so deleting one would only strip it from threads. */}
                {presetThreadTag(entry.tag) === undefined ? (
                  <Button
                    size="xs"
                    variant="destructive-outline"
                    disabled={!canDelete || entry.threadCount === 0}
                    onClick={() =>
                      setPending({ kind: "delete", tag: entry.tag, count: entry.threadCount })
                    }
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            }
          />
        ))
      )}
      {hiddenCount > 0 ? (
        <div className="flex px-3 py-2 sm:px-4">
          <Button variant="ghost-muted" size="xs" onClick={() => setShowAll((open) => !open)}>
            {showAll ? "Show less" : `Show ${hiddenCount} more`}
            <ChevronDownIcon
              aria-hidden
              className={cn("transition-transform", showAll && "rotate-180")}
            />
          </Button>
        </div>
      ) : null}

      <Dialog open={pending?.kind === "rename"} onOpenChange={(open) => !open && setPending(null)}>
        <DialogPopup>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename “{pending?.tag}”</DialogTitle>
              <DialogDescription>
                Changes {threadLabel(pending?.count ?? 0)}, archived ones included.
                {rename?.kind === "ok" && rename.merges
                  ? ` “${rename.to}” already exists, so the two tags merge.`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <Input
                aria-label="New tag name"
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
              />
              {rename?.kind === "error" ? (
                <p className="mt-2 text-sm text-destructive-foreground">{rename.message}</p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || rename?.kind !== "ok"}>
                {rename?.kind === "ok" && rename.merges ? "Merge" : "Rename"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={pending?.kind === "delete"}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pending?.tag}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove “{pending?.tag}” from {threadLabel(pending?.count ?? 0)}, archived ones
              included? This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}

function TagColorSwatch({ color }: { readonly color: ThreadTagColor }) {
  return (
    <Badge variant="custom" style={threadTagColorStyle(color)}>
      {color}
    </Badge>
  );
}
