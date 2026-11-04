import { describe, expect, it } from "vitest";
import { assembleRegistrations, type CatalogRegistrationEndpoint } from "@/modules/registrations/rtu-rows";

const catalog: CatalogRegistrationEndpoint[] = [
  {
    endpointNumber: "73852222205",
    registrationName: "client-a",
    registrationFlag: "Да",
  },
  {
    endpointNumber: "73912193303",
    registrationName: "",
    registrationFlag: "Да",
  },
];

describe("assembleRegistrations", () => {
  it("does not invent unregistered rows from an empty page", () => {
    const result = assembleRegistrations({
      pcomm: [],
      pupr: [{ id: "9", userAgent: "Phone" }],
      catalog,
    });
    expect(result).toEqual({ ok: true, value: { rows: [], pcommCount: 0 } });
  });

  it("joins the user agent and adds a catalog number that is missing", () => {
    const result = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "client-a",
          aliases: "",
          state: "Перерегистрация",
          address: "46.20.69.189:5060",
        },
      ],
      pupr: [{ id: "1", userAgent: " Yealink SIP-T31 " }],
      catalog,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toEqual([
      {
        phone: "73852222205",
        status: "Registered",
        ip: "46.20.69.189",
        port: 5060,
        userAgent: "Yealink SIP-T31",
        rawLine: "",
      },
      {
        phone: "73912193303",
        status: "Unregistered",
        ip: null,
        port: null,
        userAgent: null,
        rawLine: "",
      },
    ]);
  });

  it("keeps a live registration when the same phone also has an idle row", () => {
    const result = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "73852222205",
          aliases: "",
          state: "Зарегистрирован",
          address: "1.2.3.4",
        },
        {
          id: "2",
          name: "73852222205",
          aliases: "",
          state: "Инициализация",
          address: "9.9.9.9:5060",
        },
      ],
      pupr: [{ id: "1", userAgent: "Grandstream" }],
      catalog: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toEqual([
      {
        phone: "73852222205",
        status: "Registered",
        ip: "1.2.3.4",
        port: null,
        userAgent: "Grandstream",
        rawLine: "",
      },
    ]);
  });

  it("fails when both pages have rows and share no id", () => {
    const result = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "1.2.3.4",
        },
      ],
      pupr: [{ id: "2", userAgent: "Phone" }],
      catalog: [],
    });
    expect(result).toEqual({
      ok: false,
      detail: "Страницы регистраций не соединяются по ID.",
    });
  });

  it("fails when one registration name points at two endpoints", () => {
    const result = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "shared",
          aliases: "",
          state: "Зарегистрирован",
          address: "1.2.3.4",
        },
      ],
      pupr: [],
      catalog: [
        { endpointNumber: "100", registrationName: "shared", registrationFlag: "Да" },
        { endpointNumber: "200", registrationName: "shared", registrationFlag: "Да" },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toBe("Две записи оборудования с одним регистрационным именем.");
  });

  it("fails on an unmapped name and does not parse a split alias", () => {
    const named = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "office",
          aliases: "100;200",
          state: "Зарегистрирован",
          address: "1.2.3.4",
        },
      ],
      pupr: [],
      catalog: [],
    });
    expect(named.ok).toBe(false);
    if (named.ok) return;
    expect(named.detail).toContain("office");
  });

  it("rejects a hostname, IPv6, and an agent longer than 2000 characters", () => {
    const host = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "pbx.example",
        },
      ],
      pupr: [],
      catalog: [],
    });
    expect(host.ok).toBe(false);
    const v6 = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "2001:db8::1",
        },
      ],
      pupr: [],
      catalog: [],
    });
    expect(v6.ok).toBe(false);
    const agent = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "1.2.3.4",
        },
      ],
      pupr: [{ id: "1", userAgent: "A".repeat(2001) }],
      catalog: [],
    });
    expect(agent).toEqual({
      ok: false,
      detail: "Агент пользователя длиннее 2000 символов.",
    });
  });

  it("keeps the later registration and the smaller id when times tie", () => {
    const later = assembleRegistrations({
      pcomm: [
        {
          id: "2",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "5.6.7.8:5060",
          endsAt: "2026-11-05 01:00:00",
        },
        {
          id: "1",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "1.2.3.4:5060",
          endsAt: "2026-11-05 03:00:00",
        },
      ],
      pupr: [
        { id: "1", userAgent: "Early" },
        { id: "2", userAgent: "Late" },
      ],
      catalog: [],
    });
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.value.rows).toEqual([
      {
        phone: "100",
        status: "Registered",
        ip: "1.2.3.4",
        port: 5060,
        userAgent: "Early",
        rawLine: "",
      },
    ]);

    const tied = assembleRegistrations({
      pcomm: [
        {
          id: "9",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "5.6.7.8:5060",
          endsAt: "05.11.2026 03:00:00",
        },
        {
          id: "2",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "1.2.3.4:5060",
          endsAt: "2026-11-05 03:00:00",
        },
      ],
      pupr: [
        { id: "9", userAgent: "Late" },
        { id: "2", userAgent: "Early" },
      ],
      catalog: [],
    });
    expect(tied.ok).toBe(true);
    if (!tied.ok) return;
    expect(tied.value.rows[0]).toMatchObject({ ip: "1.2.3.4", userAgent: "Early" });
  });

  it("prefers a parsed end time, then the smaller id when none is parsed", () => {
    const parsed = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "1.2.3.4:5060",
          endsAt: "",
        },
        {
          id: "2",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "5.6.7.8:5060",
          endsAt: "20261105030000",
        },
      ],
      pupr: [],
      catalog: [],
      endMask: "YMDhms",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.rows[0]).toMatchObject({ ip: "5.6.7.8", port: 5060 });

    const byId = assembleRegistrations({
      pcomm: [
        {
          id: "2",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "5.6.7.8:5060",
        },
        {
          id: "1",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "1.2.3.4:5060",
        },
      ],
      pupr: [],
      catalog: [],
    });
    expect(byId.ok).toBe(true);
    if (!byId.ok) return;
    expect(byId.value.rows[0]).toMatchObject({ ip: "1.2.3.4" });
  });

  it("keeps the first copy when one id repeats with a different end time", () => {
    const result = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "1.2.3.4:5060",
          endsAt: "2026-11-05 01:00:00",
        },
        {
          id: "1",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "1.2.3.4:5060",
          endsAt: "2026-11-05 09:00:00",
        },
        {
          id: "2",
          name: "100",
          aliases: "",
          state: "Зарегистрирован",
          address: "5.6.7.8:5060",
          endsAt: "2026-11-05 05:00:00",
        },
      ],
      pupr: [],
      catalog: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows[0]).toMatchObject({ ip: "5.6.7.8" });
  });

  it("skips a blank endpoint number", () => {
    const result = assembleRegistrations({
      pcomm: [
        {
          id: "1",
          name: "100",
          aliases: "",
          state: "Не зарегистрирован",
          address: "",
        },
      ],
      pupr: [],
      catalog: [
        { endpointNumber: "  ", registrationName: "", registrationFlag: "Да" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows.map((row) => row.phone)).toEqual(["100"]);
  });
});
