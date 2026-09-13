import { describe, expect, it } from "vitest";
import { applyRegistrationQuery } from "@/modules/registrations/query-filter";
import type { RegistrationListItem } from "@/modules/registrations/types";

const rows: RegistrationListItem[] = [
  {
    phone: "73852222205",
    description: "Клиент А",
    channelality: "10",
    status: "Registered",
    ip: "46.20.69.189",
    port: 5060,
    country: "RU",
    city: "Moscow",
    isp: "ISP",
    lastSeenAt: "2026-08-06T12:00:00.000Z",
    lastChangedAt: "2026-08-06T10:00:00.000Z",
  },
  {
    phone: "73912193303",
    description: null,
    channelality: null,
    status: "Unregistered",
    ip: null,
    port: null,
    country: null,
    city: null,
    isp: null,
    lastSeenAt: "2026-08-06T12:00:00.000Z",
    lastChangedAt: "2026-08-06T11:00:00.000Z",
  },
];

describe("applyRegistrationQuery", () => {
  it("is a no-op when unregisteredOnly is absent or false", () => {
    expect(applyRegistrationQuery(rows)).toEqual(rows);
    expect(applyRegistrationQuery(rows, { unregisteredOnly: false })).toEqual(
      rows,
    );
  });

  it("keeps only Unregistered when the toolbar flag is on", () => {
    const filtered = applyRegistrationQuery(rows, { unregisteredOnly: true });
    expect(filtered.map((r) => r.phone)).toEqual(["73912193303"]);
  });

  it("ANDs the flag with phoneQ", () => {
    expect(
      applyRegistrationQuery(rows, {
        unregisteredOnly: true,
        phoneQ: "222205",
      }),
    ).toEqual([]);
    expect(
      applyRegistrationQuery(rows, {
        unregisteredOnly: true,
        phoneQ: "193303",
      }).map((r) => r.phone),
    ).toEqual(["73912193303"]);
  });

  it("ANDs the flag with a conflicting status column filter", () => {
    expect(
      applyRegistrationQuery(rows, {
        unregisteredOnly: true,
        filters: { status: ["Registered"] },
      }),
    ).toEqual([]);
  });

  it("still applies unregisteredOnly when excluding the status column for facets", () => {
    const filtered = applyRegistrationQuery(rows, {
      unregisteredOnly: true,
      excludeColumn: "status",
    });
    expect(filtered.map((r) => r.status)).toEqual(["Unregistered"]);
  });

  it("filters channelality; Премиум does not match a missing catalog row", () => {
    const withPremium: typeof rows = [
      { ...rows[0]!, channelality: "Премиум" },
      { ...rows[1]!, channelality: null },
    ];
    expect(
      applyRegistrationQuery(withPremium, {
        filters: { channelality: ["Премиум"] },
      }).map((r) => r.phone),
    ).toEqual(["73852222205"]);
    expect(
      applyRegistrationQuery(withPremium, {
        filters: { channelality: ["__empty__"] },
      }).map((r) => r.phone),
    ).toEqual(["73912193303"]);
  });

  it("excludes the open channelality column so mutual facets stay honest", () => {
    const filtered = applyRegistrationQuery(rows, {
      filters: { channelality: ["10"] },
      excludeColumn: "channelality",
    });
    expect(filtered).toHaveLength(2);
  });
});
