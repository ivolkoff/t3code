import {
  filterThreadsByTag,
  suggestThreadTags,
} from "@t3tools/client-runtime/state/threadTagFilter";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { sortThreadTags } from "@t3tools/client-runtime/state/threadTagStyles";
import type { ThreadTagStyle } from "@t3tools/contracts";

const MAX_VISIBLE_TAGS = 2;

/** Filters the full shell list so a tagged subagent keeps its parent row, then keeps only the listed rows. */
export function filterListedThreadsByTag(
  listed: ReadonlyArray<EnvironmentThreadShell>,
  all: ReadonlyArray<EnvironmentThreadShell>,
  tag: string | null,
): ReadonlyArray<EnvironmentThreadShell> {
  if (tag === null) return listed;
  const keyOf = (thread: EnvironmentThreadShell) =>
    threadKey({ environmentId: thread.environmentId, threadId: thread.id });
  const kept = new Set(filterThreadsByTag(all, [tag]).map(keyOf));
  return listed.filter((thread) => kept.has(keyOf(thread)));
}

export function visibleThreadTags(
  tags: ReadonlyArray<string> | undefined,
  styles: ReadonlyArray<ThreadTagStyle>,
) {
  const all = sortThreadTags(tags ?? [], styles);
  return {
    shown: all.slice(0, MAX_VISIBLE_TAGS),
    overflow: Math.max(0, all.length - MAX_VISIBLE_TAGS),
  };
}

export function formatThreadTagsLabel(
  tags: ReadonlyArray<string> | undefined,
  styles: ReadonlyArray<ThreadTagStyle>,
): string | null {
  const { shown, overflow } = visibleThreadTags(tags, styles);
  if (shown.length === 0) return null;
  return shown.join(", ") + (overflow > 0 ? ` +${overflow}` : "");
}

/** Checked tags first, then the other known tags, both in tag order and narrowed by the query. */
export function threadTagPickerRows(
  known: ReadonlyArray<string>,
  own: ReadonlyArray<string>,
  query: string,
  styles: ReadonlyArray<ThreadTagStyle>,
): ReadonlyArray<string> {
  const needle = query.trim().toLowerCase();
  const checked = own.filter((tag) => needle === "" || tag.toLowerCase().includes(needle));
  return sortThreadTags(checked, styles).concat(
    sortThreadTags(suggestThreadTags(known, own, query), styles),
  );
}
