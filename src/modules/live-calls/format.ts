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
 * Civil text, a fractional second, and 14-digit YMDhms all count.
 * The digits are UTC, the same clock as the cells. Blank when the stamp
 * does not parse. A connection ahead of the snapshot is 0.
 */
export function liveCallSeconds(connectedAt: string, takenAtMs: number): string {
  const connected = connectionInstant(connectedAt);
  if (!connected) return "";
  const delta = takenAtMs - connected.getTime();
  if (delta < 0) return "0";
  return String(Math.floor(delta / 1000));
}

function connectionInstant(raw: string): Date | null {
  const trimmed = raw.trim();
  if (/^\d{14}$/.test(trimmed)) {
    return parseNaiveDateTime(presentSwitchValue(trimmed, "YMDhms"));
  }
  const whole = trimmed.replace(/[.,]\d+$/, "");
  if (whole !== trimmed) {
    const parsed = parseNaiveDateTime(whole);
    if (parsed) return parsed;
  }
  return parseNaiveDateTime(trimmed);
}

/**
 * Whole seconds from a live duration cell.
 * An integer is already seconds. `H:MM:SS` becomes a total.
 * A fractional second is dropped. Empty stays empty.
 * Any other text is kept, so the cell is not replaced by a calculated zero.
 */
export function presentTalkSeconds(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const clock = /^(\d+):(\d{2}):(\d{2})$/.exec(trimmed);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3]);
    if (minutes > 59 || seconds > 59) return trimmed;
    return String(hours * 3600 + minutes * 60 + seconds);
  }
  const fractional = /^(\d+)[.,](\d+)$/.exec(trimmed);
  if (fractional) return fractional[1]?.replace(/^0+(?=\d)/, "") ?? "";
  if (/^\d+$/.test(trimmed)) return trimmed.replace(/^0+(?=\d)/, "");
  return trimmed;
}
