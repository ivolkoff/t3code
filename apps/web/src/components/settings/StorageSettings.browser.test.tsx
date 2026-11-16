import { act, fakeTimers, render } from "../../../test/render";
import { page, userEvent } from "vite-plus/test/browser";
import { RegistryProvider } from "@effect/atom-react";
import { DEFAULT_SERVER_SETTINGS, type StorageCleanupReport } from "@t3tools/contracts";
import { type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: {} as typeof DEFAULT_SERVER_SETTINGS,
  targets: [] as Array<{ environmentId: string; settings: typeof DEFAULT_SERVER_SETTINGS }>,
  run: vi.fn(),
  update: vi.fn(),
  report: null as StorageCleanupReport | null,
}));

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const report = Atom.make(() => ({ _tag: "Success", value: state.report, waiting: false }));
  const allowed = Atom.make(true);
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      storageCleanupReport: (() => report) as never,
      runStorageCleanup: {
        ...actual.serverEnvironment.runStorageCleanup,
        permissionAtom: () => allowed,
      },
    },
  };
});
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.run) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => {
    const environments = state.targets.map(({ environmentId, settings }) => ({
      environmentId,
      label: environmentId,
      serverConfig: {
        settings,
        environment: {
          capabilities: {
            storageCleanup: true,
            storageCleanupRun: true,
            settledWorktreeCleanup: true,
            settledThreadCleanup: true,
          },
        },
      },
    }));
    return {
      scope: { kind: "all" },
      environments,
      connectedEnvironments: environments,
      targets: state.targets.map((target) => ({ ...target, label: target.environmentId })),
      target: null,
    };
  }) as never,
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings) as never,
  useScopedSettingsMixed: () => false,
  useUpdateScopedSettings: () => state.update,
  useClearScopedSettings: () => vi.fn(),
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsPageContainer: (({ children }: { children: ReactNode }) => children) as never,
  SettingsRow: ({ title, description, status, control, children }) => (
    <div>
      <h3>{title}</h3>
      {description}
      {status && (
        <div
          data-testid={`${title === "Delete old browser artifacts" ? "artifact" : "logs"}-retention-status`}
        >
          {status}
        </div>
      )}
      {control}
      {children}
    </div>
  ),
  SettingResetButton: (() => null) as never,
}));
vi.mock(import("../ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: vi.fn() } };
});

import { StorageCleanupSections } from "./StorageSettings";

function setup() {
  state.settings = {
    ...DEFAULT_SERVER_SETTINGS,
    storageCleanup: {
      worktreeKeepWhen: "uncommitted-changes",
      worktreeAfterDays: null,
      worktreeSettledAfterDays: null,
      worktreeOnMerge: false,
      worktreeOnDelete: false,
      worktreeUnchanged: false,
      browserArtifactsAfterDays: null,
      logsAfterDays: null,
      threadSettledAfterDays: null,
    },
    projectSettingsOverrides: {},
  };
  state.targets = ["env-a", "env-b"].map((environmentId) => ({
    environmentId,
    settings: state.settings,
  }));
  state.report = null;
  state.run.mockReset();
  state.update.mockReset();
}

function setRetentionValues(
  artifactDays: ReadonlyArray<number | null>,
  logDays: ReadonlyArray<number | null> = artifactDays.map(() => null),
  environmentIds: readonly string[] = ["env-a", "env-b"],
) {
  state.targets = artifactDays.map((browserArtifactsAfterDays, index) => ({
    environmentId: environmentIds[index]!,
    settings: {
      ...state.settings,
      storageCleanup: {
        ...state.settings.storageCleanup,
        browserArtifactsAfterDays,
        logsAfterDays: logDays[index]!,
      },
    },
  }));
  state.settings = state.targets[0]?.settings ?? state.settings;
}

const panel = () => (
  <RegistryProvider>
    <StorageCleanupSections />
  </RegistryProvider>
);
const deleteButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Delete now",
  )!;

it("keeps cleanup disabled when settled retention and all other rules are off", async () => {
  setup();
  {
    await using screen = await render(panel());
    const button = deleteButton(screen.container);

    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(state.run).not.toHaveBeenCalled();
  }

  state.settings = {
    ...state.settings,
    storageCleanup: { ...state.settings.storageCleanup, threadSettledAfterDays: 30 },
  };
  state.targets = state.targets.map(({ environmentId }) => ({
    environmentId,
    settings: state.settings,
  }));
  await using enabled = await render(panel());
  await vi.waitFor(() => expect(deleteButton(enabled.container).disabled).toBe(false));
});

// The backdrop covers the dialog's buttons for pointer clicks in the test page.
const pressDialogButton = (name: string) =>
  act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
      .find((button) => button.textContent === name)!
      .click();
  });

