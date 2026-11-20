import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { MenuAction } from "@react-native-menu/menu";
import {
  AuthSettingsWriteScope,
  THREAD_TAG_COLORS,
  threadTagKey,
  type EnvironmentId,
  type ThreadTagColor,
  type ThreadTagStyle,
} from "@t3tools/contracts";
import { validateThreadTag } from "@t3tools/client-runtime/state/threadTagFilter";
import {
  presetThreadTag,
  resolveThreadTagStyles,
  swapThreadTagStyles,
  threadTagColorLabel,
  THREAD_TAG_PALETTE,
  withPresetThreadTags,
} from "@t3tools/client-runtime/state/threadTagStyles";
import { AsyncResult } from "effect/reactivity";
import { useGT, useMessages } from "gt-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { Menu } from "../../components/ui/Menu";
import { ListRow } from "../../components/ui/ListRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { failureMessage } from "../../lib/failureMessage";
import { orchestrationEnvironment } from "../../state/orchestration";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAppearancePreferences } from "./appearance/AppearancePreferencesProvider";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";

export function SettingsTagsRouteScreen() {
  const gt = useGT();
  const environmentMenu = useSettingsEnvironmentMenu();
  const insets = useSafeAreaInsets();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const targets = selectedTargets.filter(
    (target) => target.serverConfig.environment.capabilities.threadTags === true,
  );

  return (
    <SettingsScreen title={gt("Tags")} menus={[environmentMenu]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {targets.length === 0 ? (
          <EmptyState
            variant="plain"
            title={gt("Tags unavailable")}
            detail={
              selectedTargets.length === 0
                ? gt("Connect to a server to rename or delete tags.")
                : gt("Update the connected server to rename or delete tags.")
            }
          />
        ) : (
          targets.map((target) => (
            <EnvironmentTags
              key={target.environmentId}
              environmentId={target.environmentId}
              title={targets.length > 1 ? target.label : undefined}
            />
          ))
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function EnvironmentTags(props: {
  readonly environmentId: EnvironmentId;
  readonly title: string | undefined;
}) {
  const { environmentId } = props;
  const gt = useGT();
  const messages = useMessages();
  const pluralThreads = (count: number) =>
    gt("{count, plural, one {{count} thread} other {{count} threads}}", { count });
  const usageAtom = orchestrationEnvironment.threadTagUsage({ environmentId, input: {} });
  const usage = useAtomValue(usageAtom);
  const refresh = useAtomRefresh(usageAtom);
  const canRename = useAtomValue(
    orchestrationEnvironment.renameThreadTag.permissionAtom(environmentId),
  );
  const canDelete = useAtomValue(
    orchestrationEnvironment.deleteThreadTag.permissionAtom(environmentId),
  );
  const canManage = canRename && canDelete;
  const renameTag = useAtomCommand(orchestrationEnvironment.renameThreadTag, {
    reportFailure: false,
  });
  const deleteTag = useAtomCommand(orchestrationEnvironment.deleteThreadTag, {
    reportFailure: false,
  });

  const tags = AsyncResult.isSuccess(usage) ? usage.value : [];
  const storedStyles = useAtomValue(serverEnvironment.threadTagStylesAtom(environmentId));
  const hiddenTags = useAtomValue(serverEnvironment.hiddenThreadTagsAtom(environmentId));
  const canStyle = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const saveSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "tag style update",
    reportFailure: true,
  });
  const { themeAppearance } = useAppearancePreferences();
  const hiddenKeys = new Set((hiddenTags ?? []).map(threadTagKey));
  const counts = new Map(tags.map((entry) => [threadTagKey(entry.tag), entry.threadCount]));
  // Presets show before any thread carries them; every edit writes the whole ordered list.
  const styles = resolveThreadTagStyles(
    withPresetThreadTags(tags.map((entry) => entry.tag)),
    storedStyles,
  );
  const rows = styles.filter((style) => !hiddenKeys.has(threadTagKey(style.tag)));
  const saveStyles = (next: ReadonlyArray<ThreadTagStyle>) =>
    void saveSettings({ environmentId, input: { patch: { threadTagStyles: next } } });
  const move = (index: number, offset: -1 | 1) => {
    const from = rows[index];
    const to = rows[index + offset];
    if (from === undefined || to === undefined) return;
    saveStyles(swapThreadTagStyles(styles, styles.indexOf(from), styles.indexOf(to)));
  };
  const recolor = (tag: string, color: ThreadTagColor) =>
    saveStyles(styles.map((style) => (style.tag === tag ? { ...style, color } : style)));

  const run = async (
    title: string,
    result: ReturnType<typeof renameTag> | ReturnType<typeof deleteTag>,
  ) => {
    const outcome = await result;
    if (outcome._tag === "Failure")
      Dialog.alert(title, failureMessage(outcome.cause, gt("The tag could not be changed.")));
    refresh();
  };

  const rename = (tag: string, to: string) => {
    const validated = validateThreadTag(to, [], messages);
    if (validated.kind === "empty") return;
    if (validated.kind === "error") {
      Dialog.alert(gt("Could not rename tag"), validated.message);
      return;
    }
    if (validated.tag === tag) return;
    const target = validated.tag;
    const lower = target.toLowerCase();
    const merges = tags.some((entry) => entry.tag !== tag && entry.tag.toLowerCase() === lower);
    const submit = () =>
      void run(
        gt("Could not rename tag"),
        renameTag({ environmentId, input: { tag, to: target } }),
      );
    if (!merges) return submit();
    Dialog.confirm({
      title: gt('Merge into "{target}"?', { target }),
      message: gt('"{target}" already exists. Threads tagged "{tag}" move to it.', { target, tag }),
      confirmText: gt("Merge"),
      onConfirm: submit,
    });
  };

  const remove = (tag: string, threadCount: number) =>
    Dialog.confirm({
      title: gt('Remove "{tag}"?', { tag }),
      message: gt(
        'Remove "{tag}" from {count, plural, one {{count} thread} other {{count} threads}}? This can\'t be undone.',
        { tag, count: threadCount },
      ),
      confirmText: gt("Remove"),
      destructive: true,
      onConfirm: () =>
        void run(gt("Could not delete tag"), deleteTag({ environmentId, input: { tag } })),
    });

  const rowActions = (style: ThreadTagStyle, index: number, threadCount: number): MenuAction[] => [
    {
      id: "color",
      title: gt("Color"),
      image: "paintpalette",
      attributes: { disabled: !canStyle },
      subactions: THREAD_TAG_COLORS.map((color) => ({
        id: `color:${color}`,
        title: threadTagColorLabel(color, messages),
        state: color === style.color ? "on" : "off",
      })),
    },
    {
      id: "move-up",
      title: gt("Move up"),
      image: "arrow.up",
      attributes: { disabled: !canStyle || index === 0 },
    },
    {
      id: "move-down",
      title: gt("Move down"),
      image: "arrow.down",
      attributes: { disabled: !canStyle || index === rows.length - 1 },
    },
    ...(threadCount > 0 && canManage
      ? [
          { id: "rename", title: gt("Rename"), image: "square.and.pencil" },
          // Presets always come back, so deleting one would only strip it from threads.
          ...(presetThreadTag(style.tag) === undefined
            ? [
                {
                  id: "delete",
                  title: gt("Delete"),
                  image: "trash",
                  attributes: { destructive: true },
                },
              ]
            : []),
        ]
      : []),
  ];
  const onRowAction = (style: ThreadTagStyle, index: number, threadCount: number, id: string) => {
    if (id.startsWith("color:")) {
      const color = THREAD_TAG_COLORS.find((each) => `color:${each}` === id);
      if (color !== undefined) recolor(style.tag, color);
    }
    if (id === "move-up") move(index, -1);
    if (id === "move-down") move(index, 1);
    if (id === "delete") remove(style.tag, threadCount);
    if (id === "rename") {
      Dialog.prompt({
        title: gt("Rename tag"),
        initialValue: style.tag,
        confirmText: gt("Rename"),
        onConfirm: (value) => rename(style.tag, value),
      });
    }
  };

  return (
    <SettingsSection
      title={props.title}
      footer={
        canManage
          ? gt(
              "Rename and delete apply to every thread, including archived ones. Tags show in this order.",
            )
          : undefined
      }
    >
      {AsyncResult.isFailure(usage) ? (
        <View className="gap-3 p-4">
          <Text className="text-foreground-muted">
            {failureMessage(usage.cause, gt("The tag could not be changed."))}
          </Text>
          <ListRow icon="arrow.clockwise" label={gt("Try again")} onPress={refresh} />
        </View>
      ) : !AsyncResult.isSuccess(usage) ? (
        <View className="items-center p-6">
          <AppActivityIndicator />
        </View>
      ) : rows.length === 0 ? (
        <Text className="p-4 text-foreground-muted">{gt("No tags yet.")}</Text>
      ) : (
        rows.map((style, index) => {
          const threadCount = counts.get(threadTagKey(style.tag)) ?? 0;
          const preset = presetThreadTag(style.tag);
          const description = preset === undefined ? undefined : messages(preset.description);
          return (
            <Menu
              key={style.tag}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`${style.tag}, ${threadTagColorLabel(style.color, messages)}, ${pluralThreads(threadCount)}`}
              actions={rowActions(style, index, threadCount)}
              onPressAction={({ nativeEvent }) =>
                onRowAction(style, index, threadCount, nativeEvent.event)
              }
            >
              <View className="bg-grouped-card">
                <ListRowLayout
                  leading={
                    <View
                      className="size-4 rounded-full"
                      style={{
                        backgroundColor:
                          THREAD_TAG_PALETTE[style.color][themeAppearance].foreground,
                      }}
                    />
                  }
                  label={style.tag}
                  {...(description === undefined ? {} : { description })}
                  detail={pluralThreads(threadCount)}
                />
              </View>
            </Menu>
          );
        })
      )}
    </SettingsSection>
  );
}
