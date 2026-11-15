import {
  DEFAULT_CLIENT_SETTINGS,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as browserDefaults from "~/browser/browserDefaults";
import {
  BrowserSettingsReadError,
  openFileInPreview,
  openFileInSystemBrowser,
  openUrlInPreview,
} from "~/browser/openFileInPreview";
import * as previewRuntime from "~/browser/previewRuntime";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import {
  hostRightPanel,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "~/rightPanelStore";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
  setActivePreviewTab,
} from "~/previewStateStore";

import { openPreviewSession } from "./openPreviewSession";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-1",
  navStatus: {
    _tag: "Loading",
    url: "https://t3.chat/",
    title: "",
  },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-06-11T23:00:00.000Z",
};

beforeEach(() => {
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openPreviewSession", () => {
  it.each(["session", "link"] as const)(
    "does not open a %s with unread settings and uses the saved profile on retry",
    async (entryPoint) => {
      const failure = new Error("Settings read failed");
      vi.spyOn(browserDefaults, "resolveBrowserDefaults").mockRejectedValueOnce(failure);
      const viewport = { _tag: "freeform", width: 1280, height: 720 } as const;
      __setClientSettingsForTests({
        ...DEFAULT_CLIENT_SETTINGS,
        browserDefaultViewport: viewport,
        browserDefaultProfileId: "work",
        browserProfiles: [{ id: "work", name: "Work", kind: "persistent" }],
      });
      const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
      const input = { openPreview, threadRef, url: "https://t3.chat/" };
      const open = entryPoint === "session" ? openPreviewSession : openUrlInPreview;

      const result = await open(input);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(Cause.squash(result.cause)).toBeInstanceOf(BrowserSettingsReadError);
        expect(Cause.squash(result.cause)).toMatchObject({ cause: failure });
      }
      expect(openPreview).not.toHaveBeenCalled();
      expect(readThreadPreviewState(threadRef).snapshot).toBeNull();
      expect(readThreadPreviewState(threadRef).recentlySeenUrls).toEqual([]);

      await expect(open(input)).resolves.toMatchObject({ _tag: "Success" });
      expect(openPreview).toHaveBeenCalledExactlyOnceWith({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          url: input.url,
          viewport,
          profileId: "work",
        },
      });
    },
  );
});

describe("openUrlInPreview from a link", () => {
  it.each(["link", "file"] as const)(
    "opens a side chat's %s in the parent's browser panel after the pane unmounts",
    async (entryPoint) => {
      const sideChatRef = { ...threadRef, threadId: "side-chat" as ScopedThreadRef["threadId"] };
      const unhost = hostRightPanel(sideChatRef, threadRef);
      const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
      vi.spyOn(previewRuntime, "isPreviewAvailableFor").mockReturnValue(true);
      vi.spyOn(browserDefaults, "resolveBrowserDefaults").mockImplementation(async () => {
        unhost();
        return browserDefaults.getBrowserDefaults();
      });

      if (entryPoint === "link") {
        await openUrlInPreview({ openPreview, threadRef: sideChatRef, url: "https://t3.chat/" });
      } else {
        await openFileInPreview({
          threadRef: sideChatRef,
          filePath: "/repo/index.html",
          workspaceRoot: "/repo",
          httpBaseUrl: "http://localhost:3000",
          createAssetUrl: async () => {
            unhost();
            return AsyncResult.success({ relativeUrl: "/assets/index.html", expiresAt: 0 });
          },
          openPreview,
        });
      }

      expect(openPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ threadId: threadRef.threadId }),
        }),
      );
      expect(readThreadPreviewState(threadRef).activeTabId).toBe(snapshot.tabId);
      expect(readThreadPreviewState(sideChatRef).sessions).toEqual({});
      expect(
        selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef)?.kind,
      ).toBe("preview");
    },
  );

  it("opens a file in the system browser through its asset URL, not file://", async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);

    const result = await openFileInSystemBrowser({
      threadRef,
      filePath: "/repo/picks.html",
      workspaceRoot: "/repo",
      httpBaseUrl: "http://localhost:3000",
      createAssetUrl: async () =>
        AsyncResult.success({ relativeUrl: "/assets/picks.html?sig=1", expiresAt: 0 }),
      openExternal,
    });

    expect(result._tag).toBe("Success");
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:3000/assets/picks.html?sig=1",
    );
  });

  // regression: #16961 a background link open switched the active preview tab
  it("keeps the current tab active for a background open", async () => {
    applyPreviewServerSnapshot(threadRef, { ...snapshot, tabId: "tab-current" });

    await openUrlInPreview({
      openPreview: async () => AsyncResult.success(snapshot),
      threadRef,
      url: "https://t3.chat/",
      background: true,
    });

    const state = readThreadPreviewState(threadRef);
    expect(state.activeTabId).toBe("tab-current");
    expect(Object.keys(state.sessions).toSorted()).toEqual(["tab-1", "tab-current"]);
  });

  it("keeps a tab the user picked while a background open was in flight", async () => {
    applyPreviewServerSnapshot(threadRef, { ...snapshot, tabId: "tab-current" });
    applyPreviewServerSnapshot(threadRef, { ...snapshot, tabId: "tab-other" });
    setActivePreviewTab(threadRef, "tab-current");

    await openUrlInPreview({
      openPreview: async () => {
        applyPreviewServerSnapshot(threadRef, snapshot);
        setActivePreviewTab(threadRef, "tab-other");
        return AsyncResult.success(snapshot);
      },
      threadRef,
      url: "https://t3.chat/",
      background: true,
    });

    expect(readThreadPreviewState(threadRef).activeTabId).toBe("tab-other");
  });
});
