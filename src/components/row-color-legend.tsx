import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type RowColorTone =
  | "phantom"
  | "call_error"
  | "parking_known"
  | "known_empty_duration"
  | "unregistered";

const TONE_CLASS: Record<RowColorTone, string> = {
  phantom: "bg-green-200 dark:bg-green-950",
  call_error: "bg-destructive/25",
  parking_known: "bg-blue-200 dark:bg-blue-950",
  known_empty_duration: "bg-gray-200 dark:bg-gray-950",
  unregistered: "bg-destructive/10",
};

/** Solid color plate on checkbox label text — same base fill as the matching table row. */
export function RowColorMark({
  tone,
  children,
}: {
  tone: RowColorTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-sm px-1 text-inherit whitespace-nowrap",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}
