import { parseNaiveDateTime } from "@/modules/enrich/dates";

/** Switch civil time. The mask digits are not shifted into another zone. */
export function presentSwitchValue(value: string, mask: string | null): string {
  if (mask === "YMDhms" && /^\d{14}$/.test(value)) {
    return (
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ` +
      `${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`
    );
  }
  return value;
}

/**
 * Whole seconds from a switch connection stamp to the snapshot instant.
 * The digits are UTC, the same clock as the cells. Blank when the stamp
 * does not parse. A connection ahead of the snapshot is 0.
 */
export function liveCallSeconds(connectedAt: string, takenAtMs: number): string {
  const connected = parseNaiveDateTime(connectedAt);
  if (!connected) return "";
  const delta = takenAtMs - connected.getTime();
  if (delta < 0) return "0";
  return String(Math.floor(delta / 1000));
}
