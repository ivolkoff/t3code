import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import { toElectronAccelerator } from "../snapShot/snapShot.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

export class DesktopWindowToggleShortcut extends Context.Service<
  DesktopWindowToggleShortcut,
  {
    readonly initialize: Effect.Effect<void>;
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
    readonly setSuppressed: (suppressed: boolean) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopWindowToggleShortcut") {}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  // Linux shortcut checks go through SnapShot's capture modes, which X11 never passes.
  const supported = environment.platform === "darwin" || environment.platform === "win32";
  let registered: string | null = null;
  let suppressed = false;

  const toggle = () => {
    if (suppressed) return;
    const focused = Electron.BrowserWindow.getFocusedWindow();
    if (focused === null) {
      runFork(desktopWindow.activate.pipe(Effect.ignore));
    } else if (environment.platform === "darwin") {
      // Hiding the app, like ⌘H, hands focus back to the previous app.
      Electron.app.hide();
    } else {
      focused.minimize();
    }
  };

  const release = () => {
    if (registered === null) return;
    Electron.globalShortcut.unregister(registered);
    registered = null;
  };

  const configure = Effect.fn("DesktopWindowToggleShortcut.configure")(function* (
    settings: ClientSettings,
  ) {
    if (!supported) return;
    const accelerator =
      settings.windowToggleShortcut === null
        ? null
        : toElectronAccelerator(settings.windowToggleShortcut);
    if (accelerator === registered) return;
    release();
    if (accelerator === null) return;
    const ok = yield* Effect.try({
      try: () => Electron.globalShortcut.register(accelerator, toggle),
      catch: () => false,
    }).pipe(Effect.orElseSucceed(() => false));
    if (ok) registered = accelerator;
    else yield* Effect.logWarning("Could not register the show/hide shortcut", { accelerator });
  });

  yield* Effect.addFinalizer(() => Effect.sync(release));

  return DesktopWindowToggleShortcut.of({
    initialize: clientSettings.get.pipe(
      Effect.flatMap((stored) =>
        configure(Option.getOrElse(stored, () => DEFAULT_CLIENT_SETTINGS)),
      ),
      Effect.ignore,
    ),
    configure,
    setSuppressed: Effect.fn("DesktopWindowToggleShortcut.setSuppressed")((next: boolean) =>
      Effect.sync(() => {
        suppressed = next;
      }),
    ),
  });
});

export const layer = Layer.effect(DesktopWindowToggleShortcut, make);
