import {
  isAcceptedDisplayTimezone,
  resolveDisplayTimezone,
  type DisplayTimezoneId,
} from "@/lib/display-timezone";

/** One clock value in the left nav. `settings` is the bottom row, never a twin above it. */
export type NavClockRow = "utc" | "moscow" | "settings";

const UTC_ROOTS = [
  "/traffic",
  "/operators",
  "/geography",
  "/raw",
  "/antifraud",
  "/smg/syslog",
];
const SETTINGS_ROOTS = ["/regs", "/audit", "/jobs"];

function matches(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Which nav clock the open page paints.
 * `smg` is resolved from the selected node's CDR zone, not from the path.
 * `/smg/syslog` is UTC arrival time and is matched before `/smg`.
 */
export function navClockSource(pathname: string): NavClockRow | "smg" | null {
  const path =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (UTC_ROOTS.some((root) => matches(path, root))) return "utc";
  if (SETTINGS_ROOTS.some((root) => matches(path, root))) return "settings";
  if (path === "/smg" || matches(path, "/smg/traffic")) return "smg";
  return null;
}

/**
 * The fixed UTC or Moscow row wins over the Settings row when the zone is one of those.
 * Kaliningrad and Novosibirsk paint the Settings row only when that row is the same zone.
 */
export function navClockRowForZone(
  zone: string | null | undefined,
  settingsZone: DisplayTimezoneId,
): NavClockRow | null {
  const trimmed = zone?.trim() ?? "";
  if (!trimmed || !isAcceptedDisplayTimezone(trimmed)) return null;
  const id = resolveDisplayTimezone(trimmed);
  if (id === "UTC") return "utc";
  if (id === "Europe/Moscow") return "moscow";
  if (id === settingsZone) return "settings";
  return null;
}
