import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { sortThreadTags, threadTagColor } from "@t3tools/client-runtime/state/threadTagStyles";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, Settings2Icon, XIcon } from "lucide-react";

import { useSetThreadTag } from "../../hooks/useSetThreadTag";
import { useServerConfigs, useThreadShell } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { openThreadTagPicker } from "../../state/threadTagPicker";
import { searchableSetting } from "../settings/settingsSearch";
import { threadTagColorStyle } from "../ThreadTagChips";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

export function ThreadTagsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const shell = useThreadShell(threadRef);
  const styles = useAtomValue(serverEnvironment.threadTagStylesAtom(props.environmentId));
  const canOperate = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const supportsTags =
    useServerConfigs().get(props.environmentId)?.environment.capabilities.threadTags === true;
  const setTag = useSetThreadTag();
  const navigate = useNavigate();
  if (shell === null || !supportsTags) return null;
  const tags = sortThreadTags(shell.tags ?? [], styles);

  return (
    <ThreadDetailsSection
      headingId="thread-details-tags-heading"
      title="Tags"
      actions={
        <>
          {canOperate ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    size="icon-xs"
                    variant="ghost"
                    part="icon"
                    aria-label="Edit tags"
                    onClick={(event) => openThreadTagPicker(threadRef, event.currentTarget)}
                  >
                    <PlusIcon className="size-3.5" />
                  </ThreadDetailsControl>
                }
              />
              <TooltipPopup>Edit tags</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  size="icon-xs"
                  variant="ghost"
                  part="icon"
                  aria-label="Manage tags"
                  onClick={() =>
                    void navigate({
                      to: "/settings/threads",
                      // Tags belong to one environment; without it the page asks for a scope.
                      search: { machine: props.environmentId },
                      hash: searchableSetting("thread-tags").id,
                    })
                  }
                >
                  <Settings2Icon className="size-3.5" />
                </ThreadDetailsControl>
              }
            />
            <TooltipPopup>Manage tags</TooltipPopup>
          </Tooltip>
        </>
      }
    >
      <div className="flex flex-wrap gap-1 px-2.5">
        {tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">No tags</span>
        ) : (
          tags.map((tag) => (
            <Badge
              key={tag}
              variant="custom"
              size="sm"
              title={tag}
              style={threadTagColorStyle(threadTagColor(tag, styles))}
              className="max-w-40"
            >
              <span className="truncate">{tag}</span>
              {canOperate ? (
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  className="-me-0.5 cursor-pointer rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => void setTag(threadRef, tag, false)}
                >
                  <XIcon className="size-3" aria-hidden />
                </button>
              ) : null}
            </Badge>
          ))
        )}
      </div>
    </ThreadDetailsSection>
  );
}
