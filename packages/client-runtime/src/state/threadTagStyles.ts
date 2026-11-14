import { type ThreadTagColor, type ThreadTagStyle, threadTagKey } from "@t3tools/contracts";

export interface ThreadTagColorPair {
  readonly background: string;
  readonly foreground: string;
}

/** Each pair keeps text at WCAG AA contrast (4.5:1) or better; threadTagStyles.test.ts checks it. */
export const THREAD_TAG_PALETTE: Record<
  ThreadTagColor,
  { readonly light: ThreadTagColorPair; readonly dark: ThreadTagColorPair }
> = {
  gray: {
    light: { background: "#f3f4f6", foreground: "#374151" },
    dark: { background: "#1f2937", foreground: "#d1d5db" },
  },
  red: {
    light: { background: "#fee2e2", foreground: "#991b1b" },
    dark: { background: "#7f1d1d", foreground: "#fecaca" },
  },
  orange: {
    light: { background: "#ffedd5", foreground: "#9a3412" },
    dark: { background: "#7c2d12", foreground: "#fed7aa" },
  },
  amber: {
    light: { background: "#fef3c7", foreground: "#92400e" },
    dark: { background: "#78350f", foreground: "#fde68a" },
  },
  green: {
    light: { background: "#dcfce7", foreground: "#166534" },
    dark: { background: "#14532d", foreground: "#bbf7d0" },
  },
  teal: {
    light: { background: "#ccfbf1", foreground: "#115e59" },
    dark: { background: "#134e4a", foreground: "#99f6e4" },
  },
  blue: {
    light: { background: "#dbeafe", foreground: "#1e40af" },
    dark: { background: "#1e3a8a", foreground: "#bfdbfe" },
  },
  violet: {
    light: { background: "#ede9fe", foreground: "#5b21b6" },
    dark: { background: "#4c1d95", foreground: "#ddd6fe" },
  },
  pink: {
    light: { background: "#fce7f3", foreground: "#9d174d" },
    dark: { background: "#831843", foreground: "#fbcfe8" },
  },
};

const PRESET_THREAD_TAGS: ReadonlyArray<{
  readonly tag: string;
  readonly color: ThreadTagColor;
  readonly description: string;
}> = [
  { tag: "critical", color: "red", description: "Never paused when usage runs ahead of pace." },
  { tag: "background", color: "gray", description: "Paused first when usage runs ahead of pace." },
  {
    tag: "private",
    color: "violet",
    description: "Hidden from thread lists when the hidden thread tags setting lists it.",
  },
];

export const presetThreadTag = (tag: string) =>
  PRESET_THREAD_TAGS.find((preset) => preset.tag === threadTagKey(tag));

/** `tags` plus any preset they lack, deduplicated ignoring case. */
export function withPresetThreadTags(tags: ReadonlyArray<string>): ReadonlyArray<string> {
  const keys = new Set(tags.map(threadTagKey));
  const missing = PRESET_THREAD_TAGS.filter((preset) => !keys.has(preset.tag));
  return [...tags, ...missing.map((preset) => preset.tag)];
}

/** Stored tags in their order, then presets the list leaves out, then the rest alphabetically. */
export function sortThreadTags(
  tags: ReadonlyArray<string>,
  styles: ReadonlyArray<ThreadTagStyle>,
): ReadonlyArray<string> {
  const rank = new Map<string, number>();
  for (const { tag } of [...styles, ...PRESET_THREAD_TAGS]) {
    const key = threadTagKey(tag);
    if (!rank.has(key)) rank.set(key, rank.size);
  }
  const rankOf = (tag: string) => rank.get(threadTagKey(tag)) ?? Number.POSITIVE_INFINITY;
  return [...tags].sort(
    (left, right) =>
      rankOf(left) - rankOf(right) || threadTagKey(left).localeCompare(threadTagKey(right)),
  );
}

export function threadTagColor(tag: string, styles: ReadonlyArray<ThreadTagStyle>): ThreadTagColor {
  const key = threadTagKey(tag);
  return (
    styles.find((style) => threadTagKey(style.tag) === key)?.color ??
    presetThreadTag(tag)?.color ??
    "gray"
  );
}

/** Every one of `tags` with its color, in display order: the full list a Settings edit writes. */
export function resolveThreadTagStyles(
  tags: ReadonlyArray<string>,
  styles: ReadonlyArray<ThreadTagStyle>,
): ReadonlyArray<ThreadTagStyle> {
  return sortThreadTags(tags, styles).map((tag) => ({ tag, color: threadTagColor(tag, styles) }));
}

/** Swaps two entries; an index out of range returns `styles`. */
export function swapThreadTagStyles(
  styles: ReadonlyArray<ThreadTagStyle>,
  from: number,
  to: number,
): ReadonlyArray<ThreadTagStyle> {
  const moving = styles[from];
  const other = styles[to];
  if (moving === undefined || other === undefined) return styles;
  const next = [...styles];
  next[from] = other;
  next[to] = moving;
  return next;
}
