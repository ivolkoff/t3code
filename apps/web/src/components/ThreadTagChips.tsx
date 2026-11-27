import { useAtomValue } from "@effect/atom-react";
import {
  sortThreadTags,
  THREAD_TAG_PALETTE,
  threadTagColor,
} from "@t3tools/client-runtime/state/threadTagStyles";
import type { EnvironmentId, ThreadTagColor } from "@t3tools/contracts";
import { useGT } from "gt-react";
import type { CSSProperties } from "react";

import { serverEnvironment } from "../state/server";
import { Badge } from "./ui/badge";
import { SharedTooltipTrigger } from "./ui/shared-tooltip";

const MAX_CHIPS = 2;

/** Feeds Badge's `custom` variant; the dark pair applies under the `.dark` theme class. */
export function threadTagColorStyle(color: ThreadTagColor): CSSProperties {
  const { light, dark } = THREAD_TAG_PALETTE[color];
  return {
    "--badge-light-bg": light.background,
    "--badge-light-fg": light.foreground,
    "--badge-dark-bg": dark.background,
    "--badge-dark-fg": dark.foreground,
  } as CSSProperties;
}

/** Like PR labels: each chip truncates on its own, and "+N" names the rest on hover. */
export function ThreadTagChips(props: {
  readonly environmentId: EnvironmentId;
  readonly tags: ReadonlyArray<string> | undefined;
}) {
  const styles = useAtomValue(serverEnvironment.threadTagStylesAtom(props.environmentId));
  const gt = useGT();
  if (props.tags === undefined || props.tags.length === 0) return null;
  const tags = sortThreadTags(props.tags, styles);
  const shown = tags.slice(0, MAX_CHIPS);
  const hidden = tags.slice(MAX_CHIPS);
  return (
    <span className="flex min-w-0 shrink items-center gap-1">
      {shown.map((tag) => (
        <Badge
          key={tag}
          variant="custom"
          size="sm"
          title={tag}
          style={threadTagColorStyle(threadTagColor(tag, styles))}
          className="min-w-0 max-w-24 shrink justify-start"
        >
          <span className="truncate">{tag}</span>
        </Badge>
      ))}
      {hidden.length > 0 ? (
        <SharedTooltipTrigger
          side="top"
          label={hidden.join(", ")}
          render={
            <Badge
              variant="outline"
              size="sm"
              className="shrink-0"
              aria-label={gt(
                "{count, plural, one {{count} more tag} other {{count} more tags}}: {tags}",
                { count: hidden.length, tags: hidden.join(", ") },
              )}
            />
          }
        >
          +{hidden.length}
        </SharedTooltipTrigger>
      ) : null}
    </span>
  );
}
