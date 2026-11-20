import { threadTagKey } from "@t3tools/contracts";

// The prefix keeps a tag named "all" or like a project key from colliding with the project rows.
const TAG_ITEM_PREFIX = "\u0000tag:";

interface SidebarTagFilterItem {
  readonly value: string;
  readonly label: string;
  readonly tag: string;
}

export const isSidebarTagFilterItem = (item: {
  readonly value: string;
}): item is SidebarTagFilterItem => item.value.startsWith(TAG_ITEM_PREFIX);

export const tagFilterIncludes = (active: ReadonlyArray<string>, tag: string) =>
  active.some((existing) => threadTagKey(existing) === threadTagKey(tag));

/** Known tags, then active ones no thread carries any more, so they can still be unchecked. */
export function sidebarTagFilterItems(
  known: ReadonlyArray<string>,
  active: ReadonlyArray<string>,
): ReadonlyArray<SidebarTagFilterItem> {
  return [...known, ...active.filter((tag) => !tagFilterIncludes(known, tag))].map((tag) => ({
    value: `${TAG_ITEM_PREFIX}${tag}`,
    label: tag,
    tag,
  }));
}

/** A pick narrows the filter to that tag; an additive (Shift) pick toggles it, as project rows do. */
export function nextSidebarTagFilter(
  active: ReadonlyArray<string>,
  tag: string,
  additive: boolean,
): ReadonlyArray<string> {
  if (!additive) return [tag];
  return tagFilterIncludes(active, tag)
    ? active.filter((existing) => threadTagKey(existing) !== threadTagKey(tag))
    : [...active, tag];
}
