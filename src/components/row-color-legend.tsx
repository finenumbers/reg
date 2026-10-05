import type { ReactNode } from "react";
import { FILTER_TOOLBAR_TEXT } from "@/components/filter-toolbar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type RowColorTone =
  "phantom" | "call_error" | "parking_known" | "failed" | "check" | "unregistered";

const TONE_CLASS: Record<RowColorTone, string> = {
  phantom: "bg-green-200 dark:bg-green-950",
  call_error: "bg-destructive/25",
  parking_known: "bg-blue-200 dark:bg-blue-950",
  failed: "bg-gray-200 dark:bg-gray-950",
  check: "bg-yellow-200 dark:bg-yellow-950",
  unregistered: "bg-destructive/10",
};

/** Badge chrome on checkbox label text — same base fill as the matching table row. */
export function RowColorMark({
  tone,
  children,
}: {
  tone: RowColorTone;
  children: ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        `text-foreground border-transparent ${FILTER_TOOLBAR_TEXT} leading-none`,
        TONE_CLASS[tone],
      )}
    >
      {children}
    </Badge>
  );
}
