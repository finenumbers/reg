/**
 * Which control a traffic header shows.
 * OPRS keeps the time sort and adds the same search menu the other columns use.
 * Other screens keep a plain Calltrace header and a sort-only time header.
 */

export type TrafficHeaderMode = "text" | "sort" | "filter" | "sort-and-filter";

export function trafficColumnHeaderMode(input: {
  column: string;
  oprs: boolean;
  timeSortable: boolean;
  plain: boolean;
}): TrafficHeaderMode {
  if (input.column === "cdr_time" && input.timeSortable) {
    return input.oprs ? "sort-and-filter" : "sort";
  }
  if (!input.oprs && input.plain) return "text";
  return "filter";
}
