import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  pickableProjectGroups,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { msg, T, useGT } from "gt-react";
import { ChevronRightIcon, GripVerticalIcon, PinIcon } from "lucide-react";
import { Fragment } from "react";

import { useProjectPin } from "../../hooks/useProjectGroupUpdate";
import { useClientSettings } from "../../hooks/useSettings";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { m } from "../../i18n/messages";
import { cn } from "../../lib/utils";
import {
  getSidebarProjectSettingsKey,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { useProjects } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { ITEM_ROW_CLASSNAME } from "./itemRows";
import { SettingsGroup } from "./SettingsGroup";
import { useSettingsScope } from "./SettingsScopeContext";

const memberKeys = (group: SidebarProjectSnapshot) =>
  group.memberProjects.map((member) => member.physicalProjectKey);

export function ProjectOrderList() {
  const gt = useGT();
  const groups = useSidebarProjectGroups();
  const projects = useProjects();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const { canPinProjectGroup, toggleProjectGroupPin } = useProjectPin();
  const { selectScope } = useSettingsScope();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const shown = pickableProjectGroups(groups);

  // dnd-kit announces raw ids by default, and these ids are internal project keys.
  const findGroup = (id: UniqueIdentifier | undefined) =>
    shown.find((group) => group.projectKey === id);
  const nameOf = (id: UniqueIdentifier) => findGroup(id)?.displayName ?? String(id);
  const announcements: Announcements = {
    onDragStart: ({ active }) => m(msg("Picked up {name}.", { name: nameOf(active.id) })),
    onDragOver: ({ active, over }) =>
      over
        ? m(msg("{name} is over {target}.", { name: nameOf(active.id), target: nameOf(over.id) }))
        : undefined,
    onDragEnd: ({ active, over }) => {
      if (!over) return m(msg("{name} was dropped.", { name: nameOf(active.id) }));
      return findGroup(active.id)?.pinned === findGroup(over.id)?.pinned
        ? m(
            msg("{name} was dropped on {target}.", {
              name: nameOf(active.id),
              target: nameOf(over.id),
            }),
          )
        : m(
            msg("{name} did not move. Pinned projects stay above unpinned projects.", {
              name: nameOf(active.id),
            }),
          );
    },
    onDragCancel: ({ active }) =>
      m(msg("Moving {name} was cancelled.", { name: nameOf(active.id) })),
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const dragged = findGroup(active.id);
    const target = findGroup(over?.id);
    // Pinned projects always sort first, so a drop across that line could not stick.
    if (!dragged || !target || dragged === target || dragged.pinned !== target.pinned) return;
    reorderProjects(groups.flatMap(memberKeys), memberKeys(dragged), memberKeys(target));
  };

  return (
    <div className="space-y-3">
      <p className="px-3 text-sm text-muted-foreground sm:px-4">
        <T>
          Choose a project to manage its name, icon, checkouts and actions. Drag projects to fix
          their order in the sidebar, or pin them to keep them on top.
        </T>
      </p>
      <SettingsGroup>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          accessibility={{ announcements }}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={shown.map((group) => group.projectKey)}
            strategy={verticalListSortingStrategy}
          >
            <ol aria-label={gt("Projects, in sidebar order")}>
              {shown.map((group, index) => (
                <Fragment key={group.projectKey}>
                  {shown[index - 1]?.pinned && !group.pinned ? (
                    <li aria-hidden className="mx-3 border-t border-border sm:mx-4" />
                  ) : null}
                  <SortableProjectRow
                    group={group}
                    position={index + 1}
                    canPin={canPinProjectGroup(group)}
                    onTogglePin={() => toggleProjectGroupPin(group)}
                    onOpen={() =>
                      selectScope({
                        project: getSidebarProjectSettingsKey(group, groupingSettings, projects),
                      })
                    }
                  />
                </Fragment>
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </SettingsGroup>
    </div>
  );
}

function SortableProjectRow({
  group,
  position,
  onOpen,
  canPin,
  onTogglePin,
}: {
  readonly group: SidebarProjectSnapshot;
  readonly position: number;
  readonly onOpen: () => void;
  readonly canPin: boolean;
  readonly onTogglePin: () => void;
}) {
  const gt = useGT();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.projectKey });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        ITEM_ROW_CLASSNAME,
        "flex items-center gap-2",
        isDragging && "relative z-10 rounded-md bg-background shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={gt("Reorder {name}, position {position}", {
          name: group.displayName,
          position,
        })}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
      <span
        aria-hidden
        className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
      >
        {position}
      </span>
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onOpen}
      >
        <ProjectFavicon project={group} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{group.displayName}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {group.workspaceRoot}
          </span>
        </span>
      </button>
      <span className={cn("flex shrink-0", !group.pinned && "opacity-50 hover:opacity-100")}>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={
            group.pinned
              ? gt("Unpin {name}", { name: group.displayName })
              : gt("Pin {name}", { name: group.displayName })
          }
          aria-pressed={group.pinned}
          title={group.pinned ? gt("Unpin project") : gt("Pin project")}
          disabled={!canPin}
          onClick={onTogglePin}
        >
          {group.pinned ? <PinIcon className="fill-current" /> : <PinIcon />}
        </Button>
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className="flex shrink-0 cursor-pointer items-center text-muted-foreground"
        onClick={onOpen}
      >
        <ChevronRightIcon className="size-4" />
      </button>
    </li>
  );
}
