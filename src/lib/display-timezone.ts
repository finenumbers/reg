/**
 * Display timezone for operator-facing clocks (UI + XLSX).
 * Curated IANA list — Russia has no DST.
 */

export const DEFAULT_DISPLAY_TIMEZONE = "Europe/Moscow";

export const DISPLAY_TIMEZONES = [
  { id: "UTC", label: "Всемирное координированное время (UTC)" },
  { id: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { id: "Europe/Moscow", label: "Москва (UTC+3)" },
  { id: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
] as const;

export type DisplayTimezoneId = (typeof DISPLAY_TIMEZONES)[number]["id"];

/** Fixed offsets — curated display zones have no DST. */
export const TZ_OFFSET_HOURS: Record<DisplayTimezoneId, number> = {
  UTC: 0,
  "Europe/Kaliningrad": 2,
  "Europe/Moscow": 3,
  "Asia/Novosibirsk": 7,
};

/** Stored ids from the previous curated list that still map to a kept zone. */
const LEGACY_DISPLAY_TIMEZONE_ALIASES: Record<string, DisplayTimezoneId> = {
  "Asia/Krasnoyarsk": "Asia/Novosibirsk",
};

const ALLOWED = new Set<string>(DISPLAY_TIMEZONES.map((z) => z.id));

export function isDisplayTimezoneId(value: string): value is DisplayTimezoneId {
  return ALLOWED.has(value);
}

export function isAcceptedDisplayTimezone(value: string): boolean {
  return isDisplayTimezoneId(value) || value in LEGACY_DISPLAY_TIMEZONE_ALIASES;
}

export function resolveDisplayTimezone(
  value: string | null | undefined,
): DisplayTimezoneId {
  if (value && isDisplayTimezoneId(value)) return value;
  if (value && value in LEGACY_DISPLAY_TIMEZONE_ALIASES) {
    return LEGACY_DISPLAY_TIMEZONE_ALIASES[value];
  }
  return DEFAULT_DISPLAY_TIMEZONE;
}

/** Operator clock label: `UTC` or `UTC+7` from the fixed offset table. */
export function formatUtcOffsetLabel(zone: DisplayTimezoneId): string {
  const hours = TZ_OFFSET_HOURS[zone];
  return hours === 0 ? "UTC" : `UTC+${hours}`;
}
