/**
 * Which control a traffic header shows.
 * Calltrace is a plain label on every screen.
 * Time is sort only on every screen that can sort it.
 * Seconds sort only where the screen wires that button.
 * Cost sorts only where the screen wires that button.
 * Minutes stay a plain label. Other OPRS columns keep the search menu.
 */

import { VOIPMONITOR_COLUMN_SET } from "@/modules/traffic/columns";

type TrafficHeaderMode = "text" | "sort" | "filter";

export function trafficColumnHeaderMode(input: {
  column: string;
  oprs: boolean;
  timeSortable: boolean;
  durationSortable: boolean;
  /** «Стоимость» sorts only when the screen wires that button. */
  chargeSortable?: boolean;
  plain: boolean;
}): TrafficHeaderMode {
  if (input.column === "cdr_time" && input.timeSortable) return "sort";
  if (input.column === "elapsed_time" && input.durationSortable) return "sort";
  if (input.column === "tariff_charge" && input.chargeSortable) return "sort";
  if (input.column === "tariff_charge" || input.column === "billable_minutes")
    return "text";
  if (VOIPMONITOR_COLUMN_SET.has(input.column)) return "text";
  if (!input.oprs && input.plain) return "text";
  return "filter";
}
