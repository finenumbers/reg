import { describe, expect, it } from "vitest";
import { navClockRowForZone, navClockSource } from "@/lib/nav-clock";

describe("navClockSource", () => {
  it("paints UTC on the civil-UTC tables, АнтиФрод, and syslog", () => {
    expect(navClockSource("/traffic")).toBe("utc");
    expect(navClockSource("/operators")).toBe("utc");
    expect(navClockSource("/geography")).toBe("utc");
    expect(navClockSource("/raw")).toBe("utc");
    expect(navClockSource("/antifraud")).toBe("utc");
    expect(navClockSource("/smg/syslog")).toBe("utc");
    expect(navClockSource("/smg/syslog/node")).toBe("utc");
  });

  it("paints the Settings row on registrations, audit, and jobs", () => {
    expect(navClockSource("/regs")).toBe("settings");
    expect(navClockSource("/audit")).toBe("settings");
    expect(navClockSource("/jobs")).toBe("settings");
  });

  it("leaves the SMG call tables to the selected node", () => {
    expect(navClockSource("/smg")).toBe("smg");
    expect(navClockSource("/smg/traffic")).toBe("smg");
  });

  it("paints nothing where the page has no single clock", () => {
    expect(navClockSource("/")).toBeNull();
    expect(navClockSource("/settings")).toBeNull();
    expect(navClockSource("/phones")).toBeNull();
    expect(navClockSource("/groups")).toBeNull();
  });
});

describe("navClockRowForZone", () => {
  it("keeps UTC and Moscow on their own rows when Settings matches them", () => {
    expect(navClockRowForZone("UTC", "UTC")).toBe("utc");
    expect(navClockRowForZone("Europe/Moscow", "Europe/Moscow")).toBe("moscow");
  });

  it("paints the Settings row for Kaliningrad and Novosibirsk only when it shows that zone", () => {
    expect(navClockRowForZone("Asia/Novosibirsk", "Asia/Novosibirsk")).toBe("settings");
    expect(navClockRowForZone("Europe/Kaliningrad", "Europe/Kaliningrad")).toBe(
      "settings",
    );
    expect(navClockRowForZone("Asia/Novosibirsk", "Europe/Moscow")).toBeNull();
    expect(navClockRowForZone("Asia/Krasnoyarsk", "Asia/Novosibirsk")).toBe("settings");
  });

  it("paints nothing without a saved zone", () => {
    expect(navClockRowForZone(null, "Europe/Moscow")).toBeNull();
    expect(navClockRowForZone("", "Europe/Moscow")).toBeNull();
    expect(navClockRowForZone("Mars/Phobos", "Europe/Moscow")).toBeNull();
  });
});
