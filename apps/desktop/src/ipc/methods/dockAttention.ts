import { DesktopDockAttentionItems, type DesktopDockAttentionItem } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { promptLinkDeepLink } from "@t3tools/shared/promptLinks";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Electron from "electron";
import { msg } from "gt-i18n";

import * as DesktopWebLinks from "../../app/DesktopWebLinks.ts";
import { m, onLocaleChange } from "../../i18n/messages.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import { SET_DOCK_ATTENTION_CHANNEL } from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const GROUPS = [
  ["attention", msg("Needs you", { $context: "Dock menu group of threads waiting for the user" })],
  ["done", msg("Done", { $context: "Dock menu group of finished threads" })],
] as const;

export const installDockAttention = Effect.fn("desktop.ipc.installDockAttention")(function* () {
  if ((yield* HostProcess.Platform) !== "darwin") return;
  const ipc = yield* DesktopIpc.DesktopIpc;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
  const context = yield* Effect.context<never>();
  const runSync = Effect.runSyncWith(context);
  const runFork = Effect.runForkWith(context);
  let ownerId: number | null = null;
  let shownItems: ReadonlyArray<DesktopDockAttentionItem> = [];

  const setMenu = (template: Electron.MenuItemConstructorOptions[]) => {
    try {
      Electron.app.dock?.setMenu(Electron.Menu.buildFromTemplate(template));
    } catch (error) {
      runSync(Effect.logWarning("Could not update the Dock menu", error));
    }
  };
  // Without the window nobody tracks threads, so an empty menu, not "No threads need you".
  const clear = () => {
    ownerId = null;
    shownItems = [];
    setMenu([]);
  };
  const show = (items: ReadonlyArray<DesktopDockAttentionItem>) => {
    shownItems = items;
    setMenu(
      items.length === 0
        ? [{ label: m(msg("No threads need you")), enabled: false }]
        : GROUPS.flatMap(([group, title]) => {
            const inGroup = items.filter((item) => item.group === group);
            if (inGroup.length === 0) return [];
            return [
              { label: m(title), enabled: false },
              ...inGroup.map((item) => ({ label: item.label, click: () => open(item) })),
            ];
          }),
    );
  };
  const open = (item: DesktopDockAttentionItem) =>
    runFork(
      desktopWindow.activate.pipe(
        Effect.ignore,
        Effect.andThen(
          webLinks.receive(
            promptLinkDeepLink(
              `/${encodeURIComponent(item.environmentId)}/${encodeURIComponent(item.threadId)}`,
            ),
          ),
        ),
      ),
    );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_DOCK_ATTENTION_CHANNEL,
      payload: DesktopDockAttentionItems,
      result: Schema.Void,
      handler: (items, event) =>
        Effect.sync(() => {
          if (event && event.sender.id !== ownerId) {
            const senderId = event.sender.id;
            ownerId = senderId;
            Electron.webContents.fromId(senderId)?.once("destroyed", () => {
              if (ownerId === senderId) clear();
            });
          }
          show(items);
        }),
    }),
  );
  const stopLocaleChange = onLocaleChange(() => {
    if (ownerId !== null) show(shownItems);
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      stopLocaleChange();
      clear();
    }),
  );
});
