import { XIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export function SidebarTagFilterBar(props: {
  readonly active: ReadonlyArray<string>;
  readonly onClear: () => void;
}) {
  if (props.active.length === 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-2 text-xs text-sidebar-muted-foreground">
      <span className="shrink-0">{props.active.length === 1 ? "Tag" : "Tags"}</span>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        {props.active.map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            title={tag}
            className="min-w-0 max-w-24 shrink justify-start"
          >
            <span className="truncate">{tag}</span>
          </Badge>
        ))}
      </span>
      <Button
        type="button"
        size="icon-micro"
        variant="ghost-muted"
        aria-label="Clear tag filter"
        onClick={props.onClear}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}
