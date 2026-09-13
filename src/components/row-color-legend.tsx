import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type RowColorTone =
  | "phantom"
  | "call_error"
  | "parking_known"
  | "known_empty_duration"
  | "unregistered";

const TONE_CLASS: Record<RowColorTone, string> = {
  phantom:
    "[--row-mark:var(--color-green-200)] dark:[--row-mark:var(--color-green-950)]",
  call_error:
    "[--row-mark:color-mix(in_oklab,var(--destructive)_25%,transparent)]",
  parking_known:
    "[--row-mark:var(--color-blue-200)] dark:[--row-mark:var(--color-blue-950)]",
  known_empty_duration:
    "[--row-mark:var(--color-gray-200)] dark:[--row-mark:var(--color-gray-950)]",
  unregistered:
    "[--row-mark:color-mix(in_oklab,var(--destructive)_10%,transparent)]",
};

/** Highlighter stroke on checkbox label text — same base fill as the matching table row. */
export function RowColorMark({
  tone,
  children,
}: {
  tone: RowColorTone;
  children: ReactNode;
}) {
  return (
    <span className={cn("row-color-mark", TONE_CLASS[tone])}>{children}</span>
  );
}
