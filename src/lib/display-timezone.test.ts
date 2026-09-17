import { describe, expect, it } from "vitest";
import {
  DISPLAY_TIMEZONES,
  TZ_OFFSET_HOURS,
  formatUtcOffsetLabel,
  isAcceptedDisplayTimezone,
  resolveDisplayTimezone,
} from "@/lib/display-timezone";

describe("DISPLAY_TIMEZONES", () => {
  it("keeps only UTC, Kaliningrad, Moscow, and Novosibirsk", () => {
    expect(DISPLAY_TIMEZONES.map((zone) => zone.id)).toEqual([
      "UTC",
      "Europe/Kaliningrad",
      "Europe/Moscow",
      "Asia/Novosibirsk",
    ]);
    expect(DISPLAY_TIMEZONES.map((zone) => zone.label)).toEqual([
      "Всемирное координированное время (UTC)",
      "Калининград (UTC+2)",
      "Москва (UTC+3)",
      "Новосибирск (UTC+7)",
    ]);
  });
});

describe("formatUtcOffsetLabel", () => {
  it("labels every curated zone from the fixed offset table", () => {
    for (const zone of DISPLAY_TIMEZONES) {
      const hours = TZ_OFFSET_HOURS[zone.id];
      expect(formatUtcOffsetLabel(zone.id)).toBe(
        hours === 0 ? "UTC" : `UTC+${hours}`,
      );
    }
  });

  it("uses UTC+7 for Novosibirsk and UTC for UTC", () => {
    expect(formatUtcOffsetLabel("Asia/Novosibirsk")).toBe("UTC+7");
    expect(formatUtcOffsetLabel("Europe/Moscow")).toBe("UTC+3");
    expect(formatUtcOffsetLabel("Europe/Kaliningrad")).toBe("UTC+2");
    expect(formatUtcOffsetLabel("UTC")).toBe("UTC");
  });
});

describe("resolveDisplayTimezone", () => {
  it("aliases Krasnoyarsk to Novosibirsk and falls back to Moscow", () => {
    expect(resolveDisplayTimezone("Asia/Krasnoyarsk")).toBe("Asia/Novosibirsk");
    expect(isAcceptedDisplayTimezone("Asia/Krasnoyarsk")).toBe(true);
    expect(resolveDisplayTimezone("Mars/Phobos")).toBe("Europe/Moscow");
    expect(isAcceptedDisplayTimezone("Europe/Paris")).toBe(false);
  });
});
