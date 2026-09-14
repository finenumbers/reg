import { describe, expect, it } from "vitest";
import {
  DISPLAY_TIMEZONES,
  TZ_OFFSET_HOURS,
  formatUtcOffsetLabel,
} from "@/lib/display-timezone";

describe("formatUtcOffsetLabel", () => {
  it("labels every curated zone from the fixed offset table", () => {
    for (const zone of DISPLAY_TIMEZONES) {
      const hours = TZ_OFFSET_HOURS[zone.id];
      expect(formatUtcOffsetLabel(zone.id)).toBe(
        hours === 0 ? "UTC" : `UTC+${hours}`,
      );
    }
  });

  it("uses UTC+7 for Krasnoyarsk and UTC for UTC", () => {
    expect(formatUtcOffsetLabel("Asia/Krasnoyarsk")).toBe("UTC+7");
    expect(formatUtcOffsetLabel("Europe/Moscow")).toBe("UTC+3");
    expect(formatUtcOffsetLabel("Asia/Kamchatka")).toBe("UTC+12");
    expect(formatUtcOffsetLabel("UTC")).toBe("UTC");
  });
});