const pickRetention = async (name: string) => {
  await userEvent.click(page.getByRole("combobox", { name: "Delete settled threads" }));
  await userEvent.click(page.getByRole("option", { name }));
};

it("asks before enabling settled thread deletion", async () => {
  setup();
  await using _screen = await render(panel());

  await pickRetention("30 days");
  await expect.element(page.getByText(/more than 30 days/)).toBeVisible();
  expect(state.update).not.toHaveBeenCalled();
  await pressDialogButton("Cancel");
  expect(state.update).not.toHaveBeenCalled();

  await pickRetention("30 days");
  await pressDialogButton("Delete threads");
  expect(state.update).toHaveBeenCalledWith({ storageCleanup: { threadSettledAfterDays: 30 } });
});

it("writes only a committed number from Custom…", async () => {
  setup();
  await using _screen = await render(panel());

  await pickRetention("Custom…");
  expect(state.update).not.toHaveBeenCalled();
  const days = page.getByRole("textbox", { name: "Delete settled threads in days" });
  await userEvent.type(days, "1{Tab}");
  await expect.element(page.getByText(/more than 1 day on/)).toBeVisible();
  await pressDialogButton("Cancel");
  await expect.element(days).toHaveValue("");
  await userEvent.type(days, "45{Tab}");
  await expect.element(page.getByText(/more than 45 days/)).toBeVisible();
  await pressDialogButton("Delete threads");
  expect(state.update).toHaveBeenCalledWith({ storageCleanup: { threadSettledAfterDays: 45 } });
});

it("turns settled thread deletion off without asking", async () => {
  setup();
  state.settings = {
    ...state.settings,
    storageCleanup: { ...state.settings.storageCleanup, threadSettledAfterDays: 30 },
  };
  state.targets = state.targets.map(({ environmentId }) => ({
    environmentId,
    settings: state.settings,
  }));
  await using _screen = await render(panel());

  await pickRetention("Off");
  expect(state.update).toHaveBeenCalledWith({ storageCleanup: { threadSettledAfterDays: null } });
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("asks when another machine would start deleting", async () => {
  setup();
  const withDays = (threadSettledAfterDays: number | null) => ({
    ...state.settings,
    storageCleanup: { ...state.settings.storageCleanup, threadSettledAfterDays },
  });
  state.targets = [
    { environmentId: "env-a", settings: withDays(7) },
    { environmentId: "env-b", settings: withDays(null) },
  ];
  state.settings = state.targets[0]!.settings;
  await using _screen = await render(panel());

  await pickRetention("14 days");
  await expect.element(page.getByText(/on env-b/)).toBeVisible();
});

it("settles mixed retention statuses independently across selected machines", async () => {
  setup();
  using _timers = fakeTimers();
  await using screen = await render(panel());
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  await advance(300);
  setRetentionValues([8, null], [8, null]);
  await screen.rerender(panel());
  await advance(125);
  await expect.element(screen.getByTestId("artifact-retention-status")).not.toBeInTheDocument();
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();
  setRetentionValues([null, null], [8, null]);
  await screen.rerender(panel());
  await advance(8);
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();
  await advance(117);
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();
  setRetentionValues([null, null]);
  await screen.rerender(panel());
  await advance(300);
  await expect.element(screen.getByTestId("artifact-retention-status")).not.toBeInTheDocument();
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();

  setRetentionValues([8, null]);
  await screen.rerender(panel());
  await advance(300);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();

  setRetentionValues([null, null]);
  await screen.rerender(panel());
  await advance(75);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  setRetentionValues([8, null]);
  await screen.rerender(panel());
  await advance(133);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  setRetentionValues([null, null]);
  await screen.rerender(panel());
  await advance(133);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  await advance(117);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  setRetentionValues([8, null]);
  await screen.rerender(panel());
  await advance(300);
  await expect
    .element(screen.getByTestId("artifact-retention-status"))
    .toHaveTextContent("Mixed across selected machines");

  setRetentionValues([8], [null], ["env-c"]);
  await screen.rerender(panel());
  await expect.element(screen.getByTestId("artifact-retention-status")).not.toBeInTheDocument();

  setRetentionValues([null, null], [null, null], ["env-c", "env-d"]);
  await screen.rerender(panel());
  await expect.element(screen.getByTestId("artifact-retention-status")).not.toBeInTheDocument();

  setRetentionValues([null, null], [8, null]);
  await screen.rerender(panel());
  await advance(300);
  await expect.element(screen.getByTestId("artifact-retention-status")).not.toBeInTheDocument();
  await expect
    .element(screen.getByTestId("logs-retention-status"))
    .toHaveTextContent("Mixed across selected machines");
  setRetentionValues([null, null]);
  await screen.rerender(panel());
  await advance(300);
  await expect.element(screen.getByTestId("logs-retention-status")).not.toBeInTheDocument();
});
