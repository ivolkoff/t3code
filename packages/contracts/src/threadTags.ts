import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Tags are trimmed and match ignoring case; a thread keeps the spelling it was first tagged with. */
export const ThreadTag = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.makeFilter((value) =>
    /[\p{Cc}]/u.test(value) ? "A thread tag must be a single line of text." : true,
  ),
);
export type ThreadTag = typeof ThreadTag.Type;

/** Tags read back from storage or a peer. Lenient so a later tag rule never fails a whole thread. */
export const StoredThreadTags = Schema.Array(Schema.String).pipe(
  Schema.catchDecoding(() => Effect.succeedSome([])),
);

/** The identity tag spellings share: "bug" and "Bug" are one tag. */
export const threadTagKey = (tag: string): string => tag.toLowerCase();

/** Tagging keeps an existing spelling; untagging removes every spelling. Returns `tags` when unchanged. */
export function applyThreadTag(
  tags: ReadonlyArray<string>,
  tag: string,
  tagged: boolean,
): ReadonlyArray<string> {
  const key = threadTagKey(tag);
  if (tagged) return tags.some((each) => threadTagKey(each) === key) ? tags : [...tags, tag];
  const kept = tags.filter((each) => threadTagKey(each) !== key);
  return kept.length === tags.length ? tags : kept;
}

export const THREAD_TAG_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export const ThreadTagColor = Schema.Literals(THREAD_TAG_COLORS);
export type ThreadTagColor = typeof ThreadTagColor.Type;

export const ThreadTagStyle = Schema.Struct({ tag: ThreadTag, color: ThreadTagColor });
export type ThreadTagStyle = typeof ThreadTagStyle.Type;

const isThreadTag = Schema.is(ThreadTag);
const isThreadTagColor = Schema.is(ThreadTagColor);

/** Stored tag styles: a bad entry drops alone and an unknown color reads as gray. */
export const StoredThreadTagStyles = Schema.Array(Schema.Unknown).pipe(
  Schema.decodeTo(
    Schema.Array(ThreadTagStyle),
    SchemaTransformation.transform<ReadonlyArray<ThreadTagStyle>, ReadonlyArray<unknown>>({
      decode: (values) =>
        values.flatMap((value) => {
          if (typeof value !== "object" || value === null) return [];
          const { tag, color } = value as { tag?: unknown; color?: unknown };
          if (!isThreadTag(tag)) return [];
          return [{ tag, color: isThreadTagColor(color) ? color : "gray" }];
        }),
      encode: (values) => values,
    }),
  ),
);

/** Keeps tag styles in step with a rename: the entry follows the tag, and a merge keeps the target's. Returns `styles` when unchanged. */
export function renameThreadTagStyle(
  styles: ReadonlyArray<ThreadTagStyle>,
  tag: string,
  to: string,
): ReadonlyArray<ThreadTagStyle> {
  const key = threadTagKey(tag);
  const toKey = threadTagKey(to);
  if (!styles.some((style) => threadTagKey(style.tag) === key)) return styles;
  if (key !== toKey && styles.some((style) => threadTagKey(style.tag) === toKey)) {
    return deleteThreadTagStyle(styles, tag);
  }
  return styles.map((style) => (threadTagKey(style.tag) === key ? { ...style, tag: to } : style));
}

/** Returns `styles` when the tag has no style. */
export function deleteThreadTagStyle(
  styles: ReadonlyArray<ThreadTagStyle>,
  tag: string,
): ReadonlyArray<ThreadTagStyle> {
  const key = threadTagKey(tag);
  const kept = styles.filter((style) => threadTagKey(style.tag) !== key);
  return kept.length === styles.length ? styles : kept;
}
