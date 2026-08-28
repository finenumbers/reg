/**
 * Display timezone for operator-facing clocks (UI + XLSX).
 * Curated IANA list — Russia has no DST.
 */

export const DEFAULT_DISPLAY_TIMEZONE = "Europe/Moscow";

export const DISPLAY_TIMEZONES = [
  { id: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { id: "Europe/Moscow", label: "Москва (UTC+3)" },
  { id: "Europe/Samara", label: "Самара (UTC+4)" },
  { id: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { id: "Asia/Omsk", label: "Омск (UTC+6)" },
  { id: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
  { id: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { id: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { id: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { id: "Asia/Magadan", label: "Магадан (UTC+11)" },
  { id: "Asia/Kamchatka", label: "Камчатка (UTC+12)" },
  { id: "UTC", label: "UTC" },
] as const;

export type DisplayTimezoneId = (typeof DISPLAY_TIMEZONES)[number]["id"];

/** Fixed offsets — curated display zones have no DST. */
export const TZ_OFFSET_HOURS: Record<DisplayTimezoneId, number> = {
  "Europe/Kaliningrad": 2,
  "Europe/Moscow": 3,
  "Europe/Samara": 4,
  "Asia/Yekaterinburg": 5,
  "Asia/Omsk": 6,
  "Asia/Krasnoyarsk": 7,
  "Asia/Irkutsk": 8,
  "Asia/Yakutsk": 9,
  "Asia/Vladivostok": 10,
  "Asia/Magadan": 11,
  "Asia/Kamchatka": 12,
  UTC: 0,
};

const ALLOWED = new Set<string>(DISPLAY_TIMEZONES.map((z) => z.id));

export function isDisplayTimezoneId(value: string): value is DisplayTimezoneId {
  return ALLOWED.has(value);
}

export function resolveDisplayTimezone(
  value: string | null | undefined,
): DisplayTimezoneId {
  if (value && isDisplayTimezoneId(value)) return value;
  return DEFAULT_DISPLAY_TIMEZONE;
}
