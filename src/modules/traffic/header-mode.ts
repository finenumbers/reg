/**
 * Which control a traffic header shows.
 * Calltrace is a plain label on every screen.
 * Time is sort only on every screen that can sort it.
 * Other OPRS columns keep the search menu.
 */

import { VOIPMONITOR_COLUMN_SET } from "@/modules/traffic/columns";

export type TrafficHeaderMode = "text" | "sort" | "filter";

export function trafficColumnHeaderMode(input: {
  column: string;
  oprs: boolean;
  timeSortable: boolean;
  plain: boolean;
}): TrafficHeaderMode {
  if (input.column === "cdr_time" && input.timeSortable) return "sort";
  if (VOIPMONITOR_COLUMN_SET.has(input.column)) return "text";
  if (!input.oprs && input.plain) return "text";
  return "filter";
}
